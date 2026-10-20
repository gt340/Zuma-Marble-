// render.js — Three.js presentation layer. Reads game state; never changes it.
// Perf design: ONE InstancedMesh for the whole chain (+ glow + blob-shadow instances), shared geometry/materials,
// fixed pools for projectiles / particles / flashes / rings, no per-frame allocation, DPR cap with adaptive downgrade.
import { R, D, MUZZLE, FEED_S, BOMB_REACH } from './core.js';
import { fitView, footprint, project, BALL_Y, PITCH } from './view.js';
import { AdaptiveQuality } from './quality.js';

export const COLOR_HEX = [0xe8243c, 0x2fd46a, 0x3a7bff, 0xffe03a, 0xc05bff, 0xff6a1a, 0x00d8d8, 0xff62a8]; // red, green, blue, yellow, purple, orange, cyan, pink
export const COLOR_CSS = ['#e8243c', '#2fd46a', '#3a7bff', '#ffe03a', '#c05bff', '#ff6a1a', '#00d8d8', '#ff62a8'];

// ------------------------------------------------------------------ vector icons (canvas) — one source for 3D sprites and DOM buttons
export function drawIcon(ctx, kind, s, fg = '#ffffff') {
  const c = s / 2;
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = fg; ctx.fillStyle = fg;
  if (kind === 'bomb') {
    ctx.beginPath(); ctx.arc(c - s * 0.04, c + s * 0.08, s * 0.28, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = s * 0.07; ctx.beginPath(); ctx.moveTo(c + s * 0.14, c - s * 0.14); ctx.quadraticCurveTo(c + s * 0.26, c - s * 0.3, c + s * 0.34, c - s * 0.24); ctx.stroke();
    ctx.strokeStyle = '#ffb347'; ctx.lineWidth = s * 0.05;
    for (let a = 0; a < 6; a++) { const t = a * Math.PI / 3, x = c + s * 0.36, y = c - s * 0.22; ctx.beginPath(); ctx.moveTo(x + Math.cos(t) * s * 0.03, y + Math.sin(t) * s * 0.03); ctx.lineTo(x + Math.cos(t) * s * 0.1, y + Math.sin(t) * s * 0.1); ctx.stroke(); }
  } else if (kind === 'rainbow') {
    const cols = ['#ff5b6b', '#ffd23a', '#4fd1ff'];
    for (let i = 0; i < 3; i++) { ctx.strokeStyle = cols[i]; ctx.lineWidth = s * 0.1; ctx.beginPath(); ctx.arc(c, c + s * 0.2, s * (0.36 - i * 0.12), Math.PI, Math.PI * 2); ctx.stroke(); }
  } else if (kind === 'slow') {
    ctx.lineWidth = s * 0.07;
    for (let a = 0; a < 3; a++) {
      const t = a * Math.PI / 3, dx = Math.cos(t) * s * 0.34, dy = Math.sin(t) * s * 0.34;
      ctx.beginPath(); ctx.moveTo(c - dx, c - dy); ctx.lineTo(c + dx, c + dy); ctx.stroke();
      for (const sg of [-1, 1]) { const ex = c + dx * sg, ey = c + dy * sg, px = -Math.sin(t) * s * 0.08, py = Math.cos(t) * s * 0.08, bx = c + dx * 0.68 * sg, by = c + dy * 0.68 * sg; ctx.beginPath(); ctx.moveTo(bx - px, by - py); ctx.lineTo(ex, ey); ctx.lineTo(bx + px, by + py); ctx.stroke(); }
    }
  } else if (kind === 'reverse') {
    for (const ox of [-0.02, 0.26]) { ctx.beginPath(); ctx.moveTo(c + s * ox - s * 0.04, c); ctx.lineTo(c + s * ox + s * 0.2, c - s * 0.24); ctx.lineTo(c + s * ox + s * 0.2, c + s * 0.24); ctx.closePath(); ctx.fill(); }
    ctx.restore(); return;
  }
  ctx.restore();
}
// ------------------------------------------------------------------ marble marks: a non-colour identity cue (shape per marble type)
// Index = colour index (COLOR_HEX order: red, green, blue, yellow, purple, orange, cyan, pink). Shapes differ in topology/silhouette, not just size, so they
// stay apart at ~8 px: plus, triangle, two bars, cross (x), dot, ring, diamond, star. Dark ink: readable on every marble hue and under common colour-vision deficiencies.
export const MARK_NAMES = ['plus', 'triangle', 'bars', 'cross', 'dot', 'ring', 'diamond', 'star'];
export function drawMark(ctx, ci, s) {
  const k = s / 64, ink = 'rgba(14,10,30,0.92)';
  ctx.save(); ctx.scale(k, k); ctx.fillStyle = ink; ctx.strokeStyle = ink; ctx.lineJoin = 'round';
  switch (ci) {
    case 0: ctx.fillRect(26, 11, 12, 42); ctx.fillRect(11, 26, 42, 12); break;                                   // plus
    case 1: ctx.beginPath(); ctx.moveTo(32, 9); ctx.lineTo(55, 50); ctx.lineTo(9, 50); ctx.closePath(); ctx.fill(); break;   // triangle (apex up)
    case 2: ctx.fillRect(10, 12, 44, 11); ctx.fillRect(10, 41, 44, 11); break;                                   // two bars
    case 3: ctx.lineWidth = 12; ctx.lineCap = 'butt'; ctx.beginPath(); ctx.moveTo(14, 14); ctx.lineTo(50, 50); ctx.moveTo(50, 14); ctx.lineTo(14, 50); ctx.stroke(); break;   // X
    case 4: ctx.beginPath(); ctx.arc(32, 32, 11.5, 0, Math.PI * 2); ctx.fill(); break;                              // dot
    case 5: ctx.lineWidth = 11; ctx.beginPath(); ctx.arc(32, 32, 17, 0, Math.PI * 2); ctx.stroke(); break;        // ring
    case 6: ctx.beginPath(); ctx.moveTo(32, 7); ctx.lineTo(57, 32); ctx.lineTo(32, 57); ctx.lineTo(7, 32); ctx.closePath(); ctx.fill(); break; // diamond
    case 7: ctx.beginPath(); ctx.moveTo(32, 8); ctx.lineTo(38, 25); ctx.lineTo(56, 26); ctx.lineTo(42, 37); ctx.lineTo(46, 55); ctx.lineTo(32, 44); ctx.lineTo(18, 55); ctx.lineTo(22, 37); ctx.lineTo(8, 26); ctx.lineTo(26, 25); ctx.closePath(); ctx.fill(); break; // star
    default: break;
  }
  ctx.restore();
}
const markCache = {};
export function markURL(ci, size = 64) {
  const key = ci + ':' + size;
  if (markCache[key]) return markCache[key];
  try { const cv = document.createElement('canvas'); cv.width = cv.height = size; drawMark(cv.getContext('2d'), ci, size); return (markCache[key] = cv.toDataURL('image/png')); } catch { return ''; }
}
const iconCache = {};
export function iconURL(kind, size = 96) {
  const key = kind + size;
  if (iconCache[key]) return iconCache[key];
  try {
    const cv = document.createElement('canvas'); cv.width = cv.height = size;
    drawIcon(cv.getContext('2d'), kind, size);
    return (iconCache[key] = cv.toDataURL('image/png'));
  } catch { return ''; }
}

// ------------------------------------------------------------------ renderer
export function createGfx(THREE, container, opts = {}) {
  const T = THREE;
  const onSectionTiming = typeof opts.onSectionTiming === 'function' ? opts.onSectionTiming : null;
  const onGpuTiming = typeof opts.onGpuTiming === 'function' ? opts.onGpuTiming : null;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  let dprCap = opts.dprCap || (coarse ? 1.75 : 2);
  const renderer = new T.WebGLRenderer({ antialias: opts.antialias !== false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, dprCap));
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  const canvas = renderer.domElement;

  // Debug-only, non-blocking GPU timer queries. Never wait for a query result on the render path.
  let gpuTimer = null;
  function gpuTimingEvent(sample) { if (onGpuTiming) { try { onGpuTiming(sample); } catch { /* diagnostics must not affect rendering */ } } }
  if (onGpuTiming) {
    try {
      const gl = renderer.getContext();
      const ext2 = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      const ext1 = ext2 ? null : gl.getExtension('EXT_disjoint_timer_query');
      if (ext2 && typeof gl.createQuery === 'function' && typeof gl.beginQuery === 'function') {
        gpuTimer = { gl, ext: ext2, api: 'webgl2', pending: [], active: null };
      } else if (ext1 && typeof ext1.createQueryEXT === 'function') {
        gpuTimer = { gl, ext: ext1, api: 'webgl1', pending: [], active: null };
      }
      gpuTimingEvent(gpuTimer
        ? { type: 'status', status: 'supported', api: gpuTimer.api }
        : { type: 'status', status: 'unsupported', reason: 'EXT_disjoint_timer_query unavailable' });
    } catch {
      gpuTimingEvent({ type: 'status', status: 'unsupported', reason: 'timer-query initialization failed' });
    }
  }
  function pollGpuQueries() {
    if (!gpuTimer) return;
    const { gl, ext, api, pending } = gpuTimer;
    let disjoint = false;
    try { disjoint = !!gl.getParameter(ext.GPU_DISJOINT_EXT); } catch { disjoint = true; }
    if (disjoint) {
      for (const item of pending.splice(0)) {
        try { if (api === 'webgl2') gl.deleteQuery(item.query); else ext.deleteQueryEXT(item.query); } catch { /* ignore */ }
      }
      gpuTimingEvent({ type: 'disjoint' });
      return;
    }
    for (let i = pending.length - 1; i >= 0; i--) {
      const item = pending[i];
      let available = false;
      try {
        available = api === 'webgl2'
          ? gl.getQueryParameter(item.query, gl.QUERY_RESULT_AVAILABLE)
          : ext.getQueryObjectEXT(item.query, ext.QUERY_RESULT_AVAILABLE_EXT);
      } catch { /* retry on a later frame */ }
      if (!available) continue;
      pending.splice(i, 1);
      try {
        const ns = api === 'webgl2'
          ? gl.getQueryParameter(item.query, gl.QUERY_RESULT)
          : ext.getQueryObjectEXT(item.query, ext.QUERY_RESULT_EXT);
        if (Number.isFinite(ns) && ns >= 0) gpuTimingEvent({ type: 'sample', gpuMs: ns / 1e6 });
      } catch { /* ignore invalid query results */ }
      try { if (api === 'webgl2') gl.deleteQuery(item.query); else ext.deleteQueryEXT(item.query); } catch { /* ignore */ }
    }
  }
  function beginGpuQuery() {
    if (!gpuTimer) return null;
    pollGpuQueries();
    if (gpuTimer.pending.length >= 8 || gpuTimer.active) {
      gpuTimingEvent({ type: 'skipped' });
      return null;
    }
    try {
      const q = gpuTimer.api === 'webgl2' ? gpuTimer.gl.createQuery() : gpuTimer.ext.createQueryEXT();
      if (!q) { gpuTimingEvent({ type: 'skipped' }); return null; }
      if (gpuTimer.api === 'webgl2') gpuTimer.gl.beginQuery(gpuTimer.ext.TIME_ELAPSED_EXT, q);
      else gpuTimer.ext.beginQueryEXT(gpuTimer.ext.TIME_ELAPSED_EXT, q);
      gpuTimer.active = q;
      return q;
    } catch {
      gpuTimingEvent({ type: 'status', status: 'error', reason: 'could not begin GPU query' });
      gpuTimer = null;
      return null;
    }
  }
  function endGpuQuery(q) {
    if (!gpuTimer || !q || gpuTimer.active !== q) return;
    try {
      if (gpuTimer.api === 'webgl2') gpuTimer.gl.endQuery(gpuTimer.ext.TIME_ELAPSED_EXT);
      else gpuTimer.ext.endQueryEXT(gpuTimer.ext.TIME_ELAPSED_EXT);
      gpuTimer.pending.push({ query: q });
    } catch {
      try { if (gpuTimer.api === 'webgl2') gpuTimer.gl.deleteQuery(q); else gpuTimer.ext.deleteQueryEXT(q); } catch { /* ignore */ }
      gpuTimingEvent({ type: 'status', status: 'error', reason: 'could not end GPU query' });
      gpuTimer = null;
    } finally {
      if (gpuTimer) gpuTimer.active = null;
    }
  }
  canvas.style.touchAction = 'none';
  container.appendChild(canvas);

  const scene = new T.Scene();
  scene.background = new T.Color(0x0b0918);
  scene.fog = new T.FogExp2(0x0b0918, 0.0055);
  const camera = new T.PerspectiveCamera(48, 1, 0.5, 160);

  // ---- lights (directional/hemisphere only: predictable across devices and cheap)
  scene.add(new T.HemisphereLight(0x9aa6ff, 0x2a1d3a, 0.9));
  const key = new T.DirectionalLight(0xffe9cf, 2.1); key.position.set(9, 26, 14); scene.add(key);
  const rim = new T.DirectionalLight(0x6f86ff, 0.8); rim.position.set(-12, 10, -10); scene.add(rim);

  // ---- tiny procedural environment so glass marbles get believable reflections (optional; failure is harmless).
  // Measured (software WebGL, relative): applying the environment map to EVERY standard material made frames ~2.6x slower than none, and
  // generating it blocks start-up. So: (1) only materials that need reflections sample it (marbles, metals) — the big ground disc does not;
  // (2) it is generated right after the first rendered frame instead of during start-up. opts.envScope = 'all' restores the old behaviour.
  let envTex = null, envStarted = false, envScheduled = false, envBuildMs = 0;
  const envMats = [];
  const E = (m) => { envMats.push(m); if (envTex) m.envMap = envTex; return m; };       // register a material that should reflect the environment
  function buildEnv() {
    if (envStarted || opts.envMap === false) return; envStarted = true;
    const t0 = (globalThis.performance || Date).now();
    try {
      const envScene = new T.Scene(); envScene.background = new T.Color(0x14102a);
      const panel = (c, x, y, z, sx, sy, sz) => { const m = new T.Mesh(new T.BoxGeometry(sx, sy, sz), new T.MeshBasicMaterial({ color: c })); m.position.set(x, y, z); envScene.add(m); };
      panel(0xfff1d6, 0, 14, 4, 16, 0.5, 6); panel(0x7f95ff, -14, 4, 0, 0.5, 8, 14); panel(0xffa05a, 14, 3, -4, 0.5, 7, 12); panel(0xffffff, 0, 2, 14, 12, 4, 0.5);
      const pm = new T.PMREMGenerator(renderer);
      envTex = pm.fromScene(envScene, 0.03).texture;
      pm.dispose();
      envScene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      if (opts.envScope === 'all') scene.environment = envTex;
      else for (const m of envMats) { m.envMap = envTex; m.needsUpdate = true; }
      owned.push(envTex);
    } catch (e) { /* no env map: lights alone still give highlights */ }
    envBuildMs = (globalThis.performance || Date).now() - t0;
  }

  /** After a WebGL context loss + restore three.js re-uploads geometries/textures lazily, but render-target contents (the reflection map) are gone: rebuild it. */
  function restoreContext() {
    clearFx(); envTex = null; envStarted = false; envBuildMs = 0;
    if (opts.envMap !== false) { buildEnv(); }
    appliedR = -1; appliedW = -1; applySize();      // drawing buffer is new after a context restore: re-apply ratio and size
  }

  // ---- shared geometry / material caches
  const owned = [];                                      // everything with .dispose() created here
  const own = (o) => { owned.push(o); return o; };
  const ballGeo = own(new T.SphereGeometry(R, 18, 12));
  const haloGeo = own(new T.SphereGeometry(R * 1.32, 12, 8));
  const blobGeo = own(new T.CircleGeometry(R * 1.2, 14)); blobGeo.rotateX(-Math.PI / 2);
  const partGeo = own(new T.SphereGeometry(1, 6, 5));
  const unitRing = own(new T.RingGeometry(0.93, 1, 56)); unitRing.rotateX(-Math.PI / 2);
  const matCache = new Map();
  const marbleMat = (ci) => {
    if (!matCache.has(ci)) matCache.set(ci, E(own(new T.MeshStandardMaterial({ color: COLOR_HEX[ci], roughness: 0.12, metalness: 0.12, emissive: COLOR_HEX[ci], emissiveIntensity: 0.22, envMapIntensity: 1.15 }))));
    return matCache.get(ci);
  };
  const basicCache = new Map();
  const basicMat = (hex, opacity = 1, additive = false) => {
    const k = hex + ':' + opacity + ':' + additive;
    if (!basicCache.has(k)) basicCache.set(k, own(new T.MeshBasicMaterial({ color: hex, transparent: opacity < 1 || additive, opacity, depthWrite: !additive && opacity >= 1, blending: additive ? T.AdditiveBlending : T.NormalBlending, fog: false })));
    return basicCache.get(k);
  };
  const bombMat = E(own(new T.MeshStandardMaterial({ color: 0x14141a, roughness: 0.25, metalness: 0.85, emissive: 0xff3a00, emissiveIntensity: 0.7, envMapIntensity: 1.2 })));
  const rainbowMat = E(own(new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, metalness: 0.3, emissive: 0xffaaaa, emissiveIntensity: 0.6, envMapIntensity: 1.3 })));

  // ---- static scenery
  const ground = new T.Mesh(own(new T.CircleGeometry(34, 72)), own(new T.MeshStandardMaterial({ color: 0x1b1731, roughness: 0.92, metalness: 0.05 })));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
  for (let i = 1; i <= 4; i++) {
    const ring = new T.Mesh(own(new T.RingGeometry(3.6 * i, 3.6 * i + 0.07, 72)), basicMat(0x39346a, 0.45));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; scene.add(ring);
  }
  const stone = own(new T.MeshStandardMaterial({ color: 0x4a4268, roughness: 0.75, metalness: 0.12 }));
  const gold = E(own(new T.MeshStandardMaterial({ color: 0xd2a82c, metalness: 0.85, roughness: 0.3, emissive: 0x3a2a00, emissiveIntensity: 0.25 })));
  const pillarGeo = own(new T.CylinderGeometry(0.4, 0.5, 1, 10)), capGeo = own(new T.BoxGeometry(1.15, 0.28, 1.15));
  [[-13, -7, 4.6], [13, -7, 4.2], [-13, 7, 4.9], [13, 7, 4.4], [-9, -13, 4.0], [9, -13, 4.7], [0, -15, 5.0], [-9, 13, 4.3], [9, 13, 4.1]].forEach(([x, z, h]) => {
    const p = new T.Mesh(pillarGeo, stone); p.scale.y = h; p.position.set(x, h / 2, z); scene.add(p);
    const cap = new T.Mesh(capGeo, gold); cap.position.set(x, h + 0.12, z); scene.add(cap);
  });
  const platform = new T.Mesh(own(new T.CylinderGeometry(2.5, 2.8, 0.4, 36)), own(new T.MeshStandardMaterial({ color: 0x2b2850, metalness: 0.4, roughness: 0.5 })));
  platform.position.y = 0.2; scene.add(platform);
  const platRing = new T.Mesh(own(new T.TorusGeometry(2.2, 0.07, 8, 56)), gold); platRing.rotation.x = Math.PI / 2; platRing.position.y = 0.42; scene.add(platRing);

  // drifting motes
  const MOTES = 70, motePos = new Float32Array(MOTES * 3);
  for (let i = 0; i < MOTES; i++) { motePos[i * 3] = (Math.random() - 0.5) * 34; motePos[i * 3 + 1] = Math.random() * 9 + 0.6; motePos[i * 3 + 2] = (Math.random() - 0.5) * 30; }
  const moteGeo = own(new T.BufferGeometry()); moteGeo.setAttribute('position', new T.BufferAttribute(motePos, 3));
  const motes = new T.Points(moteGeo, own(new T.PointsMaterial({ color: 0xffd27a, size: 0.12, transparent: true, opacity: 0.5, blending: T.AdditiveBlending, depthWrite: false })));
  scene.add(motes);

  // ---- frog shooter (bright green body, cannon along +Z at marble height)
  const frog = new T.Group(); scene.add(frog);
  const cannonGrp = new T.Group(); frog.add(cannonGrp);
  {
    const bodyMat = own(new T.MeshStandardMaterial({ color: 0x1db954, roughness: 0.4, metalness: 0.12, emissive: 0x0a3a1a, emissiveIntensity: 0.2 }));
    const body = new T.Mesh(own(new T.SphereGeometry(1.1, 26, 18)), bodyMat); body.scale.set(1, 0.78, 1.05); body.position.set(0, 0.85, -0.1); frog.add(body);
    const belly = new T.Mesh(own(new T.SphereGeometry(0.7, 16, 12)), own(new T.MeshStandardMaterial({ color: 0xa8e6a0, roughness: 0.55 }))); belly.scale.set(0.9, 0.6, 0.6); belly.position.set(0, 0.55, 0.55); frog.add(belly);
    const eyeW = own(new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 })), pupilM = own(new T.MeshStandardMaterial({ color: 0x111111 }));
    const eyeG = own(new T.SphereGeometry(0.28, 12, 10)), pupG = own(new T.SphereGeometry(0.13, 8, 8));
    [-0.45, 0.45].forEach(x => { const e = new T.Mesh(eyeG, eyeW); e.position.set(x, 1.55, 0.2); frog.add(e); const p = new T.Mesh(pupG, pupilM); p.position.set(x, 1.58, 0.44); frog.add(p); });
    const jewel = new T.Mesh(E(own(new T.OctahedronGeometry(0.2, 0))), own(new T.MeshStandardMaterial({ color: 0xffd700, metalness: 0.9, roughness: 0.15, emissive: 0xaa7700, emissiveIntensity: 0.5 })));
    jewel.position.set(0, 1.35, -0.9); jewel.name = 'jewel'; frog.add(jewel);
    const barrel = new T.Mesh(own(new T.CylinderGeometry(0.4, 0.5, 1.0, 16)), own(new T.MeshStandardMaterial({ color: 0x0d8a3a, roughness: 0.4, metalness: 0.3 })));
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, BALL_Y, 1.0); cannonGrp.add(barrel);
    const rimM = new T.Mesh(own(new T.TorusGeometry(0.46, 0.07, 8, 24)), gold); rimM.position.set(0, BALL_Y, 1.52); cannonGrp.add(rimM);
  }
  const jewelMesh = frog.getObjectByName('jewel');
  const shooter = new T.Mesh(ballGeo, marbleMat(0)); shooter.position.set(0, BALL_Y, 1.2); cannonGrp.add(shooter);
  const shooterGlow = new T.Mesh(haloGeo, basicMat(0xffffff, 0.14, true)); shooter.add(shooterGlow);

  // ---- skull (danger endpoint)
  const skull = new T.Group(); scene.add(skull);
  const eyeMat = own(new T.MeshBasicMaterial({ color: 0xff2a1a, fog: false }));
  const eyeMeshes = [];
  {
    const bone = own(new T.MeshStandardMaterial({ color: 0xf0e6d0, roughness: 0.5, metalness: 0.08 })), dark = own(new T.MeshStandardMaterial({ color: 0x120a0a }));
    const head = new T.Mesh(own(new T.SphereGeometry(1.15, 20, 14)), bone); head.scale.set(1, 1.05, 1.0); head.position.y = 0.9; skull.add(head);
    [-0.38, 0.38].forEach(x => {
      const so = new T.Mesh(own(new T.SphereGeometry(0.3, 10, 8)), dark); so.position.set(x, 1.05, 0.85); skull.add(so);
      const eg = new T.Mesh(own(new T.SphereGeometry(0.13, 8, 6)), eyeMat); eg.position.set(x, 1.05, 1.02); skull.add(eg); eyeMeshes.push(eg);
    });
    const jaw = new T.Mesh(own(new T.BoxGeometry(1.3, 0.34, 0.9)), bone); jaw.position.set(0, 0.15, 0.55); skull.add(jaw);
    const mouth = new T.Mesh(own(new T.CircleGeometry(0.62, 20)), own(new T.MeshBasicMaterial({ color: 0x000000 }))); mouth.rotation.x = -Math.PI / 2; mouth.position.set(0, 0.05, 1.05); skull.add(mouth);
    [-0.6, 0.6].forEach(x => { const h = new T.Mesh(own(new T.ConeGeometry(0.16, 0.75, 6)), bone); h.position.set(x, 2.0, -0.1); h.rotation.z = x > 0 ? -0.3 : 0.3; skull.add(h); });
  }

  // ---- per-level objects (track ribbons + entrance gate) — rebuilt, old geometry disposed
  const trackGroup = new T.Group(); scene.add(trackGroup);
  let trackOwned = [];
  const gate = new T.Group(); scene.add(gate);
  let currentPath = null, view = null, W = 1, H = 1;
  function ribbon(path, offset, half, y, mat) {
    const N = Math.ceil(path.L / 0.35), pos = new Float32Array((N + 1) * 2 * 3), idx = [];
    const p = { x: 0, z: 0 }, t = { x: 0, z: 0 };
    for (let i = 0; i <= N; i++) {
      const s = Math.min(path.L, i * 0.35); path.pos(s, p); path.tan(s, t);
      const nx = -t.z, nz = t.x;
      pos.set([p.x + nx * (offset + half), y, p.z + nz * (offset + half), p.x + nx * (offset - half), y, p.z + nz * (offset - half)], i * 6);
      if (i < N) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new T.Mesh(g, mat); trackOwned.push(g); trackGroup.add(m);
  }
  const trackMat = new T.MeshStandardMaterial({ color: 0x241f45, roughness: 0.8, metalness: 0.1, emissive: 0x0d0a22, emissiveIntensity: 0.6, side: T.DoubleSide });
  const edgeMat = E(new T.MeshStandardMaterial({ color: 0xb8932a, roughness: 0.4, metalness: 0.7, emissive: 0x3a2a00, emissiveIntensity: 0.4, side: T.DoubleSide }));
  const dangerMat = new T.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0, side: T.DoubleSide, depthWrite: false });
  owned.push(trackMat, edgeMat, dangerMat);
  let dangerRibbonMesh = null;

  function setLevel(path) {
    currentPath = path;
    for (const g of trackOwned) g.dispose();
    trackOwned = []; trackGroup.clear();
    ribbon(path, 0, 0.74, 0.03, trackMat);
    ribbon(path, 0.82, 0.07, 0.05, edgeMat); ribbon(path, -0.82, 0.07, 0.05, edgeMat);
    // red warning strip over the last stretch of the path, fades in with danger
    { const N = Math.ceil(11 / 0.35), pos = new Float32Array((N + 1) * 6), idx = [], p = { x: 0, z: 0 }, t = { x: 0, z: 0 };
      for (let i = 0; i <= N; i++) { const s = Math.max(0, path.L - 11 + i * 0.35); path.pos(s, p); path.tan(s, t); const nx = -t.z, nz = t.x; pos.set([p.x + nx * 0.74, 0.06, p.z + nz * 0.74, p.x - nx * 0.74, 0.06, p.z - nz * 0.74], i * 6); if (i < N) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); } }
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      dangerRibbonMesh = new T.Mesh(g, dangerMat); trackOwned.push(g); trackGroup.add(dangerRibbonMesh); }
    // skull at the end, facing the incoming chain
    const e = path.pos(path.L, {}), te = path.tan(path.L, {});
    skull.position.set(e.x + te.x * 1.1, 0, e.z + te.z * 1.1); skull.rotation.y = Math.atan2(-te.x, -te.z); skull.userData.base = { x: skull.position.x, z: skull.position.z };
    // entrance gate: two stone posts flanking the start of the track
    gate.clear();
    const b = path.pos(0, {}), tb = path.tan(0, {});
    for (const sg of [-1, 1]) {
      const post = new T.Mesh(pillarGeo, stone); post.scale.y = 2.2; post.position.set(b.x - tb.z * sg * 1.25 - tb.x * 0.2, 1.1, b.z + tb.x * sg * 1.25 - tb.z * 0.2); gate.add(post);
      const cap = new T.Mesh(capGeo, gold); cap.position.set(post.position.x, 2.3, post.position.z); gate.add(cap);
    }
    applyView();
  }

  // ---- chain instances
  const CAP = 180;
  const chainMat = E(own(new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.12, metalness: 0.12, emissive: 0x222222, emissiveIntensity: 0.35, envMapIntensity: 1.15 })));
  const chainIM = new T.InstancedMesh(ballGeo, chainMat, CAP);
  const haloIM = new T.InstancedMesh(haloGeo, own(new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.13, blending: T.AdditiveBlending, depthWrite: false, fog: false })), CAP);
  const blobIM = new T.InstancedMesh(blobGeo, own(new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false })), CAP);
  for (const im of [chainIM, haloIM, blobIM]) { im.frustumCulled = false; im.count = 0; scene.add(im); }
  // marble marks: one tiny instanced quad layer per marble type (no shader changes; 6 extra draw calls at most), flat on top of each marble
  let marksOn = opts.marks !== false;
  const markGeo = own(new T.PlaneGeometry(0.8, 0.8)); markGeo.rotateX(-PITCH);   // decal faces the camera (normal = towards the camera, which looks down at PITCH): drawn unforeshortened on the marble's visible face
  const MN_Y = Math.sin(PITCH), MN_Z = Math.cos(PITCH);
  // Decal centre = marble centre + dist along the line of sight to the camera, so it projects exactly at the marble's visual centre for every marble on screen
  // (a fixed normal drifted up to ~0.2 marble-diameters off-centre towards the screen edges). Orientation stays the camera's (no roll/yaw: right = +x).
  const facePos = (out, cx, cy, cz, dist) => {
    let nx = 0, ny = MN_Y, nz = MN_Z;
    if (view) { nx = view.pos[0] - cx; ny = view.pos[1] - cy; nz = view.pos[2] - cz; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l; }
    out.set(cx + nx * dist, cy + ny * dist, cz + nz * dist);
  };
  let maxAniso = 1; try { maxAniso = Math.min(4, renderer.capabilities.getMaxAnisotropy()); } catch { /* stub */ }
  const markMats = [], markIMs = [];
  for (let ci = 0; ci < COLOR_HEX.length; ci++) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64; drawMark(cv.getContext('2d'), ci, 64);
    const tex = own(new T.CanvasTexture(cv)); if (T.SRGBColorSpace) tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = maxAniso;
    const mat = own(new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false })); markMats.push(mat);
    const im = new T.InstancedMesh(markGeo, mat, CAP); im.frustumCulled = false; im.count = 0; im.renderOrder = 2; scene.add(im); markIMs.push(im);
  }
  const markCnt = new Array(COLOR_HEX.length).fill(0);
  const single = (ci) => { const m = new T.Mesh(markGeo, markMats[ci]); m.visible = false; m.renderOrder = 3; scene.add(m); return m; };   // shooter / projectile mark
  const shooterMark = single(0), shotMarks = [0, 1, 2, 3].map(() => single(0)), tmpV = new T.Vector3();
  const dummy = new T.Object3D(), tmpCol = new T.Color();
  for (let i = 0; i < CAP; i++) { chainIM.setColorAt(i, tmpCol.setHex(0xffffff)); haloIM.setColorAt(i, tmpCol); }
  let haloOn = opts.halo !== false;

  // token sprites (special marbles carry a symbol)
  const iconTex = {}, iconMat = {};
  function tokenSprite(kind) {
    if (!iconMat[kind]) {
      const cv = document.createElement('canvas'); cv.width = cv.height = 96; const cx = cv.getContext('2d');
      cx.fillStyle = 'rgba(10,8,24,0.78)'; cx.beginPath(); cx.arc(48, 48, 44, 0, Math.PI * 2); cx.fill(); cx.strokeStyle = '#ffd96a'; cx.lineWidth = 5; cx.stroke();
      drawIcon(cx, kind, 96);
      const tex = new T.CanvasTexture(cv); if (T.SRGBColorSpace) tex.colorSpace = T.SRGBColorSpace;
      iconTex[kind] = own(tex); iconMat[kind] = own(new T.SpriteMaterial({ map: tex, transparent: true, depthTest: false, fog: false }));
    }
    const sp = new T.Sprite(iconMat[kind]); sp.scale.set(0.82, 0.82, 1); sp.renderOrder = 10; return sp;
  }
  const sprites = new Map();

  // ---- projectiles
  const projPool = [];
  for (let i = 0; i < 4; i++) { const m = new T.Mesh(ballGeo, marbleMat(0)); m.visible = false; scene.add(m); const g = new T.Mesh(haloGeo, basicMat(0xffffff, 0.2, true)); m.add(g); projPool.push({ mesh: m, id: -1, trail: 0 }); }

  // ---- aim guide
  const guideDotsOn = opts.guideDots !== false;
  const dots = []; for (let i = 0; i < 30; i++) { const d = new T.Mesh(partGeo, basicMat(0xffffff, 0.55, true)); d.scale.setScalar(0.07); d.visible = false; scene.add(d); dots.push(d); }
  const guideRing = new T.Mesh(unitRing, own(new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, blending: T.AdditiveBlending, depthWrite: false, fog: false }))); guideRing.visible = false; scene.add(guideRing);
  const targetRing = new T.Mesh(unitRing, own(new T.MeshBasicMaterial({ color: 0xffd96a, transparent: true, opacity: 0.7, blending: T.AdditiveBlending, depthWrite: false, fog: false }))); targetRing.visible = false; scene.add(targetRing);

  // ---- effects pools
  const parts = []; for (let i = 0; i < 220; i++) { const m = new T.Mesh(partGeo, basicMat(0xffffff)); m.visible = false; scene.add(m); parts.push({ m, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 0.1, grav: 9 }); }
  let partCursor = 0;
  function burst(x, z, hex, n, speed = 4, size = 0.12, y = BALL_Y, grav = 9) {
    const mat = basicMat(hex, 1);
    for (let i = 0; i < n; i++) {
      const p = parts[partCursor]; partCursor = (partCursor + 1) % parts.length;
      const a = Math.random() * Math.PI * 2, sp = speed * (0.35 + Math.random() * 0.8);
      p.m.material = mat; p.m.position.set(x, y, z); p.vx = Math.cos(a) * sp; p.vz = Math.sin(a) * sp; p.vy = 1.5 + Math.random() * speed * 0.6;
      p.life = p.max = 0.45 + Math.random() * 0.4; p.size = size * (0.6 + Math.random() * 0.8); p.grav = grav; p.m.visible = true; p.m.scale.setScalar(p.size);
    }
  }
  const ghosts = []; for (let i = 0; i < 28; i++) { const m = new T.Mesh(ballGeo, marbleMat(0)); m.visible = false; scene.add(m); ghosts.push({ m, t: 0 }); }
  let ghostCursor = 0;
  function ghost(x, z, ci) { const g = ghosts[ghostCursor]; ghostCursor = (ghostCursor + 1) % ghosts.length; g.m.material = ci >= 0 ? marbleMat(ci) : bombMat; g.m.position.set(x, BALL_Y, z); g.t = 0.001; g.m.visible = true; g.m.scale.setScalar(1); }
  const ringsFx = []; for (let i = 0; i < 6; i++) { const m = new T.Mesh(unitRing, new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, fog: false })); owned.push(m.material); m.visible = false; scene.add(m); ringsFx.push({ m, t: 1, dur: 0.5, r: 1, y: 0.1 }); }
  let ringCursor = 0;
  function ring(x, z, radius, hex, dur = 0.5) { const r = ringsFx[ringCursor]; ringCursor = (ringCursor + 1) % ringsFx.length; r.m.material.color.setHex(hex); r.m.position.set(x, 0.12, z); r.t = 0; r.dur = dur; r.r = radius; r.m.visible = true; }
  const flashTex = (() => { const cv = document.createElement('canvas'); cv.width = cv.height = 64; const cx = cv.getContext('2d'); const g = cx.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)'); cx.fillStyle = g; cx.fillRect(0, 0, 64, 64); const t = new T.CanvasTexture(cv); if (T.SRGBColorSpace) t.colorSpace = T.SRGBColorSpace; return own(t); })();
  const flashes = []; for (let i = 0; i < 8; i++) { const sp = new T.Sprite(new T.SpriteMaterial({ map: flashTex, transparent: true, blending: T.AdditiveBlending, depthWrite: false, opacity: 0, fog: false })); owned.push(sp.material); sp.visible = false; scene.add(sp); flashes.push({ sp, t: 1, dur: 0.18, size: 1 }); }
  let flashCursor = 0;
  function flash(x, y, z, size, hex, dur = 0.18) { const f = flashes[flashCursor]; flashCursor = (flashCursor + 1) % flashes.length; f.sp.material.color.setHex(hex); f.sp.position.set(x, y, z); f.t = 0; f.dur = dur; f.size = size; f.sp.visible = true; }

  // ---- state
  const tmpP = { x: 0, z: 0 }, tmpQ = { x: 0, z: 0 }, liveIds = new Set();
  let time = 0, aimAngle = 0, aimTarget = 0, recoil = 0, shake = 0, lastInsert = { x: 0, z: 0 };
  // ---- adaptive quality (policy lives in quality.js; this block only maps ladder levels to renderer settings)
  // Ladder = [what was asked for (default or ?dpr=/?halo= override)] -> lower DPR caps (steps that would not change the real resolution on DPR-1
  // screens are skipped) -> 0.75x with the halo pass off. Level 0 is a ceiling: recovery never goes above a manual override.
  const ladder = (() => {
    const dev = globalThis.devicePixelRatio || 1, L = [{ dpr: dprCap, halo: haloOn }];
    let last = Math.min(dev, dprCap), d = dprCap, lastDpr = dprCap;
    while (d - 0.25 >= 1 - 1e-9) { d -= 0.25; const eff = Math.min(dev, d); if (eff < last - 1e-9) { L.push({ dpr: d, halo: haloOn }); last = eff; lastDpr = d; } }
    // last resort: sub-native resolution AND no halo pass together (measured: the glow pass is ~1% of frame time, so dropping it alone buys nothing and
    // a standalone step would fail the policy's benefit test; DOM HUD stays sharp)
    if (last > 0.75 + 1e-9) L.push({ dpr: 0.75, halo: false }); else if (haloOn) L.push({ dpr: lastDpr, halo: false });
    return L;
  })();
  let aq = opts.adaptive !== false ? new AdaptiveQuality(ladder.length, opts.qualityCfg) : null;
  function applyLevel(r) {
    const L = ladder[r.level];
    haloOn = L.halo; if (L.dpr !== dprCap) { dprCap = L.dpr; applySize(); }
    if (opts.onQuality) opts.onQuality({ action: r.action, level: r.level, dprCap, haloOn, avgMs: r.meanMs, reason: r.reason });
  }
  const aimState = { dx: 0, dz: -1, guide: false, pred: null };

  function applyView() {
    if (!currentPath) return;
    // keep the whole track clear of the HUD: margins come from the measured HUD edges (px), default = old fixed margins
    const m = {}; if (safePx) { m.top = Math.min(0.9, 1 - 2 * (safePx.top + 6) / H); m.bottom = Math.max(-0.9, 1 - 2 * (safePx.bottom - 6) / H); }
    view = fitView(W / H, footprint(currentPath), m);
    camera.aspect = W / H; camera.updateProjectionMatrix();
    camera.position.set(view.pos[0], view.pos[1], view.pos[2]);
    camera.lookAt(view.target[0], view.target[1], view.target[2]);
  }
  let safePx = null;
  // three's setPixelRatio() re-applies the stored size by itself, so calling setSize() right after it reallocated the drawing buffer twice
  // (measured: 2 setSize calls per rotation, 2 per adaptive step). Only touch what actually changed.
  let appliedR = -1, appliedW = -1, appliedH = -1;
  function applySize() {
    const r = Math.min(globalThis.devicePixelRatio || 1, dprCap);
    if (r !== appliedR) { renderer.setPixelRatio(r); appliedR = r; }
    if (W !== appliedW || H !== appliedH) { renderer.setSize(W, H, false); appliedW = W; appliedH = H; }
  }
  /** Explicit quality control (used by the benchmark; adaptive quality below applies the same state). */
  function setQuality(q = {}) {
    aq = null;                                   // explicit control wins: adaptive quality stops adjusting after a manual setQuality()
    if (q.dprCap) { dprCap = q.dprCap; applySize(); }
    if (q.halo !== undefined) haloOn = !!q.halo;
  }
  function resize(w, h, safe) {
    W = Math.max(1, w); H = Math.max(1, h); safePx = safe && safe.bottom > safe.top ? safe : null;
    applySize();
    applyView();
  }

  function event(ev, game) {
    switch (ev.type) {
      case 'shot': {
        recoil = 1; flash(ev.dx * MUZZLE, BALL_Y, ev.dz * MUZZLE, 1.9, ev.kind === 'bomb' ? 0xff7a2a : 0xfff0c0, 0.14);
        burst(ev.dx * MUZZLE, ev.dz * MUZZLE, 0xfff0c0, 4, 2.2, 0.07); break;
      }
      case 'insert': lastInsert = { x: ev.sx, z: ev.sz }; flash(ev.x, BALL_Y, ev.z, 1.6, 0xffffff, 0.16); ring(ev.sx, ev.sz, R * 1.6, 0xffffff, 0.28); break;
      case 'match': {
        const hex = COLOR_HEX[ev.color] ?? 0xffffff; let cx = 0, cz = 0;
        for (const b of ev.balls) { ghost(b.x, b.z, b.color); burst(b.x, b.z, COLOR_HEX[b.color] ?? hex, 3, 3.2, 0.11); cx += b.x; cz += b.z; }
        cx /= ev.balls.length; cz /= ev.balls.length;
        flash(cx, BALL_Y + 0.3, cz, 2.2 + ev.n * 0.35, hex, 0.3);
        if (ev.n >= 4 || ev.combo >= 2) ring(cx, cz, 1.6 + ev.n * 0.35, hex, 0.55);
        shake = Math.max(shake, ev.n >= 5 ? 0.35 : 0.12); break;
      }
      case 'bomb': {
        for (const b of ev.balls) { ghost(b.x, b.z, b.color); burst(b.x, b.z, 0xff8a1a, 3, 5, 0.14); }
        ring(ev.x, ev.z, ev.radius * 1.15, 0xff7a1a, 0.6); ring(ev.x, ev.z, ev.radius * 0.7, 0xffe0a0, 0.4);
        flash(ev.x, BALL_Y + 0.4, ev.z, 5.5, 0xffa040, 0.4); burst(ev.x, ev.z, 0xffcf60, 18, 7, 0.16); shake = 0.7; break;
      }
      case 'rainbow': ring(lastInsert.x, lastInsert.z, 1.5, COLOR_HEX[ev.color] ?? 0xffffff, 0.45); burst(lastInsert.x, lastInsert.z, 0xffffff, 10, 3.5, 0.09); break;
      case 'power_gain': ring(ev.x, ev.z, 1.2, 0xffd96a, 0.5); burst(ev.x, ev.z, 0xffd96a, 8, 3, 0.09); break;
      case 'devour': burst(ev.x, ev.z, COLOR_HEX[ev.color] ?? 0xffffff, 3, 3, 0.1); shake = Math.max(shake, 0.25); break;
      case 'life_lost': shake = 1; break;
      case 'surge_on': shake = Math.max(shake, 0.3); break;
      default: break;
    }
  }

  function frame(game, dt, aim, rawMs) {
    const sceneStart = onSectionTiming ? performance.now() : 0;
    time += dt;
    if (aim) { aimState.dx = aim.dx; aimState.dz = aim.dz; aimState.guide = !!aim.guide; aimState.pred = aim.pred || null; }
    // ---- frog: smooth yaw toward the true aim direction, recoil spring
    aimTarget = Math.atan2(aimState.dx, aimState.dz);
    let d = aimTarget - aimAngle; d = Math.atan2(Math.sin(d), Math.cos(d));
    aimAngle += d * (1 - Math.exp(-dt * 32));
    frog.rotation.y = aimAngle;
    recoil = Math.max(0, recoil - dt * 6);
    cannonGrp.position.z = -0.32 * recoil * recoil;
    frog.scale.set(1 + 0.05 * recoil, 1 - 0.06 * recoil, 1 + 0.05 * recoil);
    frog.position.y = Math.sin(time * 2.2) * 0.03;
    if (jewelMesh) jewelMesh.rotation.y += dt * 1.6;

    const chain = game ? game.chain : null, path = game ? game.path : currentPath;
    let n = 0;
    if (chain && path) {
      n = Math.min(chain.length, CAP);
      const p = tmpP, live = liveIds; live.clear(); markCnt.fill(0);
      for (let i = 0; i < n; i++) {
        const b = chain[i];
        path.pos(b.s + b.vis, p);
        let x = p.x, z = p.z;
        if (b.blend > 0) { const k = b.blend * b.blend; x += (b.fromX - x) * k; z += (b.fromZ - z) * k; }
        let sc = Math.min(1, Math.max(0, (b.s + 0.25) / 0.9));
        if (b.token) sc *= 1 + 0.07 * Math.sin(time * 6 + i);
        dummy.position.set(x, BALL_Y, z); dummy.scale.setScalar(Math.max(0.001, sc)); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
        chainIM.setMatrixAt(i, dummy.matrix);
        tmpCol.setHex(COLOR_HEX[b.color] ?? 0xffffff); chainIM.setColorAt(i, tmpCol);
        if (haloOn) { haloIM.setMatrixAt(i, dummy.matrix); haloIM.setColorAt(i, tmpCol); }
        dummy.position.y = 0.05; dummy.scale.setScalar(Math.max(0.001, sc)); dummy.updateMatrix(); blobIM.setMatrixAt(i, dummy.matrix);
        if (marksOn && !b.token && b.color >= 0 && b.color < markIMs.length) {
          facePos(dummy.position, x, BALL_Y, z, R * sc + 0.012); dummy.scale.setScalar(Math.max(0.001, sc)); dummy.updateMatrix();
          markIMs[b.color].setMatrixAt(markCnt[b.color]++, dummy.matrix);
        }
        if (b.token) {
          live.add(b.id); let sp = sprites.get(b.id);
          if (!sp) { sp = tokenSprite(b.token); scene.add(sp); sprites.set(b.id, sp); }
          sp.position.set(x, BALL_Y + 0.02, z); sp.scale.set(0.8 * sc, 0.8 * sc, 1);
        }
      }
      for (const [id, sp] of sprites) if (!live.has(id)) { scene.remove(sp); sprites.delete(id); }
      chainIM.instanceMatrix.needsUpdate = true; if (chainIM.instanceColor) chainIM.instanceColor.needsUpdate = true;
      blobIM.instanceMatrix.needsUpdate = true;
      for (let ci = 0; ci < markIMs.length; ci++) if (markCnt[ci]) markIMs[ci].instanceMatrix.needsUpdate = true;
      if (haloOn) { haloIM.instanceMatrix.needsUpdate = true; if (haloIM.instanceColor) haloIM.instanceColor.needsUpdate = true; }
    } else if (sprites.size) { for (const [, sp] of sprites) scene.remove(sp); sprites.clear(); }
    chainIM.count = n; blobIM.count = n; haloIM.count = haloOn ? n : 0;
    for (let ci = 0; ci < markIMs.length; ci++) markIMs[ci].count = marksOn && n ? markCnt[ci] : 0;

    // ---- shooter marble + projectiles
    if (game && (game.state === 'playing' || game.state === 'intro')) {
      shooter.visible = true;
      shooter.material = game.armed === 'bomb' ? bombMat : game.armed === 'rainbow' ? rainbowMat : marbleMat(game.cur.color);
      shooterGlow.material = basicMat(game.armed === 'bomb' ? 0xff6a1a : game.armed === 'rainbow' ? 0xffffff : COLOR_HEX[game.cur.color], 0.2, true);
      shooter.scale.setScalar(1 - 0.12 * recoil);
      const sm = shooterMark; sm.visible = marksOn && !game.armed && game.cur.color >= 0 && game.cur.color < markMats.length;
      if (sm.visible) { sm.material = markMats[game.cur.color]; shooter.getWorldPosition(tmpV); const k = 1 - 0.12 * recoil; facePos(sm.position, tmpV.x, tmpV.y, tmpV.z, R * k + 0.012); sm.scale.setScalar(k); }
    } else { shooter.visible = false; shooterMark.visible = false; }
    rainbowMat.emissive.setHSL((time * 0.6) % 1, 0.9, 0.55);
    bombMat.emissiveIntensity = 0.5 + 0.35 * Math.sin(time * 9);

    let pi = 0;
    if (game) for (const pr of game.projectiles) {
      if (pi >= projPool.length) break;
      const s = projPool[pi++]; s.mesh.visible = true; s.mesh.position.set(pr.x, BALL_Y, pr.z);
      s.mesh.material = pr.type === 'bomb' ? bombMat : pr.type === 'rainbow' ? rainbowMat : marbleMat(pr.color);
      const pm = shotMarks[pi - 1]; pm.visible = marksOn && pr.type === 'normal' && pr.color >= 0 && pr.color < markMats.length;
      if (pm.visible) { pm.material = markMats[pr.color]; facePos(pm.position, pr.x, BALL_Y, pr.z, R + 0.012); }
      s.trail -= dt; if (s.trail <= 0) { s.trail = 0.025; const p = parts[partCursor]; partCursor = (partCursor + 1) % parts.length; p.m.material = basicMat(pr.type === 'bomb' ? 0xff8a2a : pr.color >= 0 ? COLOR_HEX[pr.color] : 0xffffff, 1); p.m.position.set(pr.x, BALL_Y, pr.z); p.vx = p.vy = p.vz = 0; p.life = p.max = 0.25; p.size = 0.2; p.grav = 0; p.m.visible = true; }
    }
    for (; pi < projPool.length; pi++) { projPool[pi].mesh.visible = false; shotMarks[pi].visible = false; }

    // ---- aim guide
    const showGuide = game && game.state === 'playing' && aimState.guide && aimState.pred;
    if (showGuide) {
      const pr = aimState.pred, dx = pr.x - pr.x0, dz = pr.z - pr.z0, len = Math.hypot(dx, dz) || 1;
      const cnt = Math.min(dots.length, Math.floor(len / 0.8));
      for (let i = 0; i < dots.length; i++) {
        const dd = dots[i];
        if (guideDotsOn && i < cnt) { const t = (i + 1) * 0.8 / len; dd.visible = t < 1; dd.position.set(pr.x0 + dx * t, BALL_Y, pr.z0 + dz * t); dd.scale.setScalar(0.06 + 0.02 * Math.sin(time * 8 - i * 0.7)); } else dd.visible = false;
      }
      guideRing.visible = pr.hit;
      if (pr.hit) {
        const bomb = game.armed === 'bomb', r = bomb ? BOMB_REACH : R * 1.05;
        guideRing.position.set(pr.x, 0.15, pr.z); guideRing.scale.set(r, 1, r);
        guideRing.material.color.setHex(bomb ? 0xff7a1a : game.armed === 'rainbow' ? 0xffffff : COLOR_HEX[game.cur.color]);
        let tb = null; for (let i = 0; i < game.chain.length; i++) if (game.chain[i].id === pr.ballId) { tb = game.chain[i]; break; }
        if (tb) { const tp = path.pos(tb.s, tmpQ); targetRing.visible = true; targetRing.position.set(tp.x, 0.15, tp.z); const rr = R * (1.35 + 0.08 * Math.sin(time * 9)); targetRing.scale.set(rr, 1, rr); } else targetRing.visible = false;
      } else targetRing.visible = false;
    } else { for (const dd of dots) dd.visible = false; guideRing.visible = false; targetRing.visible = false; }

    // ---- skull / danger
    const danger = game ? game.danger : 0, pulse = 0.5 + 0.5 * Math.sin(time * (4 + 8 * danger));
    const base = skull.userData.base;
    if (base) skull.position.set(base.x + (danger > 0.3 ? Math.sin(time * 40) * 0.04 * danger : 0), Math.sin(time * 1.5) * 0.06, base.z);
    for (const e of eyeMeshes) e.scale.setScalar(1 + danger * (0.6 + 0.8 * pulse));
    eyeMat.color.setRGB(1, 0.1 + 0.25 * pulse * danger, 0.08);
    dangerMat.opacity = danger > 0.05 ? (0.15 + 0.5 * pulse) * Math.min(1, danger * 1.5) : 0;

    // ---- pooled effects
    for (const p of parts) {
      if (!p.m.visible) continue;
      p.life -= dt; if (p.life <= 0) { p.m.visible = false; continue; }
      p.vy -= p.grav * dt; p.m.position.x += p.vx * dt; p.m.position.y = Math.max(0.05, p.m.position.y + p.vy * dt); p.m.position.z += p.vz * dt;
      p.m.scale.setScalar(Math.max(0.001, p.size * (p.life / p.max)));
    }
    for (const g of ghosts) {
      if (!g.m.visible) continue;
      g.t += dt; const k = g.t / 0.24; if (k >= 1) { g.m.visible = false; continue; }
      g.m.scale.setScalar(k < 0.35 ? 1 + 0.45 * (k / 0.35) : 1.45 * (1 - (k - 0.35) / 0.65));
    }
    for (const r of ringsFx) {
      if (!r.m.visible) continue;
      r.t += dt; const k = r.t / r.dur; if (k >= 1) { r.m.visible = false; continue; }
      const e = 1 - (1 - k) * (1 - k); r.m.scale.set(r.r * (0.25 + 0.75 * e), 1, r.r * (0.25 + 0.75 * e)); r.m.material.opacity = 0.9 * (1 - k);
    }
    for (const f of flashes) {
      if (!f.sp.visible) continue;
      f.t += dt; const k = f.t / f.dur; if (k >= 1) { f.sp.visible = false; continue; }
      f.sp.scale.set(f.size * (0.6 + 0.6 * k), f.size * (0.6 + 0.6 * k), 1); f.sp.material.opacity = 1 - k;
    }
    // motes drift (cheap: only y wobble via rotation of the whole cloud)
    motes.rotation.y += dt * 0.02;

    // ---- camera shake (restrained) then render
    if (view) {
      shake = Math.max(0, shake - dt * 2.2);
      const s = shake * shake * 0.35;
      camera.position.set(view.pos[0] + (Math.random() - 0.5) * s, view.pos[1] + (Math.random() - 0.5) * s, view.pos[2] + (Math.random() - 0.5) * s);
      camera.lookAt(view.target[0], view.target[1], view.target[2]);
    }
    if (onSectionTiming) onSectionTiming('sceneUpdate', sceneStart, performance.now());
    const rendererStart = onSectionTiming ? performance.now() : 0;
    const gpuQuery = beginGpuQuery();
    try { renderer.render(scene, camera); }
    finally { endGpuQuery(gpuQuery); }
    if (onSectionTiming) onSectionTiming('rendererRender', rendererStart, performance.now());
    const postRenderStart = onSectionTiming ? performance.now() : 0;
    if (!envScheduled) { envScheduled = true; setTimeout(buildEnv, 60); }   // reflections are generated after the first frame is on screen

    // ---- adaptive quality: raw frame interval (not the game's clamped dt); paused frames (dt = 0) break the measuring window
    if (aq) { const r = aq.sample(rawMs > 0 ? rawMs : dt * 1000, dt > 0); if (r) applyLevel(r); }
    if (onSectionTiming) onSectionTiming('postRender', postRenderStart, performance.now());
  }

  function clearFx() {
    shooterMark.visible = false; for (const m of shotMarks) m.visible = false;
    for (const p of parts) p.m.visible = false; for (const g of ghosts) g.m.visible = false; for (const r of ringsFx) r.m.visible = false;
    for (const f of flashes) f.sp.visible = false; for (const p of projPool) p.mesh.visible = false;
    for (const [, sp] of sprites) scene.remove(sp); sprites.clear(); shake = 0; recoil = 0;
  }
  function screenOf(x, z) {
    if (!view) return null; const q = project(view, [x, BALL_Y + 0.4, z]);
    return { x: (q[0] + 1) / 2 * W, y: (1 - q[1]) / 2 * H };
  }
  function dispose() {
    for (const o of owned) { try { o.dispose(); } catch { /* ignore */ } }
    for (const g of trackOwned) g.dispose();
    chainIM.dispose(); haloIM.dispose(); blobIM.dispose(); for (const im of markIMs) im.dispose();
    renderer.dispose(); if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
  }
  return { canvas, setLevel, resize, setQuality, ensureEnv: buildEnv, restoreContext, setMarks(on) { marksOn = !!on; }, get marks() { return marksOn; }, get envBuildMs() { return envBuildMs; }, event, frame, clearFx, screenOf, dispose, get view() { return view; }, get quality() { return { dprCap, haloOn, adaptive: !!aq, ...(aq ? aq.state : { level: 0, levels: ladder.length }) }; }, get qualityLadder() { return ladder.map(l => ({ ...l })); }, get renderer() { return renderer; } };
}
