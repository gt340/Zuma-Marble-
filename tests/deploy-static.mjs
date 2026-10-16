// Production-like static deployment test.  usage: node tests/deploy-static.mjs <deploy-dir>
// <deploy-dir> should be a clean export of the committed tree (git archive), so untracked/ignored files cannot hide a missing asset.
// The server applies the REAL vercel.json of that directory (filesystem first, then rewrites — Vercel's order for static output) and
// serves no index.html, so "/" only works if the rewrite is right. All off-origin requests are blocked and counted: the game must
// start with the committed Three.js r160, not the CDN. This is an EMULATION of Vercel's static serving, not Vercel itself.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';

const ROOT = path.resolve(process.argv[2] || '.');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.md': 'text/markdown', '.txt': 'text/plain' };
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const rewrites = cfg.rewrites || [], redirects = cfg.redirects || [];
const log = []; const hits = new Map();
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  hits.set(p, (hits.get(p) || 0) + 1);
  let status = 404, served = null, file = path.join(ROOT, p);
  const ok = (f) => f.startsWith(ROOT) && fs.existsSync(f) && fs.statSync(f).isFile();
  const rd = redirects.find(r => r.source === p);
  if (rd) { status = rd.statusCode || 308; log.push({ p, status, to: rd.destination }); res.writeHead(status, { location: rd.destination }); res.end(); return; }
  if (!ok(file)) { const rw = rewrites.find(r => r.source === p); file = rw ? path.join(ROOT, rw.destination) : null; }
  if (file && ok(file)) { status = 200; served = '/' + path.relative(ROOT, file); }
  log.push({ p, status, served });
  if (status !== 200) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'public, max-age=0, must-revalidate' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const get = async (u) => { const r = await fetch(BASE + u, { redirect: 'manual' }); return { status: r.status, type: r.headers.get('content-type'), body: Buffer.from(await r.arrayBuffer()), loc: r.headers.get('location') }; };

// ---- 1. static facts
check('vercel.json: exactly one rewrite "/" -> "/zuma3d-android.html", no redirects', rewrites.length === 1 && rewrites[0].source === '/' && rewrites[0].destination === '/zuma3d-android.html' && redirects.length === 0);
check('deploy dir has no index.html (so "/" depends on the rewrite)', !fs.existsSync(path.join(ROOT, 'index.html')));
const V = path.join(ROOT, 'vendor/three.module.js');
check('vendor/three.module.js present in the export and is the tested r160 file', fs.existsSync(V) && sha(V) === '76dea8151bc9352aef3528b4262e249b2604f62543828328db978d060d61a495', fs.existsSync(V) ? sha(V).slice(0, 16) : 'missing');

