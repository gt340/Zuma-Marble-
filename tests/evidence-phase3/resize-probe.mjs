// Probe: who calls renderer.setSize during an orientation change, with adaptive quality on vs off? (real r160, software GL)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = process.env.ROOT || '/home/claude/p3/zuma3d-v2';
const { chromium } = await import('/opt/npm-tools/node_modules/playwright/index.mjs');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p === '/') p = '/zuma3d-android.html'; const f = path.join(ROOT, p); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
await new Promise(r => srv.listen(0, '127.0.0.1', r)); const B = `http://127.0.0.1:${srv.address().port}`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const q of ['', '?adapt=0']) for (let trial = 0; trial < 3; trial++) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true }); const page = await ctx.newPage();
  await page.goto(B + '/' + q); await page.waitForFunction(() => window.__zuma && window.__zuma.gfx, null, { timeout: 90000 }); await page.evaluate(() => window.__zuma.startCampaign(1));
  await page.evaluate(() => { const r = window.__zuma.gfx.renderer; window.__log = []; const o = r.setSize.bind(r); r.setSize = (...a) => { window.__log.push({ t: Math.round(performance.now()), q: JSON.stringify(window.__zuma.gfx.quality), stack: new Error().stack.split('\n').slice(2, 5).map(s => s.trim().replace(/http:\/\/[^/]+\//, '')).join(' < ') }); return o(...a); }; });
  await new Promise(r => setTimeout(r, 9000));
  const idle = await page.evaluate(() => window.__log.length);
  await page.setViewportSize({ width: 844, height: 390 }); await new Promise(r => setTimeout(r, 6000));
  const log = await page.evaluate(() => window.__log);
  console.log(`\n[${q || 'default'}] trial ${trial}: idle calls ${idle}, after rotate ${log.length}`);
  for (const l of log.slice(idle)) console.log('   ', l.t, l.q, l.stack.slice(0, 200));
  await ctx.close();
}
await browser.close(); srv.close();
