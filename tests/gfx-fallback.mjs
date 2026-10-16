// Phase 3 / Gate 3: graphics fallbacks on the REAL Three.js r160 renderer (headless Chromium + SwiftShader).
// Run:  node tests/gfx-fallback.mjs      (needs vendor/three.module.js = real r160; see fetch-three.sh)
// Software GL is slow, so waits are generous; timings here say nothing about phones. Results: tests/gfx-fallback-results.json
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW = process.env.PLAYWRIGHT_MODULE || '/opt/npm-tools/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SHOTS = process.env.SHOT_DIR || path.join(ROOT, 'tests', 'screenshots', 'gfx');
fs.mkdirSync(SHOTS, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/zuma3d-android.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' }); fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
if (!fs.readFileSync(path.join(ROOT, 'vendor/three.module.js'), 'utf8').includes("REVISION = '160'")) { console.error('vendor/three.module.js does not look like real three r160'); process.exit(2); }

const run = (k) => !process.env.ONLY || process.env.ONLY.includes(k);   // ONLY=D runs just section D (development aid; the full run is the evidence)
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const wait = (ms) => new Promise(r => setTimeout(r, ms));
async function newPage({ w = 390, h = 844, dsf = 1, init } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dsf, hasTouch: true, isMobile: true });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('requestfailed', r => { if (!/favicon/.test(r.url())) errors.push('requestfailed: ' + r.url()); });
  if (init) await page.addInitScript(init);
  return { ctx, page, errors };
}
const ready = (page) => page.waitForFunction(() => window.__zuma && window.__zuma.gfx, null, { timeout: 90000, polling: 250 });   // interval polling: section C disables requestAnimationFrame
const visibleScreen = (page) => page.evaluate(() => ['menu', 'error', 'loading'].find(s => !document.getElementById('screen-' + s).classList.contains('hidden')) || 'other');

