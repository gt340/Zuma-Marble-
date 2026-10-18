// Optional on-device diagnostics panel. Loaded ONLY when the page URL has ?debug=1 (see main.js); never part of normal play.
// Purpose: let a person with just the phone (no PC, no DevTools) sample frame times, input->frame delay, quality changes, memory, errors and
// console output over a timed session and export everything as one JSON file for a bug report.
// Costs nothing when off (this file is not even requested). When on: NO extra render loop — frame times are fed from the game's existing
// animation-frame callback; the panel refreshes on a 500 ms interval; a snapshot is stored every 30 s.
// MEASURED here: JS-visible frame intervals while a level is being played (menus/pause excluded), the delay between a shot's pointerup event and the
// next frame callback (excludes touch-panel sampling and display latency), heap (Chrome-only), renderer.info counts, quality, errors.
// NOT measurable from a web page: temperature, true photon latency, GPU time. Those stay manual observations (see DEVICE-TEST.md).

export function createDiag(env) {
  const START = performance.now();
  // Passive main-thread diagnostics. No forced GPU synchronization or extra render loop.
  const callbackRing = new Float32Array(300);
  let callbackHead = 0, callbackN = 0, callbackSum = 0, callbackMax = 0, callbackStart = -1;
  // Debug-only section timings. Keep a bounded rolling window and aggregate only when exporting.
  const sectionSamples = Object.create(null);
  const gpuQuerySamples = new Float32Array(300);
  let gpuQueryHead = 0, gpuQueryN = 0, gpuQueryStatus = 'pending', gpuQueryApi = null, gpuQueryDisjoint = 0, gpuQuerySkipped = 0, gpuQueryReason = null;
  const longTasks = []; let longTaskSupported = false;
  const HIST_MAX = 250;                        // 1 ms bins up to 250 ms; larger intervals land in the last bin
  const hist = new Uint32Array(HIST_MAX + 1), ring = new Float32Array(300);
  let ringHead = 0, ringN = 0, last = 0, frames = 0, over33 = 0, over50 = 0, over100 = 0, maxMs = 0, sumMs = 0;
  let pendingInput = -1; const lat = [];
  const errors = [], events = [], samples = []; let battery = null, hidden = false, attached = false, flash = '';
  const cap = (arr, v, n = 200) => { arr.push(v); if (arr.length > n) arr.shift(); };
  const tsec = () => +((performance.now() - START) / 1000).toFixed(1);
  const ev = (type, detail) => cap(events, { t: tsec(), type, detail });

  // Observe browser-reported main-thread long tasks when supported.
  try {
    if (typeof PerformanceObserver !== 'undefined' &&
        PerformanceObserver.supportedEntryTypes &&
        PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const item = { t: +((entry.startTime - START) / 1000).toFixed(1), durationMs: +entry.duration.toFixed(1) };
          cap(longTasks, item, 200);
          cap(events, { t: item.t, type: 'long-task', detail: item.durationMs + ' ms' });
        }
      });
      observer.observe({ type: 'longtask', buffered: true });
      longTaskSupported = true;
    }
  } catch { /* browser does not expose Long Tasks API */ }

  // ---- capture errors and the game's own console lines (the originals still run)
  // Privacy: a report is something a person copies or saves and sends on purpose; nothing is uploaded. It must not carry the host name or the full URL
  // (query strings can hold anything), so the origin is stripped from every captured message/stack and `page` is the path plus whitelisted graphics flags only.
  const ORIGIN = (() => { try { return location.origin && location.origin !== 'null' ? location.origin : ''; } catch { return ''; } })();
  const scrub = (s) => (ORIGIN ? String(s).split(ORIGIN).join('') : String(s));
  const FLAGS = ['aa', 'dpr', 'halo', 'env', 'adapt', 'marks', 'hudblur', 'guidedots', 'debug'];
  const pageInfo = () => { try { const q = new URLSearchParams(location.search), keep = []; for (const k of FLAGS) if (q.has(k)) keep.push(k + '=' + String(q.get(k)).replace(/[^0-9a-z.]/gi, '').slice(0, 8)); return location.pathname + (keep.length ? '?' + keep.join('&') : ''); } catch { return ''; } };
  const fmt = (a) => { try { return scrub(a.map((x) => (x instanceof Error ? (x.stack || x.message) : typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ')).slice(0, 600); } catch { return '(unprintable)'; } };
  for (const level of ['error', 'warn', 'info']) {
    const orig = console[level].bind(console);
    console[level] = (...a) => { try { const s = fmt(a); if (level !== 'info' || s.startsWith('[zuma]')) cap(errors, { t: tsec(), level, msg: s }); } catch { /* ignore */ } orig(...a); };
  }
  addEventListener('error', (e) => cap(errors, { t: tsec(), level: 'uncaught', msg: scrub(String(e.message || e.error)) + (e.filename ? ' @' + String(e.filename).split('/').pop() + ':' + e.lineno : '') }));
  addEventListener('unhandledrejection', (e) => cap(errors, { t: tsec(), level: 'unhandledrejection', msg: fmt([e.reason]) }));
  document.addEventListener('visibilitychange', () => { hidden = document.hidden; ev('visibility', document.visibilityState); });
  addEventListener('online', () => ev('network', 'online')); addEventListener('offline', () => ev('network', 'offline'));
  addEventListener('pagehide', () => ev('pagehide', ''));
  let lastSz = '';
  addEventListener('resize', () => { const s = innerWidth + 'x' + innerHeight; if (s !== lastSz) { lastSz = s; ev('viewport', s + (innerWidth > innerHeight ? ' landscape' : ' portrait')); } });
  try { if (navigator.getBattery) navigator.getBattery().then((b) => { battery = b; }).catch(() => {}); } catch { /* ignore */ }

  // ---- called from the game loop / input path
  function frameStart() { callbackStart = performance.now(); }
  function frameEnd(end = performance.now()) {
    if (callbackStart < 0) return;
    const ms = Math.max(0, end - callbackStart);
    callbackStart = -1;
    callbackN++; callbackSum += ms; if (ms > callbackMax) callbackMax = ms;
    callbackRing[callbackHead] = ms; callbackHead = (callbackHead + 1) % callbackRing.length;
  }
  function callbackStats() {
    const n = Math.min(callbackN, callbackRing.length);
    if (!n) return { n: 0, meanMs: 0, p95Ms: 0, maxMs: +callbackMax.toFixed(2) };
    const values = Array.from(callbackRing).slice(0, n).sort((a, b) => a - b);
    return {
      n: callbackN,
      meanMs: +(callbackSum / callbackN).toFixed(2),
      p95Ms: +values[Math.min(n - 1, Math.floor(n * 0.95))].toFixed(2),
      maxMs: +callbackMax.toFixed(2)
    };
  }
  function frame(now) {
    const g = env.game();
    if (last && now - last < 1000) {
      if (g && g.state === 'playing' && !g.paused) {
        const ms = now - last; frames++; sumMs += ms; if (ms > maxMs) maxMs = ms;
        if (ms > 33.4) over33++; if (ms > 50) over50++; if (ms > 100) over100++;
        hist[Math.min(HIST_MAX, Math.round(ms))]++; ring[ringHead] = ms; ringHead = (ringHead + 1) % ring.length; if (ringN < ring.length) ringN++;
      }
    } else if (last && !hidden) ev('frame-gap', Math.round(now - last) + ' ms');
    last = now;
    if (pendingInput >= 0) { cap(lat, now - pendingInput, 500); pendingInput = -1; }
  }
  function input(timeStamp) { pendingInput = timeStamp; }

  function pct(p) { if (!frames) return 0; let need = Math.ceil(frames * p), c = 0; for (let i = 0; i <= HIST_MAX; i++) { c += hist[i]; if (c >= need) return i; } return HIST_MAX; }
  function windowStats() {
    if (!ringN) return { fps: 0, p95: 0, max: 0 };
    const a = Array.from(ring.subarray(0, ringN)).sort((x, y) => x - y), mean = a.reduce((x, y) => x + y, 0) / a.length;
    return { fps: +(1000 / mean).toFixed(1), p95: +a[Math.min(a.length - 1, Math.floor(a.length * 0.95))].toFixed(1), max: +a[a.length - 1].toFixed(1) };
  }
  function latStats() {
    if (!lat.length) return { n: 0 }; const a = lat.slice().sort((x, y) => x - y);
    return { n: a.length, mean: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1), p95: +a[Math.min(a.length - 1, Math.floor(a.length * 0.95))].toFixed(1), max: +a[a.length - 1].toFixed(1) };
  }
  function gpu() {
    const g = env.gfx(); if (!g) return null; const out = {};
    try { const r = g.renderer, i = r.info; out.geometries = i.memory.geometries; out.textures = i.memory.textures; out.programs = i.programs ? i.programs.length : null; out.drawCalls = i.render.calls; out.triangles = i.render.triangles; } catch { /* stub or old renderer */ }
    try { out.quality = g.quality; out.envBuildMs = g.envBuildMs; out.canvas = g.canvas.width + 'x' + g.canvas.height; } catch { /* ignore */ }
    return out;
  }
  function glInfo() {
    try { const gl = env.gfx().renderer.getContext(), x = gl.getExtension('WEBGL_debug_renderer_info'); return { renderer: x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), vendor: x ? gl.getParameter(x.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR), version: gl.getParameter(gl.VERSION), maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE), antialias: !!(gl.getContextAttributes() || {}).antialias }; } catch { return null; }
  }
  const heapMB = () => (performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null);
  function snapshot(label) {
    const w = windowStats(), g = env.game();
    cap(samples, { t: tsec(), label, fps: w.fps, p95: w.p95, max: w.max, heapMB: heapMB(), battery: battery ? +(battery.level * 100).toFixed(0) : null, charging: battery ? battery.charging : null, gpu: gpu(), level: g ? g.level : null, state: g ? g.state : null }, 400);
  }
  function report() {
    const g = env.game(), w = windowStats();
    return {
      generatedAt: new Date().toISOString(), sessionSeconds: tsec(), page: pageInfo(), appVersion: env.version || null,
      device: { userAgent: navigator.userAgent, platform: navigator.platform, hardwareConcurrency: navigator.hardwareConcurrency || null, deviceMemoryGB: navigator.deviceMemory || null, screen: screen.width + 'x' + screen.height, viewport: innerWidth + 'x' + innerHeight, devicePixelRatio: devicePixelRatio, orientation: (screen.orientation && screen.orientation.type) || (innerWidth > innerHeight ? 'landscape' : 'portrait'), secureContext: !!window.isSecureContext, serviceWorker: navigator.serviceWorker && navigator.serviceWorker.controller ? 'controlled' : 'none', online: navigator.onLine, gl: glInfo() },
      frames: { playFrames: frames, meanMs: frames ? +(sumMs / frames).toFixed(2) : 0, p50Ms: pct(0.5), p95Ms: pct(0.95), p99Ms: pct(0.99), maxMs: +maxMs.toFixed(1), over33msPct: frames ? +(100 * over33 / frames).toFixed(2) : 0, over50msPct: frames ? +(100 * over50 / frames).toFixed(2) : 0, over100: over100, last5s: w, note: 'play frames only (level running, not paused); intervals >= 1 s are logged as frame-gap events, not counted' },
      inputToFrameMs: Object.assign(latStats(), { note: 'shot pointerup -> next animation-frame callback; excludes touch-panel sampling and display latency' }),
      frameCallbackMs: Object.assign(callbackStats(), { note: 'main-thread duration for the full game animation-frame callback; does not measure GPU execution or display presentation' }),
      sectionTiming: sectionStats(),
      gpuTimerQuery: gpuTimingStats(),
      longTasks: {
        supported: longTaskSupported,
        observed: longTasks.length,
        over50ms: longTasks.filter((x) => x.durationMs > 50).length,
        over100ms: longTasks.filter((x) => x.durationMs > 100).length,
        maxMs: longTasks.reduce((max, x) => Math.max(max, x.durationMs), 0),
        recent: longTasks.slice(-20)
      },
      now: { gpu: gpu(), heapMB: heapMB(), battery: battery ? { percent: +(battery.level * 100).toFixed(0), charging: battery.charging } : null, game: g ? { mode: g.mode, level: g.level, state: g.state, paused: g.paused, score: g.score, lives: g.lives } : null },
      privacy: 'Contains: device/browser identifiers (user agent, GPU renderer string, screen), frame-time statistics, battery level, game state, console/uncaught error text with the site address removed. Contains no save data, no URL query beyond graphics flags, no cookies, no account data. Nothing is sent anywhere by the game: Copy/Save are manual.',
      samples, events, errors,
    };
  }

  // ---- panel (touch-transparent text; only the four small buttons take input)
  const box = document.createElement('div'); box.id = 'diag';
  box.style.cssText = 'position:fixed;left:4px;z-index:2147483000;max-width:min(62vw,260px);font:10px/1.35 ui-monospace,Menlo,monospace;color:#cfe;background:rgba(0,0,0,.55);padding:3px 5px;border-radius:5px;pointer-events:none;white-space:pre;touch-action:none';
  const txt = document.createElement('div'); const row = document.createElement('div'); row.style.cssText = 'pointer-events:auto;display:flex;gap:4px;margin-top:3px';
  const ta = document.createElement('textarea'); ta.setAttribute('aria-hidden', 'true'); ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  const btn = (label, fn) => { const b = document.createElement('button'); b.textContent = label; b.type = 'button'; b.style.cssText = 'font:11px system-ui;min-width:44px;min-height:30px;padding:0 6px;border-radius:5px;border:1px solid #6a8;background:#123;color:#cfe'; b.addEventListener('click', (e) => { e.stopPropagation(); fn(); }); row.appendChild(b); return b; };
  const say = (m) => { flash = m; setTimeout(() => { if (flash === m) flash = ''; }, 3500); };
  async function copy() {
    const s = JSON.stringify(report(), null, 1);
    try { await navigator.clipboard.writeText(s); say('copied'); return; } catch { /* needs https; fall back */ }
    try { ta.value = s; ta.select(); if (document.execCommand('copy')) { say('copied'); return; } } catch { /* ignore */ }
    say('copy blocked: use Save');
  }
  function save() {
    try { const blob = new Blob([JSON.stringify(report(), null, 1)], { type: 'application/json' }), a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'zuma-report-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); say('saved to Downloads'); }
    catch (e) { say('save failed'); }
  }
  function reset() { for (const k of Object.keys(sectionSamples)) { const b = sectionSamples[k]; b.values.fill(0); b.head = 0; b.n = 0; } hist.fill(0); ringHead = ringN = 0; frames = over33 = over50 = over100 = 0; maxMs = sumMs = 0; lat.length = 0; callbackRing.fill(0); callbackHead = callbackN = 0; callbackSum = callbackMax = 0; callbackStart = -1; gpuQuerySamples.fill(0); gpuQueryHead = gpuQueryN = 0; gpuQueryDisjoint = gpuQuerySkipped = 0; longTasks.length = 0; ev('reset', 'frame, callback, and GPU timing stats cleared'); say('stats reset'); }
  btn('Copy', copy); btn('Save', save); btn('Reset', reset);
  let hiddenPanel = false; btn('×', () => { hiddenPanel = !hiddenPanel; txt.style.display = hiddenPanel ? 'none' : ''; });
  box.append(txt, row); document.body.append(box, ta);

  function refresh() {
    if (!attached) { const g = env.gfx(); if (g && g.canvas) { attached = true; g.canvas.addEventListener('webglcontextlost', () => ev('webgl', 'context lost')); g.canvas.addEventListener('webglcontextrestored', () => ev('webgl', 'context restored')); } }
    box.style.top = Math.max(4, (env.safeTop ? env.safeTop() : 0) + 4) + 'px';
    const w = windowStats(), L = latStats(), p = gpu(), h = heapMB(), s = tsec(), mm = String(Math.floor(s / 60)) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
    txt.textContent = `${w.fps} fps  p95 ${w.p95}ms  max ${w.max}ms (5s)\n` + `t ${mm}  play frames ${frames}  >33ms ${frames ? (100 * over33 / frames).toFixed(1) : 0}%\n` +
      (p && p.quality ? `dpr cap ${p.quality.dprCap}  halo ${p.quality.haloOn ? 'on' : 'off'}  ${p.canvas}\n` : '') + (p && p.geometries !== undefined ? `gpu geo ${p.geometries} tex ${p.textures} prog ${p.programs}\n` : '') +
      `heap ${h === null ? 'n/a' : h + 'MB'}  input>frame ${L.n ? L.mean + 'ms (p95 ' + L.p95 + ')' : 'n/a'}\n` + `callback ${callbackStats().meanMs}ms (p95 ${callbackStats().p95Ms})  long tasks ${longTasks.length}${longTaskSupported ? '' : ' (n/a)'}\n` + `errors ${errors.filter((e) => e.level !== 'info').length}` + (flash ? '  · ' + flash : '');
  }
  setInterval(refresh, 500); setInterval(() => snapshot('auto'), 30000); snapshot('start'); refresh(); ev('diag', 'started');
  function section(name, start, end) {
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return;
    let b = sectionSamples[name];
    if (!b) b = sectionSamples[name] = { values: new Float32Array(300), head: 0, n: 0 };
    b.values[b.head] = end - start; b.head = (b.head + 1) % b.values.length; b.n = Math.min(b.n + 1, b.values.length);
  }
  function sectionStats() {
    const out = {};
    for (const [name, b] of Object.entries(sectionSamples)) {
      if (!b.n) continue;
      const values = Array.from(b.values.slice(0, b.n));
      const sorted = values.sort((a, c) => a - c);
      const sum = values.reduce((n, v) => n + v, 0);
      out[name] = { n: b.n, meanMs: +(sum / b.n).toFixed(3), p95Ms: +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))].toFixed(3), maxMs: +sorted[sorted.length - 1].toFixed(3) };
    }
    return out;
  }
  return { frame, input, report, snapshot, reset, frameStart, frameEnd, section };
}