// ---- 2. HTTP level: root, game URL, no redirect, assets
const root = await get('/'), game = await get('/zuma3d-android.html');
check('GET / -> 200 (rewrite, not a redirect), same bytes as the game page', root.status === 200 && !root.loc && root.body.equals(game.body) && /text\/html/.test(root.type || ''), `status ${root.status}, ${root.body.length} bytes`);
check('GET /zuma3d-android.html -> 200 directly (no redirect loop)', game.status === 200 && !game.loc);
const html = game.body.toString('utf8');
const refs = [...html.matchAll(/(?:src|href)="(\.?\/?[^"#:]+?)"/g)].map(m => m[1]).filter(u => !u.startsWith('data:') && !/^https?:/.test(u));
const mods = ['main.js', 'core.js', 'view.js', 'render.js', 'quality.js', 'storage.js', 'audio.js', 'sw.js', 'manifest.json', 'icon-192.png', 'icon-512.png', 'vendor/three.module.js'];
const bad = [];
for (const m of [...new Set([...refs.map(r => r.replace(/^\.?\//, '')), ...mods])]) { const r = await get('/' + m); if (r.status !== 200 || !r.body.length) bad.push(m + ':' + r.status); }
check('every asset referenced by the page, plus the modules, SW, manifest, icons and Three.js, returns 200 from the root path', bad.length === 0, bad.join(' ') || `${new Set([...refs, ...mods]).size} files`);
const man = JSON.parse((await get('/manifest.json')).body.toString());
const startOK = (await get('/' + man.start_url.replace(/^\.\//, ''))).status === 200;
check('manifest start_url and icons resolve', startOK && (await Promise.all(man.icons.map(i => get('/' + i.src)))).every(r => r.status === 200));
const t3 = await get('/vendor/three.module.js');
check('Three.js is served as JavaScript (module MIME type)', /javascript/.test(t3.type || ''), t3.type);
check('unknown path -> 404 (no catch-all rewrite masking missing files)', (await get('/does-not-exist.js')).status === 404);

// ---- 3. browser: start from "/" with every off-origin request blocked
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
async function session(viewport, startUrl, label, noWait = false) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage(); const external = [], errors = [], failed = [], reqs = [];
  await ctx.route('**/*', (route) => { const u = route.request().url(); if (!u.startsWith(BASE) && !u.startsWith('data:') && !u.startsWith('blob:')) { external.push(u); return route.abort(); } return route.continue(); });
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push('pageerror ' + e.message));
  page.on('requestfailed', r => failed.push(r.url())); page.on('request', r => reqs.push(r.url()));
  const resp = await page.goto(BASE + startUrl, { waitUntil: 'load' });
  if (!noWait) await page.waitForFunction(() => window.__zuma && window.__zuma.gfx, null, { timeout: 90000 });
  return { ctx, page, external, errors, failed, reqs, resp, label };
}
async function inspect(S, label) {
  const { page } = S;
  const info = await page.evaluate(async () => {
    const T = await import('/vendor/three.module.js'); const z = window.__zuma; const r = z.gfx.renderer;
    return { rev: T.REVISION, real: r instanceof T.WebGLRenderer, gl: !!r.getContext().getParameter(r.getContext().VERSION), canv: document.querySelectorAll('canvas').length, diag: z.diag === null || z.diag === undefined, err: !document.getElementById('screen-error').classList.contains('hidden'), url: location.pathname };
  });
  check(`${label}: page loaded with no redirect, final path ${info.url}`, S.resp.status() === 200 && !S.resp.request().redirectedFrom());
  check(`${label}: the committed Three.js r160 module is the one in use (real WebGLRenderer, same module instance)`, info.rev === '160' && info.real && info.canv === 1, JSON.stringify({ rev: info.rev, real: info.real, canvases: info.canv }));
  check(`${label}: Three.js requested from /vendor/, no request to unpkg or any other origin`, S.reqs.some(u => u.endsWith('/vendor/three.module.js')) && S.external.length === 0, S.external.join(' ') || 'zero off-origin attempts');
  check(`${label}: error screen not shown, no console errors, no failed requests`, !info.err && S.errors.length === 0 && S.failed.length === 0, [...S.errors, ...S.failed].join(' | ') || 'clean');
  check(`${label}: diagnostics disabled by default`, info.diag && !(await page.evaluate(() => !!document.querySelector('#zuma-diag, .zuma-diag'))) && !S.reqs.some(u => u.endsWith('/diag.js')));
}
const A = await session({ width: 390, height: 844 }, '/', 'root URL, portrait 390x844');
await inspect(A, 'root URL');
// gameplay on the deployed-style root
await A.page.evaluate(() => window.__zuma.startCampaign(1)); await A.page.waitForFunction(() => window.__zuma.game && window.__zuma.game.state === 'playing', null, { timeout: 90000 });
const f0 = await A.page.evaluate(() => window.__zuma.gfx.renderer.info.render.frame);
await new Promise(r => setTimeout(r, 6000));
const g = await A.page.evaluate(() => ({ f: window.__zuma.gfx.renderer.info.render.frame, calls: window.__zuma.gfx.renderer.info.render.calls, st: window.__zuma.game.state, shots: window.__zuma.game.shots ? window.__zuma.game.shots.length : -1, marks: window.__zuma.gfx.marks, cw: document.querySelector('canvas').getBoundingClientRect().width, sw: innerWidth, so: document.documentElement.scrollWidth }));
check('root URL: campaign level 1 starts and keeps rendering (frames advance, state playing, marble symbols on by default; no input/shot is simulated here — shooting is covered by the browser suites)', g.f > f0 + 10 && g.st === 'playing' && g.marks === true && g.calls > 0, JSON.stringify(g));
check('root URL: mobile layout — canvas fills the 390 px viewport, no horizontal scroll', Math.abs(g.cw - g.sw) <= 1 && g.so <= g.sw, `canvas ${g.cw}, viewport ${g.sw}, scrollWidth ${g.so}`);
check('root URL: still no errors / off-origin requests after gameplay', A.errors.length === 0 && A.external.length === 0 && A.failed.length === 0, [...A.errors, ...A.external].join(' | ') || 'clean');
await A.page.screenshot({ path: path.join(process.env.SHOT_DIR || '/tmp', 'deploy-root-portrait.png') });
// service worker from root scope: second load comes up offline
const sw = await A.page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return { scope: new URL(r.scope).pathname, active: !!r.active }; });
check('service worker registers with scope "/" from the root URL', sw.active && sw.scope === '/', JSON.stringify(sw));
await A.page.waitForFunction(async () => { const ks = await caches.keys(); if (!ks.length) return false; const c = await caches.open(ks[0]); return !!(await c.match('/vendor/three.module.js')) && !!(await c.match('/main.js')); }, null, { timeout: 30000 }).catch(() => {});
const cached = await A.page.evaluate(async () => { const ks = await caches.keys(); const c = await caches.open(ks[0]); return { v: ks.join(), three: !!(await c.match('/vendor/three.module.js')), main: !!(await c.match('/main.js')) }; });
check('service worker precached Three.js and the game files (offline start possible without the CDN)', cached.three && cached.main, JSON.stringify(cached));
await A.ctx.setOffline(true);
const off = await A.page.reload({ waitUntil: 'load' }).then(async () => { await A.page.waitForFunction(() => window.__zuma && window.__zuma.gfx, null, { timeout: 60000 }); return true; }).catch(e => String(e).slice(0, 120));
check('offline reload of "/" boots from the service-worker cache', off === true, String(off));
await A.ctx.close();

const B = await session({ width: 844, height: 390 }, '/zuma3d-android.html', 'game URL, landscape 844x390');
await inspect(B, 'game URL');
const lw = await B.page.evaluate(() => ({ cw: document.querySelector('canvas').getBoundingClientRect().width, sw: innerWidth, so: document.documentElement.scrollWidth }));
check('game URL: landscape layout fits, no horizontal scroll', Math.abs(lw.cw - lw.sw) <= 1 && lw.so <= lw.sw, JSON.stringify(lw));
await B.ctx.close();

// negative control: without the vendor file the CDN fallback is attempted (blocked here) — proves the test would notice a missing vendor file
const vendorBak = V + '.bak'; fs.renameSync(V, vendorBak);
try {
  const C = await session({ width: 390, height: 844 }, '/', 'control', true);
  await C.page.waitForFunction(() => !document.getElementById('screen-error').classList.contains('hidden'), null, { timeout: 60000 }).catch(() => {});
  const shown = await C.page.evaluate(() => ({ err: !document.getElementById('screen-error').classList.contains('hidden'), ready: !!(window.__zuma && window.__zuma.gfx) }));
  const attempted = C.external.some(u => u.includes('unpkg.com'));
  check('negative control: with vendor/three.module.js removed the CDN is attempted (blocked here) and the game cannot start — the test would catch a missing vendor file', attempted && shown.err && !shown.ready, JSON.stringify({ cdnAttempt: attempted, ...shown }));
  if (C.ctx) await C.ctx.close();
} finally { fs.renameSync(vendorBak, V); }

await browser.close(); server.close();
const loops = log.filter(l => l.p === '/' ).length;
check('no redirect responses were issued at all', !log.some(l => l.status >= 300 && l.status < 400));
const failN = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failN}/${results.length} deploy checks passed`);
fs.writeFileSync(path.join(process.env.SHOT_DIR || '/tmp', 'deploy-static-results.json'), JSON.stringify({ base: 'emulated', requestsByPath: Object.fromEntries(hits), results }, null, 1));
process.exit(failN ? 1 : 0);
