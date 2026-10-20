// Phase 4 / Gate 2: are the marble marks visible and distinguishable at real phone sizes? REAL Three.js r160 pixels (software GL).
//   node tests/marks.mjs      -> tests/evidence-phase4/marks-metrics.{txt,json}, marks-sheet.png (if PIL exists), exit 1 if a threshold fails
// For each viewport: render the same paused frame with marks ON and OFF, read a crop around every on-screen chain marble from the GL buffer.
//  (1) visibility  : per marble, max |dL*| between ON and OFF inside the crop, under normal / protan / deutan / tritan simulation (Machado 2009, severity 1).
//  (2) identifiability: leave-one-out nearest-template classification using LUMINANCE ONLY (hue discarded, crop mean removed, +-1 px shifts) —
//      i.e. can the marble TYPE be recovered from shape/brightness structure alone, as a person without colour discrimination would have to?
//      The same classifier on the marks-OFF crops is the control: it must be near chance, otherwise the test would be measuring shading.
// Simulation is a model, not people; nothing here replaces testing with colour-blind players on a phone.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'evidence-phase4'); fs.mkdirSync(OUT, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/opt/npm-tools/node_modules/playwright/index.mjs');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/zuma3d-android.html'; const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise(r => server.listen(0, '127.0.0.1', r)); const BASE = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