try {
  // ===================================================== A. override fuzz: nothing may break start-up
  if (run('A')) {
    const cases = ['', '?aa', '?aa=', '?aa=1', '?aa=false', '?aa=0&aa=1', '?dpr', '?dpr=', '?dpr=NaN', '?dpr=Infinity', '?dpr=-1', '?dpr=0', '?dpr=0.0001', '?dpr=1e999', '?dpr=99', '?dpr=1.5abc', '?dpr=%00', '?dpr=%E0%A4%A', '?halo=%3Cscript%3Ealert(1)%3C/script%3E', '?env=0.0', '?adapt=00', '?' + 'x='.repeat(4000), '?aa=0&dpr=0.5&halo=0&env=0&adapt=0'];
    const bad = [], seen = {};
    for (const q of cases) {
      const { ctx, page, errors } = await newPage({ w: 360, h: 640 });
      await page.goto(BASE + '/' + q); let ok = true;
      try { await ready(page); } catch { ok = false; }
      const s = ok ? await visibleScreen(page) : 'timeout';
      const qual = ok ? await page.evaluate(() => window.__zuma.gfx.quality) : null;
      seen[q.slice(0, 40) || '(none)'] = qual ? qual.dprCap + (qual.haloOn ? '' : '/nohalo') : s;
      if (!ok || s !== 'menu' || errors.length || !(qual.dprCap >= 0.5 && qual.dprCap <= 3)) bad.push(q.slice(0, 40) + ' => ' + s + ' ' + JSON.stringify(qual) + ' ' + errors.join('|'));
      await ctx.close();
    }
    check(`override fuzz: ${cases.length} odd/invalid query strings all reach the menu with no errors and dprCap within [0.5,3]`, bad.length === 0, bad.join(' ;; ') || JSON.stringify(seen));
    check('override fuzz: documented semantics — dpr<=0 clamps to 0.5, Infinity/NaN/empty are ignored (default 1.75)', seen['?dpr=0'] === '0.5' && seen['?dpr=-1'] === '0.5' && seen['?dpr=Infinity'] === '1.75' && seen['?dpr=NaN'] === '1.75' && seen['?dpr='] === '1.75' && seen['?dpr=99'] === '3', JSON.stringify(seen));
  }

  // ===================================================== B. lowest quality stays playable and touch mapping is independent of graphics
  if (run('B')) {
    const configs = { default: '/', lowest: '/?aa=0&dpr=0.5&halo=0&env=0&adapt=0', mid: '/?dpr=1' };
    const aims = {}, info = {};
    for (const [name, url] of Object.entries(configs)) {
      const { ctx, page, errors } = await newPage({ w: 360, h: 640, dsf: 3 });
      await page.goto(BASE + url); await ready(page);
      await page.evaluate(() => window.__zuma.startCampaign(1)); await page.waitForFunction(() => window.__zuma.game && window.__zuma.game.state === 'playing', null, { timeout: 60000 });
      await wait(1500);
      const before = await page.evaluate(() => { const r = window.__zuma.gfx.renderer; return { geo: r.info.memory.geometries, tex: r.info.memory.textures, prog: r.info.programs.length, shots: window.__zuma.game.stats.shots, cw: window.__zuma.gfx.canvas.width, ch: window.__zuma.gfx.canvas.height }; });
      // tap-to-shoot at three screen points; aim must be identical across graphics configs (mapping is CSS-pixel based)
      const pts = [[180, 200], [90, 260], [270, 330]]; aims[name] = [];
      for (const [x, y] of pts) {
        await page.waitForFunction(() => window.__zuma.game.shotCd <= 0, null, { timeout: 30000 });
        await page.touchscreen.tap(x, y); await wait(150);
        aims[name].push(await page.evaluate(() => [window.__zuma.aim.dx, window.__zuma.aim.dz].map(v => +v.toFixed(5))));
      }
      const shots = await page.evaluate(() => window.__zuma.game.stats.shots);
      // swap tray tap must not fire; pause / resume; restart x6 ; rotate  (one "cycle"); the first cycle is warm-up (lazy GPU objects), then 2 more cycles must change nothing
      const tray = await page.evaluate(() => { const b = document.getElementById('tray').getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; });
      await page.touchscreen.tap(tray[0], tray[1]); await wait(200);
      const shotsAfterTray = await page.evaluate(() => window.__zuma.game.stats.shots);
      let pausedFrames = true;
      const gpu = () => page.evaluate(() => { const r = window.__zuma.gfx.renderer; return { geo: r.info.memory.geometries, tex: r.info.memory.textures, prog: r.info.programs.length, loops: window.__zuma.loops, state: window.__zuma.game.state, canv: document.querySelectorAll('canvas').length }; });
      const cycle = async () => {
        await page.evaluate(() => window.__zuma.pause()); await wait(300);
        pausedFrames = pausedFrames && await page.evaluate(() => window.__zuma.game.paused);
        await page.evaluate(() => window.__zuma.resume()); await wait(300);
        for (let i = 0; i < 10; i++) { await page.evaluate((n) => { window.__zuma.startCampaign(n); const g = window.__zuma.game; for (let k = 0; k < 50; k++) g.advance(0.1); ['bomb', 'rainbow', 'slow', 'reverse'].forEach((t, j) => { if (g.chain[j + 2]) g.chain[j + 2].token = t; }); }, 1 + i); await wait(300); }   // all 10 levels; test-only: tag four chain marbles with each power-icon kind so every lazily created icon texture exists deterministically (which kinds appear naturally is random)
        await page.setViewportSize({ width: 640, height: 360 }); await wait(2500); await page.setViewportSize({ width: 360, height: 640 }); await wait(2500);
      };
      await cycle(); await cycle(); const warm = await gpu();      // two warm-up cycles: lazily created, finite caches (4 power icons + flash sprite + env map = at most 6 textures)
      await cycle(); const c2 = await gpu(); await cycle(); const after = await gpu();
      await page.screenshot({ path: path.join(SHOTS, `play-${name}-portrait-360.png`) });
      info[name] = { before, warm, c2, after, shots, shotsAfterTray, pausedFrames };
      check(`[${name}] playable: 3 taps fired shots (${shots - before.shots}), tray tap did not fire, pause/resume, 10 level restarts and 2 rotations without errors`, shots - before.shots >= 3 && shotsAfterTray === shots && pausedFrames === true && after.state === 'playing' && errors.length === 0, errors.join('|') + JSON.stringify(info[name]));
      check(`[${name}] resources: after two warm-up cycles two more full cycles (each: pause, all 10 levels, 2 rotations) add NO geometries/textures/programs and textures <= 12 (6 as before Phase 4 + 6 small 64 px mark textures, one per marble type); 1 loop, 1 canvas (counts start ${before.geo}/${before.tex}/${before.prog} -> warm ${warm.geo}/${warm.tex}/${warm.prog} -> ${c2.geo}/${c2.tex}/${c2.prog} -> ${after.geo}/${after.tex}/${after.prog})`, after.geo === warm.geo && after.tex === warm.tex && after.prog === warm.prog && c2.geo === warm.geo && c2.tex === warm.tex && c2.prog === warm.prog && after.tex <= 12 && after.loops === 1 && after.canv === 1, JSON.stringify({ before, warm, c2, after }));
      await ctx.close();
    }
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    check('touch mapping: identical aim vectors for default / dpr=1 / lowest-quality configs at DPR3 (graphics settings do not change input)', same(aims.default, aims.lowest) && same(aims.default, aims.mid), JSON.stringify(aims));
    check('lowest quality really is lower: backing store is ' + info.lowest.before.cw + 'x' + info.lowest.before.ch + ' vs default ' + info.default.before.cw + 'x' + info.default.before.ch, info.lowest.before.cw < info.default.before.cw / 2);
  }

  // ===================================================== C. adaptive quality integration (Phase 4 policy in quality.js; this drives the REAL renderer with synthetic frame intervals: no timing noise)
  // The policy itself is unit-tested exhaustively in tests/quality.test.mjs; here we check the wiring: ladder from overrides, applying/reverting levels,
  // one drawing-buffer reallocation per resolution change, no GPU object growth, ceilings from manual overrides, paused frames, ?adapt=0.
  if (run('C')) {
    const noRaf = () => { window.requestAnimationFrame = () => 0; };
    const HOOK = `(() => { const z = window.__zuma, gfx = z.gfx, r = gfx.renderer, A = { dx: 0, dz: -1, guide: false, pred: null };
      const c = window.__c = { setSize: 0, setPR: 0, events: [], levelSeen: [], A };
      const o1 = r.setSize.bind(r); r.setSize = (...a) => { c.setSize++; return o1(...a); };
      const o2 = r.setPixelRatio.bind(r); r.setPixelRatio = (...a) => { c.setPR++; return o2(...a); };
      window.__feed = (n, msFn) => { for (let i = 0; i < n; i++) { const q = gfx.quality, ms = typeof msFn === 'function' ? msFn(q) : msFn; gfx.frame(z.game, Math.min(0.1, ms / 1000), A, ms); const q2 = gfx.quality; if (q2.level !== q.level) c.events.push([q.level, q2.level, q2.dprCap, q2.haloOn]); } return gfx.quality; };
      window.__mem = () => ({ geo: r.info.memory.geometries, tex: r.info.memory.textures, prog: r.info.programs ? r.info.programs.length : 0 });
    })()`;
    const { ctx, page, errors } = await newPage({ w: 240, h: 360, dsf: 3, init: noRaf });
    await page.goto(BASE + '/'); await ready(page);
    await page.evaluate(() => window.__zuma.startCampaign(1)); await wait(300);
    await page.evaluate(HOOK);
    const lad = await page.evaluate(() => ({ ladder: window.__zuma.gfx.qualityLadder, q: window.__zuma.gfx.quality }));
    check('adaptive: ladder at DPR 3 = 1.75 -> 1.5 -> 1.25 -> 1.0 -> 0.75 with halo off, starts at the top (level 0), adaptive on', lad.ladder.length === 5 && lad.q.level === 0 && lad.q.adaptive && lad.q.dprCap === 1.75 && lad.q.haloOn && lad.ladder.slice(0, 4).every(l => l.halo) && !lad.ladder[4].halo && lad.ladder[4].dpr === 0.75, JSON.stringify(lad.ladder));
    const m0 = await page.evaluate(() => window.__mem());
    // 1. healthy device: fast frames, paused frames, 0.4 s stalls (clamped game dt) -> nothing changes
    const h1 = await page.evaluate(() => { const f = window.__feed, c = window.__c; f(150, 16.7); f(120, 0); for (let i = 0; i < 60; i++) f(1, i % 20 === 0 ? 400 : 16.7); return { q: window.__zuma.gfx.quality, ev: c.events.length, sz: c.setSize, pr: c.setPR }; });
    check('adaptive: fast frames, paused frames (dt=0) and 0.4 s stalls on a healthy device cause no change and no buffer reallocation', h1.q.level === 0 && h1.ev === 0 && h1.sz === 0 && h1.pr === 0, JSON.stringify(h1));
    // 2. STABLE CAP: the frame interval does not depend on quality (a 30 fps cap or any limit we do not control): the downgrade must be reverted
    const cap = await page.evaluate(() => { const f = window.__feed, c = window.__c; c.events.length = 0; c.setPR = 0; c.setSize = 0; f(520, 40); return { q: window.__zuma.gfx.quality, ev: c.events.slice(), pr: c.setPR, sz: c.setSize }; });
    check('adaptive: a limit that quality cannot fix (constant 40 ms) -> one downgrade, then it is REVERTED and the state records capSuspected', cap.ev.length >= 2 && cap.ev[0][1] === 1 && cap.ev[1][1] === 0 && cap.q.level === 0 && cap.q.capSuspected && cap.q.dprCap === 1.75, JSON.stringify(cap));
    check('adaptive: each level change reallocates the drawing buffer exactly once (r160 setPixelRatio calls setSize internally, so setSize count == setPixelRatio count == number of changes; no extra explicit setSize)', cap.pr === cap.ev.length && cap.sz === cap.pr, JSON.stringify({ pr: cap.pr, sz: cap.sz, ev: cap.ev.length }));
    await page.evaluate(() => { window.__zuma.gfx.setQuality({ dprCap: 1.75, halo: true }); });   // manual control stops adaptation (checked below), restore the top for the next scenario
    await ctx.close();

    // 3. quality-dependent overload then recovery, on a fresh page (new controller)
    const p3 = await newPage({ w: 240, h: 360, dsf: 3, init: noRaf });
    await p3.page.goto(BASE + '/'); await ready(p3.page); await p3.page.evaluate(() => window.__zuma.startCampaign(1)); await wait(300); await p3.page.evaluate(HOOK);
    await p3.page.evaluate(() => window.__feed(5, 16.7)); await wait(2500);   // first frames + the deferred reflection-map build, so the memory baseline is after warm-up
    const mA = await p3.page.evaluate(() => window.__mem());
    const ov = await p3.page.evaluate(() => { const f = window.__feed, c = window.__c; f(900, (q) => 70 * Math.pow(0.78, q.level)); return { q: window.__zuma.gfx.quality, ev: c.events.slice(), pr: c.setPR }; });   // 70, 54.6, 42.6, 33.2, 25.9 -> settles at level 4 (0.75, halo off)
    check('adaptive: genuine overload that improves with quality steps down level by level (no skipping, no revert) and settles under the threshold', ov.q.level >= 3 && ov.q.level <= 5 && ov.ev.every(e => e[1] === e[0] + 1) && ov.q.reverts === 0, JSON.stringify(ov.ev));
    const dev0 = await p3.page.evaluate(() => { const c = window.__c; c.events.length = 0; return window.__zuma.gfx.quality.level; });
    const rec = await p3.page.evaluate(() => { const f = window.__feed, c = window.__c; f(2800, 19); return { q: window.__zuma.gfx.quality, ev: c.events.slice() }; });
    check('adaptive: when the load goes away quality is restored one level at a time up to the ceiling and never beyond (levels ' + dev0 + ' -> ' + rec.q.level + ')', rec.q.level === 0 && rec.ev.length === dev0 && rec.ev.every(e => e[1] === e[0] - 1) && rec.q.dprCap === 1.75 && rec.q.haloOn, JSON.stringify(rec.ev));
    const mB = await p3.page.evaluate(() => window.__mem());
    check('adaptive: no GPU object growth across all those quality changes, and no errors', mB.geo === mA.geo && mB.tex === mA.tex && p3.errors.length === 0, JSON.stringify([mA, mB]) + p3.errors.join('|'));
    const exp = await p3.page.evaluate(() => { const g = window.__zuma.gfx; g.setQuality({ dprCap: 1.25 }); const before = g.quality.level; window.__feed(300, 60); return { adaptive: g.quality.adaptive, dpr: g.quality.dprCap, same: g.quality.level === before }; });
    check('adaptive: an explicit setQuality() switches adaptation off (manual control wins)', exp.adaptive === false && exp.dpr === 1.25 && exp.same, JSON.stringify(exp));
    await p3.ctx.close();

    // 4. manual overrides are CEILINGS: ?dpr=1.25&halo=0 -> ladder [1.25 nohalo, 1.0 nohalo, 0.75]; recovery never goes above it
    const p4 = await newPage({ w: 240, h: 360, dsf: 3, init: noRaf });
    await p4.page.goto(BASE + '/?dpr=1.25&halo=0'); await ready(p4.page); await p4.page.evaluate(() => window.__zuma.startCampaign(1)); await wait(300); await p4.page.evaluate(HOOK);
    const l4 = await p4.page.evaluate(() => window.__zuma.gfx.qualityLadder);
    const c4 = await p4.page.evaluate(() => { const f = window.__feed; f(700, (q) => 60 * Math.pow(0.7, q.level)); const low = window.__zuma.gfx.quality.level; f(2200, 12); const q = window.__zuma.gfx.quality; return { low, q }; });
    check('adaptive: ?dpr=1.25&halo=0 are ceilings — the ladder starts there, quality drops under load and comes back only up to them (halo never turns on)', l4.length === 3 && l4[0].dpr === 1.25 && !l4[0].halo && c4.low >= 1 && c4.q.level === 0 && c4.q.dprCap === 1.25 && c4.q.haloOn === false, JSON.stringify({ l4, c4 }));
    await p4.ctx.close();

    // 5. ?adapt=0 never adapts
    const p5 = await newPage({ w: 240, h: 360, dsf: 3, init: noRaf });
    await p5.page.goto(BASE + '/?adapt=0'); await ready(p5.page); await p5.page.evaluate(() => window.__zuma.startCampaign(1)); await wait(300); await p5.page.evaluate(HOOK);
    const a5 = await p5.page.evaluate(() => { window.__feed(400, 90); const q = window.__zuma.gfx.quality; return { q, ev: window.__c.events.length }; });
    check('adaptive: ?adapt=0 disables it completely (400 slow frames, no change)', a5.q.adaptive === false && a5.q.level === 0 && a5.q.dprCap === 1.75 && a5.ev === 0, JSON.stringify(a5));
    await p5.ctx.close();
  }

  // ===================================================== D. context loss / restore (Android reclaims GPU memory when apps are backgrounded)
  // Rendered pixels at every marble centre, keyed by marble id, read while the game is paused so positions are identical before/after.
  const MEASURE = `async () => {
      const { project } = await import('/view.js'); const z = window.__zuma, g = z.game, gfx = z.gfx; const gl = gfx.renderer.getContext();
      gfx.frame(g, 0, { dx: 0, dz: -1, guide: false, pred: null });
      const v = gfx.view, cw = gfx.canvas.width, ch = gfx.canvas.height, out = {}, buf = new Uint8Array(4);
      for (const b of g.chain) { if (b.token || b.color < 0) continue; const p = g.path.pos(b.s, {}), q = project(v, [p.x, 0.5, p.z]); const x = Math.round((q[0] + 1) / 2 * cw), y = Math.round((q[1] + 1) / 2 * ch); if (x < 3 || y < 3 || x > cw - 3 || y > ch - 3) continue; let r = 0, gg = 0, bb = 0, n = 0; for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { gl.readPixels(x + dx, y + dy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf); r += buf[0]; gg += buf[1]; bb += buf[2]; n++; } out[b.id] = [b.color, r / n, gg / n, bb / n]; }
      return out; }`;
  const diffOf = (A, B) => { const ids = Object.keys(A).filter(k => B[k]); const d = ids.map(k => (Math.abs(A[k][1] - B[k][1]) + Math.abs(A[k][2] - B[k][2]) + Math.abs(A[k][3] - B[k][3])) / 3); return { n: ids.length, mean: d.reduce((x, y) => x + y, 0) / Math.max(1, d.length), max: Math.max(0, ...d) }; };
  if (run('D')) for (const rebuild of [true, false]) {
    const { ctx, page, errors } = await newPage({ w: 360, h: 640 });
    await page.goto(BASE + '/'); await ready(page);
    await page.evaluate(() => window.__zuma.startCampaign(7)); await page.waitForFunction(() => window.__zuma.game.state === 'playing' && window.__zuma.gfx.envBuildMs > 0, null, { timeout: 90000 });
    await page.evaluate(() => { for (let i = 0; i < 60 * 22; i++) window.__zuma.game.advance(1 / 60); window.__zuma.pause(); });
    await wait(500);
    await page.evaluate(() => window.__zuma.gfx.setMarks(false));   // this test measures REFLECTIONS on the marble centre; the dark mark glyph there is identical before/after and would dilute the metric (the marks have their own tests)
    const m0 = await page.evaluate(`(${MEASURE})()`);
    if (!rebuild) await page.evaluate(() => { window.__zuma.gfx.restoreContext = () => {}; });     // NEGATIVE CONTROL: skip the env-map rebuild to prove this check can fail
    await page.evaluate(() => { const gl = window.__zuma.gfx.renderer.getContext(); window.__lose = gl.getExtension('WEBGL_lose_context'); window.__lose.loseContext(); });
    await wait(1500);
    const lost = await page.evaluate(() => ({ paused: window.__zuma.game.paused, err: !document.getElementById('screen-error').classList.contains('hidden'), title: document.getElementById('error-title').textContent, msg: document.getElementById('error-msg').textContent }));
    if (rebuild) check('context loss: game pauses and the player is told what happened (not a crash or blank canvas)', lost.paused && lost.err && /interrupted/i.test(lost.title) && /reclaimed graphics memory/i.test(lost.msg), JSON.stringify(lost));
    await page.evaluate(() => window.__lose.restoreContext()); await wait(4000);
    const rest = await page.evaluate(() => ({ errVisible: !document.getElementById('screen-error').classList.contains('hidden'), pauseVisible: !document.getElementById('screen-pause').classList.contains('hidden'), paused: window.__zuma.game.paused, isLost: window.__zuma.gfx.renderer.getContext().isContextLost(), title: document.getElementById('error-title').textContent, env: window.__zuma.gfx.envBuildMs }));
    const m1 = await page.evaluate(`(${MEASURE})()`); const d = diffOf(m0, m1);
    if (rebuild) {
      check('context restore: error screen replaced by the pause screen, game still paused (player taps Resume), reflection map rebuilt', !rest.errVisible && rest.pauseVisible && rest.paused && !rest.isLost && rest.title === 'Could not start' && rest.env > 0, JSON.stringify(rest));
      check(`context restore: the same ${d.n} marbles render the same after recovery (mean abs RGB diff ${d.mean.toFixed(2)}, worst ${d.max.toFixed(1)} of 255)`, d.n >= 20 && d.mean < 6 && d.max < 40, JSON.stringify(d));
      const mk = await page.evaluate(() => { const z = window.__zuma, g = z.gfx, gl = g.renderer.getContext(), A = { dx: 0, dz: -1, guide: false, pred: null }, w = g.canvas.width, h = g.canvas.height, a = new Uint8Array(w * h * 4), b = new Uint8Array(w * h * 4);
        g.setMarks(true); g.frame(z.game, 0, A); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, a); g.setMarks(false); g.frame(z.game, 0, A); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, b); g.setMarks(true);
        let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 90) n++; return { changedPx: n }; });
      check('context restore: the mark textures are re-uploaded (marks ON vs OFF still differ in many pixels after recovery)', mk.changedPx > 300, JSON.stringify(mk));
      await page.evaluate(() => window.__zuma.resume()); await wait(1500);
      const adv = await page.evaluate(() => { const g = window.__zuma.game; return { state: g.state, paused: g.paused, loops: window.__zuma.loops }; });
      check('context restore: game continues (not paused, one render loop) and shooting still works', adv.state === 'playing' && !adv.paused && adv.loops === 1 && await page.evaluate(() => { const g = window.__zuma.game, n = g.stats.shots; g.shotCd = 0; return g.fire(0, -1) && g.stats.shots === n + 1; }));
      await page.screenshot({ path: path.join(SHOTS, 'after-context-restore-360.png') });
      check('context loss/restore: no uncaught page errors', errors.length === 0, errors.join('|'));
    } else {
      check(`negative control: WITHOUT the reflection-map rebuild the same comparison is clearly worse (mean ${d.mean.toFixed(2)} vs limit 6), so the check can fail`, d.mean >= 6 || d.max >= 40, JSON.stringify(d));
    }
    await ctx.close();
  }
} catch (e) {
  check('gfx-fallback harness completed without exception', false, String(e && e.stack || e));
} finally {
  await browser.close(); server.close();
}
const failed = results.filter(r => !r.ok).length, n = results.filter(r => !/^INFO/.test(r.name)).length;
fs.writeFileSync(path.join(ROOT, 'tests', 'gfx-fallback-results.json'), JSON.stringify({ n, failed, results }, null, 1));
console.log(`\n${n - failed}/${n} gfx-fallback checks passed`);
process.exit(failed ? 1 : 0);
