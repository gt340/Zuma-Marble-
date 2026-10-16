// Phase 3 / Gate 4: marble legibility review on the REAL renderer. node tests/legibility.mjs  -> tests/evidence-phase3/legibility.txt
// MEASURED: on-screen marble diameter and centre spacing (CSS px), rendered colour of each marble colour (pixels read from the GL buffer),
//           CIE76 colour differences under SIMULATED colour-vision deficiency (Machado et al. 2009, severity 1.0).
// ESTIMATED (physical): millimetres assume 1 CSS px = 1/160 inch (Android density-independent pixel); angle assumes a 30 cm viewing distance.
// NOT a substitute for human testing: simulated CVD is a model, not a person; nobody has looked at this on a phone yet.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/opt/npm-tools/node_modules/playwright/index.mjs');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/zuma3d-android.html'; const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise(r => server.listen(0, '127.0.0.1', r)); const BASE = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

const lin = (c) => ((c /= 255) > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92), gam = (c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const lab = ([r, g, b]) => { r = lin(r); g = lin(g); b = lin(b); const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, Y = 0.2126 * r + 0.7152 * g + 0.0722 * b, Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883; const t = u => u > 0.008856 ? Math.cbrt(u) : 7.787 * u + 16 / 116; return [116 * t(Y) - 16, 500 * (t(X) - t(Y)), 200 * (t(Y) - t(Z))]; };
const dE = (a, b) => { const A = lab(a), B = lab(b); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };
const M = {
  normal: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
const sim = (rgb, m) => { const l = rgb.map(lin), o = m.map(row => Math.min(1, Math.max(0, row[0] * l[0] + row[1] * l[1] + row[2] * l[2]))); return o.map(gam); };
const NAMES = ['red', 'green', 'blue', 'yellow', 'purple', 'orange'];
const out = [];
const say = (s) => { console.log(s); out.push(s); };

for (const [w, h] of [[360, 640], [390, 844], [412, 915]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true, isMobile: true }); const page = await ctx.newPage();
  await page.goto(BASE + '/'); await page.waitForFunction(() => window.__zuma && window.__zuma.gfx, null, { timeout: 90000 });
  await page.evaluate(() => window.__zuma.startCampaign(7)); await page.waitForFunction(() => window.__zuma.game.state === 'playing' && window.__zuma.gfx.envBuildMs > 0, null, { timeout: 90000 });
  const r = await page.evaluate(async () => {
    const { project } = await import('/view.js'); const z = window.__zuma, g = z.game, gfx = z.gfx, gl = gfx.renderer.getContext();
    for (let i = 0; i < 60 * 22; i++) g.advance(1 / 60); gfx.frame(g, 0, { dx: 0, dz: -1, guide: false, pred: null });
    const v = gfx.view, cw = gfx.canvas.width, ch = gfx.canvas.height, sx = innerWidth / cw, acc = {}, buf = new Uint8Array(4), diam = [], pitch = [];
    const px = (x, zz) => { const q = project(v, [x, 0.5, zz]); return [(q[0] + 1) / 2 * cw, (1 - q[1]) / 2 * ch]; };
    let prev = null;
    for (const b of g.chain) {
      if (b.token || b.color < 0) { prev = null; continue; } const p = g.path.pos(b.s, {}), c = px(p.x, p.z), e = px(p.x + 0.48, p.z), cx = Math.round(c[0]), cy = Math.round(ch - c[1]);   // cy is GL bottom-up (readPixels origin), c[1] is top-down
      if (cx < 3 || cy < 3 || cx > cw - 3 || cy > ch - 3) { prev = null; continue; }
      diam.push(2 * Math.hypot(e[0] - c[0], e[1] - c[1]) * sx); if (prev) pitch.push(Math.hypot(c[0] - prev[0], c[1] - prev[1]) * sx); prev = c;
      let rr = 0, gg = 0, bb = 0, n = 0; for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { gl.readPixels(cx + dx, cy + dy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf); rr += buf[0]; gg += buf[1]; bb += buf[2]; n++; }
      (acc[b.color] = acc[b.color] || []).push([rr / n, gg / n, bb / n]);
    }
    const mean = {}; for (const [k, a] of Object.entries(acc)) mean[k] = [0, 1, 2].map(c => a.reduce((s, x) => s + x[c], 0) / a.length);
    const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
    return { mean, counts: Object.fromEntries(Object.entries(acc).map(([k, a]) => [k, a.length])), diamMin: Math.min(...diam), diamMed: med(diam), pitchMed: med(pitch) };
  });
  const cssPx = r.diamMed, mm = cssPx / 160 * 25.4, deg = 2 * Math.atan((mm / 2) / 300) * 180 / Math.PI;
  say(`\n=== ${w}x${h} (CSS px; level 7 after 22 s; ${Object.keys(r.mean).length} colours seen, counts ${JSON.stringify(r.counts)}) ===`);
  say(`marble diameter: min ${r.diamMin.toFixed(1)} px, median ${cssPx.toFixed(1)} px  (ESTIMATE: ${mm.toFixed(1)} mm on screen, ${deg.toFixed(2)} deg at 30 cm = ${(deg * 60).toFixed(0)} arcmin); neighbour centre spacing median ${r.pitchMed.toFixed(1)} px`);
  say(`fingertip (~9 mm = 57 css px) covers about ${(57 / cssPx).toFixed(1)} marble diameters across`);
  const ks = Object.keys(r.mean);
  for (const [name, m] of Object.entries(M)) {
    const pairs = []; for (const a of ks) for (const b of ks) if (+a < +b) pairs.push([dE(sim(r.mean[a], m), sim(r.mean[b], m)), NAMES[a] + '/' + NAMES[b]]);
    pairs.sort((x, y) => x[0] - y[0]);
    say(`${name.padEnd(6)} closest pairs (CIE76 dE of rendered colours, ${name === 'normal' ? 'normal vision' : 'simulated'}): ` + pairs.slice(0, 4).map(p => `${p[1]} ${p[0].toFixed(1)}`).join(', ') + `   | pairs below 15: ${pairs.filter(p => p[0] < 15).length}/${pairs.length}`);
  }
  await page.screenshot({ path: path.join(ROOT, 'tests', 'evidence-phase3', `legibility-${w}x${h}.png`) });
  await ctx.close();
}
fs.mkdirSync(path.join(ROOT, 'tests', 'evidence-phase3'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'tests', 'evidence-phase3', 'legibility.txt'), out.join('\n') + '\n');
await browser.close(); server.close();