const lin = (c) => ((c /= 255) > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92);
const Lstar = (rgb, m) => { let r = lin(rgb[0]), g = lin(rgb[1]), b = lin(rgb[2]); if (m) { const o = m.map(w => Math.min(1, Math.max(0, w[0] * r + w[1] * g + w[2] * b))); [r, g, b] = o; } const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b; return Y > 0.008856 ? 116 * Math.cbrt(Y) - 16 : 903.3 * Y; };
const MODES = {
  normal: null,
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
const NAMES = ['red/plus', 'green/triangle', 'blue/bars', 'yellow/cross', 'purple/dot', 'orange/ring', 'cyan/diamond', 'pink/star'];
const VIEWS = process.env.ONLY ? process.env.ONLY.split(",").map(v => v.split("x").map(Number)) : [[360, 640], [390, 844], [412, 915], [640, 360], [844, 390], [915, 412]];
const lines = [], out = { views: {} }, fails = [];
const say = (s) => { console.log(s); lines.push(s); };
const need = (ok, msg) => { if (!ok) fails.push(msg); say((ok ? 'PASS  ' : 'FAIL  ') + msg); };

const MEASURE = `async () => {
  const { project } = await import('/view.js'); const z = window.__zuma, g = z.game, gfx = z.gfx, gl = gfx.renderer.getContext(); const A = { dx: 0, dz: -1, guide: false, pred: null };
  for (let i = 0; i < 60 * 22; i++) g.advance(1 / 60); z.pause();
  const cw = gfx.canvas.width, ch = gfx.canvas.height, v = () => gfx.view, sx = innerWidth / cw;
  const px = (x, zz) => { const q = project(v(), [x, 0.5, zz]); return [(q[0] + 1) / 2 * cw, (q[1] + 1) / 2 * ch]; };
  const sel = []; let diam = 0;
  gfx.frame(g, 0, A);
  let dmin = 1e9; for (const b of g.chain) { if (b.token || b.color < 0 || b.s < 3) continue; const p = g.path.pos(b.s, {}), c = px(p.x, p.z), e = px(p.x + 0.48, p.z); dmin = Math.min(dmin, 2 * Math.hypot(e[0] - c[0], e[1] - c[1])); }
  const KFIX = 2 * Math.floor(0.4 * dmin) + 1;   // one crop size for every marble (the classifier compares equal-sized crops)
  for (const b of g.chain) { if (b.token || b.color < 0 || b.s < 3) continue; /* s<3: the first marbles are still emerging from the entrance (scale (s+0.25)/0.9 < 1 for s<0.65) and are partly hidden by the entrance scenery in the base game; not a property of the marks */ const p = g.path.pos(b.s, {}), c = px(p.x, p.z), e = px(p.x + 0.48, p.z); const d = 2 * Math.hypot(e[0] - c[0], e[1] - c[1]); const K = KFIX; const h = (K - 1) / 2; const cx = Math.round(c[0]), cy = Math.round(c[1]);
    if (cx - h < 1 || cy - h < 1 || cx + h > cw - 2 || cy + h > ch - 2) continue; sel.push({ id: b.id, color: b.color, cx, cy, K, d: d * sx, s: +b.s.toFixed(2), i: g.chain.indexOf(b) }); diam = d * sx; }
  const read = () => sel.map(m => { const buf = new Uint8Array(m.K * m.K * 4); gl.readPixels(m.cx - (m.K - 1) / 2, m.cy - (m.K - 1) / 2, m.K, m.K, gl.RGBA, gl.UNSIGNED_BYTE, buf); const px2 = []; for (let r = m.K - 1; r >= 0; r--) for (let c = 0; c < m.K; c++) { const i = (r * m.K + c) * 4; px2.push([buf[i], buf[i + 1], buf[i + 2]]); } return px2; });   // top row first
  gfx.setMarks(true); gfx.frame(g, 0, A); const on = read();
  gfx.setMarks(false); gfx.frame(g, 0, A); const off = read();
  gfx.setMarks(true);
  const info = gfx.renderer.info; gfx.frame(g, 0, A); const callsOn = info.render.calls, trisOn = info.render.triangles;
  gfx.setMarks(false); gfx.frame(g, 0, A); const callsOff = info.render.calls, trisOff = info.render.triangles; gfx.setMarks(true);
  const ys = sel.map(m => (ch - m.cy) * sx), xs = sel.map(m => m.cx * sx), pad = diam; const bbox = [Math.max(0, Math.min(...xs) - pad), Math.max(0, Math.min(...ys) - pad), Math.min(innerWidth, Math.max(...xs) + pad), Math.min(innerHeight, Math.max(...ys) + pad)];
  return { sel, bbox, on, off, canvas: [cw, ch], callsOn, callsOff, trisOn, trisOff };
}`;

function detrend(a, K) {         // remove the smooth shading: least-squares fit of 1,x,y,x2,xy,y2 over the crop (what is left is structure: edges, glyphs, speculars)
  const B = []; for (let y = 0; y < K; y++) for (let x = 0; x < K; x++) { const u = (x - (K - 1) / 2) / K, v = (y - (K - 1) / 2) / K; B.push([1, u, v, u * u, u * v, v * v]); }
  const N = 6, A = Array.from({ length: N }, () => new Array(N + 1).fill(0));
  B.forEach((r, k) => { for (let i = 0; i < N; i++) { for (let j = 0; j < N; j++) A[i][j] += r[i] * r[j]; A[i][N] += r[i] * a[k]; } });
  for (let i = 0; i < N; i++) { let m = i; for (let r = i + 1; r < N; r++) if (Math.abs(A[r][i]) > Math.abs(A[m][i])) m = r; [A[i], A[m]] = [A[m], A[i]]; for (let r = 0; r < N; r++) if (r !== i) { const f = A[r][i] / A[i][i]; for (let c = i; c <= N; c++) A[r][c] -= f * A[i][c]; } }
  const co = A.map((r, i) => r[N] / r[i]); return a.map((v, k) => v - B[k].reduce((s2, bv, i) => s2 + bv * co[i], 0));
}
function norm(a) { const m = a.reduce((x, y) => x + y, 0) / a.length; const z = a.map(v => v - m); const n = Math.hypot(...z) || 1; return z.map(v => v / n); }
function corr(a, b, K) {            // max normalised correlation over +-1 px shifts
  let best = -1;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    let s = 0, na = 0, nb = 0;
    for (let y = 0; y < K; y++) for (let x = 0; x < K; x++) { const x2 = x + dx, y2 = y + dy; if (x2 < 0 || y2 < 0 || x2 >= K || y2 >= K) continue; const va = a[y * K + x], vb = b[y2 * K + x2]; s += va * vb; na += va * va; nb += vb * vb; }
    best = Math.max(best, s / (Math.sqrt(na * nb) || 1));
  }
  return best;
}
function loo(items, K) {            // leave-one-out nearest-template accuracy; items = [{color, v:normalised luminance crop}]
  let ok = 0, n = 0; const per = {};
  for (let i = 0; i < items.length; i++) {
    const tmpl = {}; for (let j = 0; j < items.length; j++) if (j !== i) { (tmpl[items[j].color] = tmpl[items[j].color] || []).push(items[j].v); }
    let bestC = -1, bestS = -2;
    for (const [c, list] of Object.entries(tmpl)) { const t = norm(list[0].map((_, k) => list.reduce((s, a) => s + a[k], 0) / list.length)); const sc = corr(items[i].v, t, K); if (sc > bestS) { bestS = sc; bestC = +c; } }
    n++; per[items[i].color] = per[items[i].color] || [0, 0]; per[items[i].color][1]++; if (bestC === items[i].color) { ok++; per[items[i].color][0]++; }
  }
  return { acc: ok / n, n, per };
}

