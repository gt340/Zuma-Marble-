// Render micro-benchmark (real Three.js, software WebGL unless a GPU is present). RELATIVE comparisons only: SwiftShader is a CPU rasterizer, so
// absolute milliseconds say nothing about phones; ratios between configurations show where fill-rate / geometry cost sits.
// node tests/bench.mjs [reps=3]
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/opt/npm-tools/node_modules/playwright/index.mjs');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };
const srv = http.createServer((q, r) => { const p = decodeURIComponent(new URL(q.url, 'http://x').pathname); const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
await new Promise(r => srv.listen(0, '127.0.0.1', r)); const B = `http://127.0.0.1:${srv.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const reps = +process.argv[2] || 3; const FRAMES = +process.env.BENCH_FRAMES || 20;
const [W, H, DSF] = (process.env.BENCH_VIEW || '390,844,2').split(',').map(Number);
const configs = JSON.parse(process.env.BENCH_CONFIGS || 'null') || [
  { name: 'OLD: env on every material', aa: true, dpr: 1.75, halo: true, env: true, scope: 'all' },
  { name: 'NEW: env on marbles/metals only', aa: true, dpr: 1.75, halo: true, env: true, scope: 'marbles' },
  { name: 'no env at all (reference)', aa: true, dpr: 1.75, halo: true, env: false, scope: 'marbles' },
];
const rows = [];
for (const cfg of configs) {
  const res = [];
  for (let k = 0; k < reps; k++) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DSF, isMobile: true, hasTouch: true });
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto(B + '/tests/bench.html'); await page.waitForFunction(() => window.benchReady);
    res.push(await page.evaluate(c => window.runBench(c), { ...cfg, frames: FRAMES, sim: +process.env.BENCH_SIM || 40 })); if (errs.length) throw new Error(errs.join('|'));
    await ctx.close();
  }
  const med = (f) => { const a = res.map(f).sort((x, y) => x - y); return a[a.length >> 1]; };
  const row = { name: cfg.name, frameMs: +med(r => r.medianMs).toFixed(1), createMs: +med(r => r.createMs).toFixed(0), envMs: +med(r => r.envMs).toFixed(0), chain: res[0].chain, calls: res[0].calls, tris: res[0].tris, px: res[0].px.join('x'), aa: res[0].aa };
  rows.push(row); console.log(JSON.stringify(row));
}
const base = rows[0].frameMs; console.log('\nconfig | median frame ms | vs baseline | create ms | env build ms | tris | canvas px | MSAA');
for (const r of rows) console.log(`${r.name} | ${r.frameMs} | ${(100 * r.frameMs / base).toFixed(0)}% | ${r.createMs} | ${r.envMs} | ${r.tris} | ${r.px} | ${r.aa}`);
await browser.close(); srv.close();