for (const [w, h] of VIEWS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true, isMobile: true }); const page = await ctx.newPage();
  await page.goto(BASE + '/'); await page.waitForFunction(() => window.__zuma && window.__zuma.gfx, null, { timeout: 120000 });
  await page.evaluate(() => window.__zuma.startCampaign(7)); await page.waitForFunction(() => window.__zuma.game.state === 'playing' && window.__zuma.gfx.envBuildMs > 0, null, { timeout: 120000 });
  const r = await page.evaluate(`(${MEASURE})()`);
  const K = r.sel[0].K; const types = new Set(r.sel.map(m => m.color));
  say(`\n=== ${w}x${h}  marbles measured ${r.sel.length} (types ${[...types].sort().join(',')}), marble diameter ${r.sel[0].d.toFixed(1)} css px, crop ${K}x${K} px; draw calls on/off ${r.callsOn}/${r.callsOff}, triangles on/off ${r.trisOn}/${r.trisOff} ===`);
  const V = { bbox: r.bbox, diam: r.sel[0].d, n: r.sel.length, K, calls: [r.callsOn, r.callsOff], tris: [r.trisOn, r.trisOff], modes: {} };
  for (const [mname, M] of Object.entries(MODES)) {
    const vis = {}, items = [], itemsOff = [];
    r.sel.forEach((m, i) => {
      const Lon = r.on[i].map(p => Lstar(p, M)), Loff = r.off[i].map(p => Lstar(p, M));
      const mx = Math.max(...Lon.map((v, k) => Math.abs(v - Loff[k]))); if (mx < 30 && mname === 'normal') say(`   low-visibility marble: type ${m.color} chain#${m.i} s=${m.s} at px(${m.cx},${m.cy}) max dL*=${mx.toFixed(1)}`); (vis[m.color] = vis[m.color] || []).push(mx);
      items.push({ color: m.color, v: norm(detrend(Lon, K)) }); itemsOff.push({ color: m.color, v: norm(detrend(Loff, K)) });
    });
    const perType = Object.fromEntries(Object.entries(vis).map(([c, a]) => [c, { min: Math.min(...a), med: a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] }]));
    const minVis = Math.min(...Object.values(perType).map(o => o.min)), a = loo(items, K), b = loo(itemsOff, K);
    V.modes[mname] = { minVisibilityDL: minVis, perType, accuracy: a.acc, accuracyMarksOff: b.acc, perTypeAcc: a.per };
    say(`${mname.padEnd(6)} min per-marble max|dL*| (marks on vs off) = ${minVis.toFixed(1)}  [per type min: ${Object.entries(perType).map(([c, o]) => NAMES[c].split('/')[1] + ' ' + o.min.toFixed(0)).join(', ')}]  | luminance-only type identification: ${(100 * a.acc).toFixed(0)}% (n=${a.n})  control marks OFF: ${(100 * b.acc).toFixed(0)}%`);
  }
  if (process.env.DUMP) fs.writeFileSync(path.join(process.env.DUMP, `crops-${w}x${h}.json`), JSON.stringify({ K, sel: r.sel, on: r.on, off: r.off })); out.views[`${w}x${h}`] = V; if (w === 360 && h === 640) out.crops = { K, colors: r.sel.map(m => m.color), on: r.on, off: r.off };
  await page.evaluate(() => document.getElementById('screen-pause').classList.add('hidden'));   // the paused game keeps its last frame; hide the pause card so the board is visible
  await page.screenshot({ path: path.join(OUT, `marks-on-${w}x${h}.png`) });
  await page.evaluate(() => window.__zuma.gfx.setMarks(false)); await page.evaluate(() => window.__zuma.gfx.frame(window.__zuma.game, 0, { dx: 0, dz: -1, guide: false, pred: null }));
  await page.screenshot({ path: path.join(OUT, `marks-off-${w}x${h}.png`) });
  await ctx.close();
}
// ---- thresholds (all viewports, all simulated vision types). Chosen from physics, not tuned to pass: dL* >= 20 is far above the ~2-3 L* detection
// threshold for large patches and a conservative level for 8 px features; identification must beat the control by a wide margin.
for (const [vn, V] of Object.entries(out.views)) for (const [mn, o] of Object.entries(V.modes)) {
  need(o.minVisibilityDL >= 20, `${vn} ${mn}: every marble's mark changes luminance by >= 20 L* somewhere inside the marble (min ${o.minVisibilityDL.toFixed(1)})`);
  need(o.accuracy >= 0.9, `${vn} ${mn}: marble type recovered from luminance structure alone >= 90% (got ${(100 * o.accuracy).toFixed(0)}%, control without marks ${(100 * o.accuracyMarksOff).toFixed(0)}%)`);
  need(o.accuracyMarksOff <= 0.5, `${vn} ${mn}: control (marks off) cannot identify the type from luminance structure (${(100 * o.accuracyMarksOff).toFixed(0)}% <= 50%)`);
}
fs.writeFileSync(path.join(OUT, 'marks-metrics.json'), JSON.stringify(out));
try { execFileSync('python3', ['-I', path.join(ROOT, 'tests', 'marks-sheet.py'), OUT], { stdio: 'inherit' }); } catch (e) { console.log('(contact sheet skipped: ' + (e.message || e).split('\n')[0] + ')'); }
fs.writeFileSync(path.join(OUT, 'marks-metrics.txt'), lines.join('\n') + '\n');
await browser.close(); server.close();
console.log(`\n${fails.length ? fails.length + ' FAILED' : 'all mark checks passed'}`);
process.exit(fails.length ? 1 : 0);
