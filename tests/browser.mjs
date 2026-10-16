// Real-browser tests (headless Chromium via Playwright). Run:  node tests/browser.mjs
// IMPORTANT: Three.js cannot be downloaded in every environment, so this serves tests/fixtures/three-stub.js at /vendor/three.module.js.
// It therefore verifies UI, input, game loop, persistence, layout and the service worker — NOT real WebGL output.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REAL = process.env.REAL === '1';
const TM = REAL ? 6 : 1;   // software WebGL is slow: stretch real-time waits
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW = process.env.PLAYWRIGHT_MODULE || '/opt/npm-tools/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SHOTS = process.env.SHOT_DIR || path.join(ROOT, 'tests', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.md': 'text/plain' };
let NOVENDOR_PORT = -1;
const handler = (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/zuma3d-android.html';
  let file = path.join(ROOT, p);
  if (p === '/vendor/three.module.js' && Number(req.headers.host.split(':')[1]) === NOVENDOR_PORT) { res.writeHead(404); res.end('nf'); return; }
  if (p === '/vendor/three.module.js' && !REAL) file = path.join(ROOT, 'tests/fixtures/three-stub.js');
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
};
const server = http.createServer(handler); const server2 = http.createServer(handler);
await new Promise(r => server.listen(0, '127.0.0.1', r)); await new Promise(r => server2.listen(0, '127.0.0.1', r)); NOVENDOR_PORT = server2.address().port;
const BASE = `http://127.0.0.1:${server.address().port}`;

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const browser = await chromium.launch({ executablePath: CHROME, args: REAL ? ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--no-sandbox', '--disable-gpu'] });

async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: REAL ? 1 : 2, hasTouch: true, isMobile: true, ...opts });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('requestfailed', r => { if (!/favicon/.test(r.url())) errors.push('requestfailed: ' + r.url()); });
  page.on('response', r => { if (r.status() >= 400 && !/favicon/.test(r.url())) errors.push('http ' + r.status() + ': ' + r.url()); });
  return { ctx, page, errors };
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));
async function waitState(page, state, timeout = 20000 * TM) { await page.waitForFunction((s) => window.__zuma.game && window.__zuma.game.state === s, state, { timeout }); }
const visible = (page, id) => page.evaluate((i) => !document.getElementById(i).classList.contains('hidden'), id);

try {
  // ============================================================ 1. boot, menu, console cleanliness
  {
    const { ctx, page, errors } = await newPage();
    await page.goto(BASE + '/');
    await page.waitForFunction(() => window.__zuma && window.__zuma.gfx, null, { timeout: 15000 * TM });
    check('boot: menu shown after engine loads', await visible(page, 'screen-menu'));
    check('boot: exactly one canvas and one render loop', (await page.evaluate(() => document.querySelectorAll('canvas').length)) === 1 && (await page.evaluate(() => window.__zuma.loops)) === 1);
    await page.screenshot({ path: path.join(SHOTS, 'menu-portrait.png') });
    check('boot: no console errors / failed requests', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ============================================================ 2. layout on phone/tablet/desktop + HUD overlap checks
  for (const [name, w, h, mobile] of [['portrait-390x844', 390, 844, true], ['portrait-360x640', 360, 640, true], ['portrait-412x915', 412, 915, true], ['landscape-844x390', 844, 390, true], ['landscape-915x412', 915, 412, true], ['landscape-640x360', 640, 360, true], REAL ? ['desktop-960x540', 960, 540, false] : ['desktop-1280x720', 1280, 720, false]]) {
    const { ctx, page, errors } = await newPage({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
    await page.goto(BASE + '/');
    await page.waitForFunction(() => window.__zuma && window.__zuma.gfx, null, { timeout: 15000 * TM });
    await page.evaluate(() => window.__zuma.startCampaign(1)); await waitState(page, 'playing');
    await wait(500);
    const m = await page.evaluate(() => {
      const r = (sel) => { const e = document.querySelector(sel); const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
      const vis = (sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return b.width > 0 && b.left >= -0.5 && b.right <= innerWidth + 0.5 && b.top >= -0.5 && b.bottom <= innerHeight + 0.5; };
      const sels = ['#btn-pause', '#score', '#goal', '#lives', '#tray', '.power[data-power="bomb"]', '.power[data-power="reverse"]'];
      const rects = Object.fromEntries(sels.map(s => [s, r(s)]));
      const touchTargets = [...document.querySelectorAll('#btn-pause, #tray, .power')].map(e => { const b = e.getBoundingClientRect(); return Math.min(b.width, b.height); });
      return { rects, allInside: sels.every(vis), minTarget: Math.min(...touchTargets), scrollW: document.documentElement.scrollWidth, innerW: innerWidth, canvas: (({ width, height }) => ({ width, height }))(document.querySelector('canvas').getBoundingClientRect()),
        topBottom: r('#topbar').b <= r('#bottom .power').y + 1, view: !!window.__zuma.gfx.view };
    });
    check(`layout ${name}: HUD fully inside viewport`, m.allInside, JSON.stringify(m.rects['#tray']));
    const clear = await page.evaluate(async () => {
      const { project, footprint } = await import('/view.js'); const z = window.__zuma, v = z.gfx.view, H = innerHeight, W = innerWidth;
      let minY = 1e9, maxY = -1e9, minX = 1e9, maxX = -1e9;
      for (const p of footprint(z.game.path)) { const q = project(v, [p[0], 0.5, p[1]]); const x = (q[0] + 1) / 2 * W, y = (1 - q[1]) / 2 * H; minY = Math.min(minY, y); maxY = Math.max(maxY, y); minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
      const tb = document.getElementById('topbar').getBoundingClientRect().bottom, bt = Math.min(...[...document.getElementById('bottom').children].map(c => c.getBoundingClientRect().top));
      return { minY, maxY, minX, maxX, tb, bt, W };
    });
    check(`layout ${name}: whole track footprint lies between the HUD bars and inside the screen`, clear.minY >= clear.tb - 1 && clear.maxY <= clear.bt + 1 && clear.minX >= 0 && clear.maxX <= clear.W, JSON.stringify(Object.fromEntries(Object.entries(clear).map(([k, x]) => [k, Math.round(x)]))));
    // transient overlays (banner, combo, danger label) must never overlap each other or the HUD bars while shown together
    const ov = await page.evaluate(() => {
      const ids = ['banner', 'combo', 'danger-label']; const set = { banner: 'LEVEL 10<small>Zuma\'s Heart</small>', combo: 'COMBO x3 · CHAIN', 'danger-label': 'DANGER' };
      const els = ids.map(i => document.getElementById(i)); const saved = els.map(e => e.innerHTML);
      els.forEach((e, i) => { e.innerHTML = set[ids[i]]; e.style.animation = 'none'; e.style.opacity = 1; e.style.transform = 'none'; });
      const rs = els.map(e => { const r = document.createRange(); r.selectNodeContents(e); const b = r.getBoundingClientRect(); return { id: e.id, top: b.top, bottom: b.bottom }; });
      const tb = document.getElementById('topbar').getBoundingClientRect().bottom, bt = Math.min(...[...document.getElementById('bottom').children].map(c => c.getBoundingClientRect().top));
      els.forEach((e, i) => { e.innerHTML = saved[i]; e.style.cssText = ''; });
      const hits = []; for (let a = 0; a < rs.length; a++) { for (let b = a + 1; b < rs.length; b++) if (rs[a].top < rs[b].bottom && rs[b].top < rs[a].bottom) hits.push(rs[a].id + '/' + rs[b].id); if (rs[a].top < tb || rs[a].bottom > bt) hits.push(rs[a].id + ' hits HUD'); }
      return { hits, rs: rs.map(r => `${r.id}:${Math.round(r.top)}-${Math.round(r.bottom)}`), tb: Math.round(tb), bt: Math.round(bt) };
    });
    check(`layout ${name}: GO banner, combo and danger text never overlap each other or the HUD`, ov.hits.length === 0, JSON.stringify(ov));
    const md = await page.evaluate(async () => { const { project } = await import('/view.js'); const v = window.__zuma.gfx.view; const a = project(v, [0, 0.5, 0]), b = project(v, [0.96, 0.5, 0]); return Math.hypot((b[0] - a[0]) / 2 * innerWidth, (b[1] - a[1]) / 2 * innerHeight); });
    check(`layout ${name}: marble diameter on screen >= 14 css px (MEASURED ${md.toFixed(1)}px = ${(100 * md / (await page.evaluate(() => innerWidth))).toFixed(1)}% of width)`, md >= 14);
    check(`layout ${name}: touch targets >= 44px`, m.minTarget >= 44, 'min=' + m.minTarget.toFixed(0));
    check(`layout ${name}: no horizontal overflow, canvas fills viewport`, m.scrollW <= m.innerW && Math.round(m.canvas.width) === w && Math.round(m.canvas.height) === h);
    check(`layout ${name}: top bar does not overlap bottom bar`, m.topBottom);
    await page.screenshot({ path: path.join(SHOTS, `play-${name}.png`) });
    check(`layout ${name}: no console errors`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ============================================================ 3. orientation change / resize keeps game running
  {
    const { ctx, page, errors } = await newPage();
    await page.goto(BASE + '/'); await page.waitForFunction(() => window.__zuma && window.__zuma.gfx);
    await page.evaluate(() => window.__zuma.startCampaign(1)); await waitState(page, 'playing');
    const d0 = await page.evaluate(() => window.__zuma.gfx.view.pos.join(','));
    await page.setViewportSize({ width: 844, height: 390 }); await page.waitForFunction((p) => window.__zuma.gfx.view.pos.join(',') !== p, d0, { timeout: 20000 * TM }); await wait(300);
    const d1 = await page.evaluate(() => ({ pos: window.__zuma.gfx.view.pos.join(','), cw: document.querySelector('canvas').getBoundingClientRect().width }));
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForFunction((p) => window.__zuma.gfx.view.pos.join(',') !== p, d1.pos, { timeout: 20000 * TM }); await wait(300);
    const d2 = await page.evaluate(() => window.__zuma.gfx.view.pos.join(','));
    check('resize: camera re-framed on orientation change and restored', d0 !== d1.pos && d0 === d2 && Math.round(d1.cw) === 844);
    check('resize: no errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ============================================================ 4. input: touch tap/drag fires; pointercancel does not; swap; keyboard
  {
    const { ctx, page, errors } = await newPage();
    await page.goto(BASE + '/'); await page.waitForFunction(() => window.__zuma && window.__zuma.gfx);
    await page.evaluate(() => window.__zuma.startCampaign(1)); await waitState(page, 'playing'); await wait(1500);
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y, id: 1 }] });
    const shots = () => page.evaluate(() => window.__zuma.game.stats.shots);
    const s0 = await shots();
    await touch('touchStart', 200, 300); await touch('touchMove', 150, 280); await touch('touchMove', 120, 250);
    const aimDuring = await page.evaluate(() => ({ ...window.__zuma.aim }));
    await touch('touchEnd');
    await wait(150);
    const s1 = await shots();
    check('input: touch drag updates aim and release fires exactly one shot', s1 === s0 + 1 && aimDuring.active, `shots ${s0}->${s1}`);
    await wait(400);
    await touch('touchStart', 200, 300); await touch('touchMove', 210, 320); await touch('touchCancel');
    await wait(150);
    check('input: pointercancel does NOT shoot and clears the pointer', (await shots()) === s1 && (await page.evaluate(() => window.__zuma.aim.pointerId === null)));
    await wait(400);
    await touch('touchStart', 190, 200); await touch('touchEnd'); await wait(150);
    check('input: a plain tap shoots toward the tapped point', (await shots()) === s1 + 1);
    // aim math: the aim direction must equal the direction from the frog to the tapped world point
    const aimOK = await page.evaluate(() => {
      const z = window.__zuma, v = z.gfx.view; const a = z.aim;
      const x = 190, y = 200, W = innerWidth, H = innerHeight, nx = x / W * 2 - 1, ny = -(y / H * 2 - 1);
      const th = Math.tan(v.fov * Math.PI / 360);
      const d = [0, 1, 2].map(i => v.f[i] + v.r[i] * nx * th * v.aspect + v.u[i] * ny * th); const t = (0.5 - v.pos[1]) / d[1];
      const gx = v.pos[0] + d[0] * t, gz = v.pos[2] + d[2] * t, l = Math.hypot(gx, gz);
      return Math.abs(a.dx - gx / l) < 1e-6 && Math.abs(a.dz - gz / l) < 1e-6;
    });
    check('input: aim equals the ground point under the finger (no parallax error)', aimOK);
    // rapid taps cannot create more than the allowed projectiles / cooldown
    const before = await shots(); const t0 = Date.now(); const gt0 = await page.evaluate(() => window.__zuma.game.t);
    for (let i = 0; i < 12; i++) { await touch('touchStart', 200, 250); await touch('touchEnd'); }
    const el = (await page.evaluate(() => window.__zuma.game.t)) - gt0; const got = (await shots()) - before;
    check('input: 12 rapid taps are limited by the shot cooldown (<= game-time elapsed/0.2 + 1)', got <= Math.floor(el / 0.2) + 1, `shots=${got} in ${el.toFixed(2)}s`);
    // swap button + space key
    await wait(400);
    const c0 = await page.evaluate(() => [window.__zuma.game.cur.color, window.__zuma.game.next.color]);
    await page.click('#tray');
    const c1 = await page.evaluate(() => [window.__zuma.game.cur.color, window.__zuma.game.next.color]);
    await page.keyboard.press('Space');
    const c2 = await page.evaluate(() => [window.__zuma.game.cur.color, window.__zuma.game.next.color]);
    check('input: tray tap swaps current/next; Space swaps back', c1[0] === c0[1] && c1[1] === c0[0] && c2[0] === c0[0] && c2[1] === c0[1]);
    check('input: no errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ============================================================ 5. pause / resume freezes everything
  {
    const { ctx, page, errors } = await newPage();
    await page.goto(BASE + '/'); await page.waitForFunction(() => window.__zuma && window.__zuma.gfx);
    await page.evaluate(() => window.__zuma.startCampaign(2)); await waitState(page, 'playing'); await wait(2500);
    await page.evaluate(() => { window.__zuma.game.fire(0.3, -1); });
    await page.click('#btn-pause');
    const snap = () => page.evaluate(() => ({ d: window.__zuma.game.digest(), t: window.__zuma.game.t, p: window.__zuma.game.paused }));
    const a = await snap(); await wait(1200); const b = await snap();
    check('pause: overlay shown, game frozen (chain, projectiles, timers)', a.p && (await visible(page, 'screen-pause')) && a.d === b.d && a.t === b.t);
    await page.screenshot({ path: path.join(SHOTS, 'pause.png') });
    await page.click('#btn-resume'); await wait(600); const c = await snap();
    check('pause: resume continues the simulation', !c.p && c.d !== b.d);
    await page.evaluate(() => window.__zuma.pause());
    await page.keyboard.press('Escape'); await wait(200);
    check('pause: Escape resumes', !(await snap()).p);
    check('pause: no errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ============================================================ 6. complete playthrough: bot clears level 1, progress persists, next level starts
  {
    const { ctx, page, errors } = await newPage();
    await page.goto(BASE + '/'); await page.waitForFunction(() => window.__zuma && window.__zuma.gfx);
    await page.evaluate(async () => {
      const { Bot } = await import('/tests/bot.mjs');
      window.__bot = null; window.__speed = 4;
      const z = window.__zuma;
      setInterval(() => {                                   // autoplayer + time acceleration (extra simulated time per tick)
        const g = z.game; if (!g || g.paused) return;
        if (!window.__bot || window.__bot.g !== g) window.__bot = new Bot(g, { skill: 0.9, reaction: 0.45, seed: 3 });
        for (let i = 0; i < window.__speed; i++) { for (let k = 0; k < 8; k++) { window.__bot.tick(1 / 120); } g.advance(1 / 60); }
      }, 16);
    });
    await page.evaluate(() => window.__zuma.startCampaign(1));
    await waitState(page, 'complete', 180000 * TM);
    await page.waitForFunction(() => !document.getElementById('screen-complete').classList.contains('hidden'), null, { timeout: 8000 * TM });
    const res = await page.evaluate(() => ({ stars: document.getElementById('complete-stars').textContent, save: JSON.parse(localStorage.getItem('zuma3d.v2')), result: window.__zuma.game.result, loops: window.__zuma.loops, completes: 0 }));
    check('playthrough: level 1 completes and the complete screen shows stars', res.result.won && res.stars.includes('★'));
    check('playthrough: progress persisted (level 2 unlocked, stars, best score)', res.save.unlocked === 2 && res.save.stars['1'] >= 1 && res.save.bestCampaign > 0, JSON.stringify({ u: res.save.unlocked, s: res.save.stars, b: res.save.bestCampaign }));
    await page.screenshot({ path: path.join(SHOTS, 'complete.png') });
    const sc = await page.evaluate(() => window.__zuma.game.score); await wait(1500);
    check('playthrough: completion rewards only once', (await page.evaluate(() => window.__zuma.game.score)) === sc);
    await page.click('#btn-next'); await wait(300);
    const lv = await page.evaluate(() => ({ level: window.__zuma.game.level, state: window.__zuma.game.state, hidden: document.getElementById('screen-complete').classList.contains('hidden'), chain: window.__zuma.game.chain.length }));
    check('playthrough: Next level starts level 2 cleanly', lv.level === 2 && lv.hidden && lv.chain === 0);
    // menu level grid reflects progress
    await page.evaluate(() => window.__zuma.menu()); await page.click('#btn-campaign');
    const grid = await page.evaluate(() => [...document.querySelectorAll('.lv')].map(b => b.className.includes('locked')));
    check('playthrough: level grid unlocks level 2 and locks level 3', grid[1] === false && grid[2] === true);
    await page.screenshot({ path: path.join(SHOTS, 'levels.png') });
    check('playthrough: no console errors during a full level', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ============================================================ 7. game over (life loss x3), stats, clean restart, no duplicates
  {
    const { ctx, page, errors } = await newPage();
    await page.goto(BASE + '/'); await page.waitForFunction(() => window.__zuma && window.__zuma.gfx);
    await page.evaluate(() => window.__zuma.startCampaign(10));
    await waitState(page, 'playing');
    await page.evaluate(() => { window.__tick = setInterval(() => window.__zuma.game && window.__zuma.game.advance(0.2), 16); });   // time-lapse with no shooting
    await waitState(page, 'over', 120000 * TM);
    await page.waitForFunction(() => !document.getElementById('screen-over').classList.contains('hidden'), null, { timeout: 8000 * TM });
    const over = await page.evaluate(() => ({ lives: window.__zuma.game.lives, text: document.getElementById('over-stats').textContent }));
    check('game over: reached with 0 lives; screen shows score, level, combo', over.lives === 0 && /Final score/.test(over.text) && /Level reached/.test(over.text) && /Highest combo/.test(over.text));
    await page.screenshot({ path: path.join(SHOTS, 'gameover.png') });
    await page.evaluate(() => clearInterval(window.__tick));
    const stats0 = await page.evaluate(() => { const z = window.__zuma, S = window.__threeStats; if (S) return { liveGeo: S.liveGeo, liveMat: S.liveMat }; const i = z.gfx.renderer.info; return { liveGeo: i.memory.geometries + i.memory.textures, liveMat: i.programs.length }; });
    await page.click('#btn-again'); await wait(400);
    const fresh = await page.evaluate(() => ({ lives: window.__zuma.game.lives, score: window.__zuma.game.score, chain: window.__zuma.game.chain.length, queue: window.__zuma.game.queue, level: window.__zuma.game.level, loops: window.__zuma.loops, canvases: document.querySelectorAll('canvas').length, over: !document.getElementById('screen-over').classList.contains('hidden') }));
    const stats1 = await page.evaluate(() => { const z = window.__zuma, S = window.__threeStats; if (S) return { liveGeo: S.liveGeo, liveMat: S.liveMat }; const i = z.gfx.renderer.info; return { liveGeo: i.memory.geometries + i.memory.textures, liveMat: i.programs.length }; });
    check('restart: clean state (3 lives, score 0, empty chain, full queue), one loop, one canvas', fresh.lives === 3 && fresh.score === 0 && fresh.chain === 0 && fresh.queue > 0 && fresh.loops === 1 && fresh.canvases === 1 && !fresh.over);
    check('restart: no new GPU objects created per restart (live geometries; <=2 lazily-created materials)', stats1.liveGeo - stats0.liveGeo <= 0 && stats1.liveMat - stats0.liveMat <= 2, `live +${stats1.liveGeo - stats0.liveGeo} geo, +${stats1.liveMat - stats0.liveMat} mat`);
    check('game over: no errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ============================================================ 8. endless mode keeps flowing; many restarts do not leak
  {
    const { ctx, page, errors } = await newPage();
    await page.goto(BASE + '/'); await page.waitForFunction(() => window.__zuma && window.__zuma.gfx);
    await page.evaluate(async () => {
      const { Bot } = await import('/tests/bot.mjs'); const z = window.__zuma;
      setInterval(() => { const g = z.game; if (!g || g.paused) return; if (!window.__bot || window.__bot.g !== g) window.__bot = new Bot(g, { skill: 0.95, reaction: 0.35, seed: 5 }); for (let i = 0; i < 4; i++) { for (let k = 0; k < 8; k++) window.__bot.tick(1 / 120); g.advance(1 / 60); } }, 16);
      z.startEndless();
    });
    await page.waitForFunction(() => window.__zuma.game && window.__zuma.game.level >= 2, null, { timeout: 150000 * TM });
    check('endless: clears wave 1 and continues into wave 2 automatically', true);
    const st = await page.evaluate(() => ({ s: window.__zuma.game.mode, complete: document.getElementById('screen-complete').classList.contains('hidden') }));
    check('endless: no level-complete modal in endless', st.complete);
    const g0 = await page.evaluate(() => { const z = window.__zuma, S = window.__threeStats; if (S) return { g: S.liveGeo, m: S.liveMat }; const i = z.gfx.renderer.info; return { g: i.memory.geometries + i.memory.textures, m: i.programs.length }; });
    for (let i = 0; i < 15; i++) await page.evaluate(() => window.__zuma.startEndless());
    const g1 = await page.evaluate(() => ({ ...(() => { const S = window.__threeStats; if (S) return { geo: S.liveGeo, mat: S.liveMat }; const i = window.__zuma.gfx.renderer.info; return { geo: i.memory.geometries + i.memory.textures, mat: i.programs.length }; })(), loops: window.__zuma.loops, canv: document.querySelectorAll('canvas').length, timers: 1 }));
    check('15 rapid restarts: no live GPU object growth, still one loop & one canvas', g1.geo - g0.g <= 0 && g1.mat - g0.m <= 0 && g1.loops === 1 && g1.canv === 1, `live +${g1.geo - g0.g} geo, +${g1.mat - g0.m} mat`);
    check('endless: no errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ============================================================ 9. settings persist, storage failure tolerated
  {
    const { ctx, page, errors } = await newPage();
    await page.goto(BASE + '/'); await page.waitForFunction(() => window.__zuma && window.__zuma.gfx);
    await page.click('#btn-settings'); await page.click('#set-sfx'); await page.click('#set-guide');
    const sv = await page.evaluate(() => JSON.parse(localStorage.getItem('zuma3d.v2')));
    check('settings: toggles persist to localStorage', sv.sfx === false && sv.guide === false);
    await page.reload(); await page.waitForFunction(() => window.__zuma && window.__zuma.gfx);
    check('settings: restored after reload', (await page.evaluate(() => window.__zuma.save.sfx)) === false);
    await ctx.close();
    const c2 = await browser.newContext({ viewport: { width: 390, height: 844 } }); const p2 = await c2.newPage(); const e2 = [];
    p2.on('pageerror', e => e2.push(e.message));
    await p2.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }); });
    await p2.goto(BASE + '/'); await p2.waitForFunction(() => window.__zuma && window.__zuma.gfx, null, { timeout: 15000 * TM });
    await p2.evaluate(() => window.__zuma.startCampaign(1)); await wait(500);
    check('storage blocked: game still runs without errors', e2.length === 0 && (await p2.evaluate(() => !!window.__zuma.game)), e2.join('|'));
    await c2.close();
  }

  // ============================================================ 10. service worker: installs, caches, app loads offline (stub three at the vendor path)
  {
    const { ctx, page, errors } = await newPage({ serviceWorkers: 'allow' });
    await page.goto(BASE + '/'); await page.waitForFunction(() => window.__zuma && window.__zuma.gfx);
    const sw = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready; await new Promise(r => setTimeout(r, 1200));
      const keys = await caches.keys(); const c = await caches.open(keys[0]); const urls = (await c.keys()).map(r => new URL(r.url).pathname);
      return { active: !!reg.active, keys, urls };
    });
    check('service worker: registered and active', sw.active && sw.keys.length === 1, sw.keys.join(','));
    const need = ['/zuma3d-android.html', '/main.js', '/core.js', '/view.js', '/render.js', '/quality.js', '/diag.js', '/audio.js', '/storage.js', '/manifest.json', '/icon-192.png', '/icon-512.png', '/vendor/three.module.js'];
    check('service worker: all game files + vendored engine cached', need.every(n => sw.urls.includes(n)), 'missing: ' + need.filter(n => !sw.urls.includes(n)).join(','));
    await page.reload(); await page.waitForFunction(() => navigator.serviceWorker.controller);
    await ctx.setOffline(true);
    await page.goto(BASE + '/zuma3d-android.html'); await page.waitForFunction(() => window.__zuma && window.__zuma.gfx, null, { timeout: 15000 * TM });
    check('service worker: page boots fully OFFLINE and shows the menu', await visible(page, 'screen-menu'));
    await page.evaluate(() => window.__zuma.startCampaign(1)); await waitState(page, 'playing');
    check('service worker: a level starts offline', true);
    await page.goto(BASE + '/zuma3d-android.html?debug=1'); await page.waitForFunction(() => window.__zuma && window.__zuma.gfx && window.__zuma.diag, null, { timeout: 20000 * TM });
    check('service worker: ?debug=1 diagnostics also work fully OFFLINE (diag.js is precached)', !!(await page.$('#diag')));
    check('service worker: no page/console/http errors (offline stale-while-revalidate fetches are expected to fail and are ignored)', errors.filter(e => !/net::ERR_INTERNET_DISCONNECTED/.test(e) && !/^requestfailed: /.test(e)).length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ============================================================ 14. race-condition fuzz: random pause/resume/restart/menu/level/keys/visibility while the game runs
  {
    const { ctx, page, errors } = await newPage();
    await page.goto(BASE + '/'); await page.waitForFunction(() => window.__zuma && window.__zuma.gfx);
    const res = await page.evaluate(async (ITER) => {
      const { Bot } = await import('/tests/bot.mjs'); const z = window.__zuma; const bad = []; let seed = 12345;
      const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296; const pick = (a) => a[Math.floor(rnd() * a.length)];
      const wait = (ms) => new Promise(r => setTimeout(r, ms)); const vis = (id) => !document.getElementById(id).classList.contains('hidden');
      const key = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
      const click = (id) => { const e = document.getElementById(id); if (e && e.offsetParent !== null) e.click(); };
      let bot = null, ops = 0; const seen = {};
      const play = (sec) => { const g = z.game; if (!g) return; if (!bot || bot.g !== g) bot = new Bot(g, { skill: 0.9, reaction: 0.3, seed: 5 }); const n = Math.round(sec * 60); for (let i = 0; i < n && !g.paused; i++) { bot.tick(1 / 60); g.advance(1 / 60); } };
      const actions = [
        () => z.startCampaign(1 + Math.floor(rnd() * 3)), () => z.startEndless(), () => z.pause(), () => z.resume(), () => z.menu(),
        () => key('Escape'), () => key('KeyP'), () => key('Space'), () => key('Enter'), () => key('Digit1'), () => key('Digit3'),
        () => play(0.5 + rnd() * 6), () => { const g = z.game; if (g) for (let i = 0; i < 60 * 150 && !g.paused; i++) g.advance(1 / 60); }, () => play(20 + rnd() * 40), () => click('btn-again'), () => click('btn-next'), () => click('btn-resume'), () => click('btn-restart'),
        () => document.dispatchEvent(new Event('visibilitychange')), () => z.aim && z.game && z.game.fire(rnd() - 0.5, -1),
      ];
      for (let k = 0; k < ITER; k++) {
        try { pick(actions)(); } catch (e) { bad.push('op threw: ' + e.message); }
        ops++; await wait(Math.floor(rnd() * 140));
        const g = z.game; if (g) seen[g.state + (g.paused ? '+paused' : '')] = (seen[g.state + (g.paused ? '+paused' : '')] || 0) + 1; if (vis('screen-complete')) seen.completeScreen = (seen.completeScreen || 0) + 1; if (vis('screen-over')) seen.overScreen = (seen.overScreen || 0) + 1;
        const overlays = ['screen-pause', 'screen-complete', 'screen-over'].filter(vis);
        if (overlays.length > 1) bad.push('multiple overlays visible: ' + overlays.join(','));
        if (g) {
          const inv = g.checkInvariants ? g.checkInvariants() : []; if (inv && inv.length) bad.push('invariant: ' + inv.join(';'));
          if (vis('screen-pause') && !g.paused) bad.push('pause screen visible but game not paused');
          if (g.paused && !vis('screen-pause') && !vis('screen-menu') && g.state !== 'over') bad.push('game paused but no pause screen (state ' + g.state + ')');
          if (vis('screen-over') && g.state !== 'over') bad.push('game-over screen over a live game (state ' + g.state + ')');
          if (vis('screen-complete') && g.state !== 'complete') bad.push('complete screen over a live game (state ' + g.state + ')');
          if (g.lives < 0 || g.lives > 3) bad.push('lives out of range ' + g.lives);
        }
        if (bad.length > 6) break;
      }
      return { ops, seen, bad: bad.slice(0, 8), loops: z.loops, canvases: document.querySelectorAll('canvas').length };
    }, REAL ? 160 : 450);
    check('race fuzz: ' + res.ops + ' random UI/game operations: no inconsistent screens, invariants hold', res.bad.length === 0, res.bad.join(' | '));
    check('race fuzz coverage: states reached ' + JSON.stringify(res.seen), REAL ? Object.keys(res.seen).length >= 4 : (res.seen.complete || res.seen.completeScreen) && (res.seen.over || res.seen.overScreen) && res.seen['playing+paused'] && res.seen.intro !== undefined, JSON.stringify(res.seen));
    check('race fuzz: still exactly one render loop and one canvas', res.loops === 1 && res.canvases === 1);
    check('race fuzz: no page/console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // ============================================================ 15. adaptive quality reacts on a slow renderer (software WebGL here is slow by nature)
  if (REAL) {
    const { ctx, page, errors } = await newPage();
    await page.goto(BASE + '/'); await page.waitForFunction(() => window.__zuma && window.__zuma.gfx);
    await page.evaluate(() => window.__zuma.startCampaign(1));
    const t0 = Date.now();
    await page.waitForFunction(() => window.__zuma.gfx.quality.level >= 1, null, { timeout: 150000 }).catch(() => {});
    const q = await page.evaluate(() => window.__zuma.gfx.quality), secs = (Date.now() - t0) / 1000;
    check('adaptive quality: on a slow renderer it steps down after sustained overload and the step is kept because it helped (level >= 1, final rung = 0.75x + no halo on a DPR-1 screen; measured ' + secs.toFixed(0) + ' s)', q.level >= 1 && q.dprCap === 0.75 && q.haloOn === false && q.reverts === 0 && q.adaptive, JSON.stringify(q));
    check('adaptive quality: no errors and game still running', errors.length === 0 && (await page.evaluate(() => !!window.__zuma.game)), errors.join('|'));
    await ctx.close();
  }

  // ============================================================ 16. rendered colour separation (REAL renderer: reads actual pixels at marble centres)
  if (REAL) {
    const { ctx, page, errors } = await newPage({ viewport: { width: 360, height: 640 } });
    await page.goto(BASE + '/'); await page.waitForFunction(() => window.__zuma && window.__zuma.gfx);
    await page.evaluate(() => window.__zuma.startCampaign(7));
    await page.waitForFunction(() => window.__zuma.gfx.envBuildMs > 0, null, { timeout: 60000 * TM });   // reflections are generated after the first frame
    const sep = await page.evaluate(async () => {
      const { project } = await import('/view.js'); const z = window.__zuma, g = z.game, gfx = z.gfx; const gl = gfx.renderer.getContext();
      for (let i = 0; i < 60 * 22; i++) g.advance(1 / 60);
      gfx.setMarks(false);                                                          // this section measures the marble COLOURS at the centre; the dark mark glyph sits there (marks are tested in section 19 and tests/marks.mjs)
      gfx.frame(g, 0, { dx: 0, dz: -1, guide: false, pred: null });                // same task as the reads below: the drawing buffer is still valid
      const v = gfx.view, cw = gfx.canvas.width, ch = gfx.canvas.height, acc = {}, buf = new Uint8Array(4);
      for (const b of g.chain) {
        if (b.token || b.color < 0) continue; const p = g.path.pos(b.s, {}), q = project(v, [p.x, 0.5, p.z]); const x = Math.round((q[0] + 1) / 2 * cw), y = Math.round((q[1] + 1) / 2 * ch);
        if (x < 3 || y < 3 || x > cw - 3 || y > ch - 3) continue;
        let r = 0, gg = 0, bb = 0, n = 0; for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { gl.readPixels(x + dx, y + dy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf); r += buf[0]; gg += buf[1]; bb += buf[2]; n++; }
        (acc[b.color] = acc[b.color] || []).push([r / n, gg / n, bb / n]);
      }
      const lab = ([r, g2, b2]) => { const f = c => (c /= 255) > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92; r = f(r); g2 = f(g2); b2 = f(b2); const X = (0.4124 * r + 0.3576 * g2 + 0.1805 * b2) / 0.95047, Y = 0.2126 * r + 0.7152 * g2 + 0.0722 * b2, Z = (0.0193 * r + 0.1192 * g2 + 0.9505 * b2) / 1.08883; const t = u => u > 0.008856 ? Math.cbrt(u) : 7.787 * u + 16 / 116; return [116 * t(Y) - 16, 500 * (t(X) - t(Y)), 200 * (t(Y) - t(Z))]; };
      const mean = Object.fromEntries(Object.entries(acc).map(([k, a]) => [k, [0, 1, 2].map(c => a.reduce((s2, x) => s2 + x[c], 0) / a.length)]));
      const ks = Object.keys(mean); let min = 1e9, pair = ''; for (const a of ks) for (const b of ks) if (a < b) { const L1 = lab(mean[a]), L2 = lab(mean[b]), d = Math.hypot(L1[0] - L2[0], L1[1] - L2[1], L1[2] - L2[2]); if (d < min) { min = d; pair = a + '/' + b; } }
      return { colours: ks.length, counts: Object.fromEntries(Object.entries(acc).map(([k, a]) => [k, a.length])), min, pair };
    });
    check('colour separation: all 6 colours present on screen at 360x640 and the closest pair has rendered dE76 >= 33 (measured ' + sep.min.toFixed(1) + ' for pair ' + sep.pair + '; was 23.4 before the yellow/orange re-spacing)', sep.colours >= 5 && sep.min >= 33, JSON.stringify(sep));
    check('colour separation: no errors', errors.length === 0, errors.join('|'));
    await ctx.close();
  }

  // ============================================================ 17. URL graphics overrides + resize churn
  if (REAL) {
    const { ctx, page, errors } = await newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(BASE + '/?aa=0&dpr=1.25&halo=0&env=0&adapt=0'); await page.waitForFunction(() => window.__zuma && window.__zuma.gfx);
    await page.evaluate(() => window.__zuma.startCampaign(1)); await wait(1500);
    const f = await page.evaluate(() => ({ q: window.__zuma.gfx.quality, aa: window.__zuma.gfx.renderer.getContext().getContextAttributes().antialias, ratio: window.__zuma.gfx.renderer.getPixelRatio(), env: window.__zuma.gfx.envBuildMs }));
    check('graphics overrides: ?aa=0&dpr=1.25&halo=0&env=0 are honoured', f.aa === false && f.q.dprCap === 1.25 && f.q.haloOn === false && f.ratio <= 1.25 && f.env === 0, JSON.stringify(f));
    await page.evaluate(() => window.__zuma.startCampaign(1)); await wait(300 * TM);
    const q0 = await page.evaluate(() => window.__zuma.gfx.quality);
    check('graphics overrides: ?adapt=0 keeps adaptive quality disabled', q0.dprCap === 1.25 && q0.haloOn === false);
    check('graphics overrides: no errors', errors.length === 0, errors.join('|'));
    await ctx.close();
    const c2 = await newPage({ viewport: { width: 390, height: 844 } });
    await c2.page.goto(BASE + '/?dpr=banana&aa=maybe'); await c2.page.waitForFunction(() => window.__zuma && window.__zuma.gfx);
    check('graphics overrides: garbage values are ignored (defaults, no errors)', (await c2.page.evaluate(() => window.__zuma.gfx.quality.dprCap)) === 1.75 && c2.errors.length === 0, c2.errors.join('|'));
    await c2.ctx.close();
    const c3 = await newPage({ viewport: { width: 390, height: 844 } });
    await c3.page.goto(BASE + '/?adapt=0'); await c3.page.waitForFunction(() => window.__zuma && window.__zuma.gfx); await c3.page.evaluate(() => window.__zuma.startCampaign(1));   // adaptive quality off: it legitimately resizes by itself (a quality step), which is tested separately
    await c3.page.evaluate(() => { const r = window.__zuma.gfx.renderer; window.__sz = 0; const o = r.setSize.bind(r); r.setSize = (...a) => { window.__sz++; return o(...a); }; });
    await wait(1500 * TM);
    const idle = await c3.page.evaluate(() => window.__sz);
    await c3.page.setViewportSize({ width: 844, height: 390 }); await c3.page.waitForFunction(() => window.__sz > 0, null, { timeout: 30000 * TM }); await wait(800 * TM);
    const rot = await c3.page.evaluate(() => window.__sz);
    check('resize: setSize is never called while idle and exactly once per orientation change (was twice before Phase 3; idle ' + idle + ', rotate ' + rot + ')', idle === 0 && rot - idle === 1, `idle=${idle} afterRotate=${rot}`);
    await c3.ctx.close();
  }

  // ============================================================ 18. on-device diagnostics (?debug=1): off by default, no extra loop, exports a report
  {
    const a = await newPage(); const reqs = []; a.page.on('request', r => reqs.push(r.url()));
    await a.page.goto(BASE + '/'); await a.page.waitForFunction(() => window.__zuma && window.__zuma.gfx, null, { timeout: 15000 * TM });
    check('diagnostics: absent without ?debug=1 (no panel, diag.js never requested, no diag object)', !(await a.page.$('#diag')) && !reqs.some(u => u.endsWith('/diag.js')) && (await a.page.evaluate(() => window.__zuma.diag)) === null);
    await a.ctx.close();
    check('diagnostics: diag.js starts no render loop of its own (no requestAnimationFrame in the module)', !/requestAnimationFrame/.test(fs.readFileSync(path.join(ROOT, 'diag.js'), 'utf8')));
    const { ctx, page, errors } = await newPage({ viewport: { width: 390, height: 844 } });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE }).catch(() => {});
    await page.goto(BASE + '/?debug=1'); await page.waitForFunction(() => window.__zuma && window.__zuma.gfx && window.__zuma.diag, null, { timeout: 20000 * TM });
    await page.evaluate(() => window.__zuma.startCampaign(2)); await waitState(page, 'playing');
    await page.waitForFunction(() => window.__zuma.diag.report().frames.playFrames >= 15, null, { timeout: 60000 * TM });
    const shotsBefore = await page.evaluate(() => window.__zuma.game.stats.shots);
    const panel = await page.evaluate(() => { const b = document.getElementById('diag').getBoundingClientRect(), t = document.getElementById('topbar').getBoundingClientRect(); return { top: b.top, topbarBottom: t.bottom, w: b.width, text: document.getElementById('diag').innerText, buttons: [...document.querySelectorAll('#diag button')].map(x => { const r = x.getBoundingClientRect(); return [x.textContent, Math.round(r.width), Math.round(r.height)]; }), loops: window.__zuma.loops, canv: document.querySelectorAll('canvas').length }; });
    check('diagnostics: panel shows fps/frame stats, sits below the top bar, 4 buttons >= 30px tall, still exactly one loop and one canvas', /fps/.test(panel.text) && panel.top >= panel.topbarBottom - 1 && panel.buttons.length === 4 && panel.buttons.every(b => b[2] >= 30) && panel.loops === 1 && panel.canv === 1, JSON.stringify(panel));
    // taps on the panel buttons must never fire a shot
    for (const label of ['Copy', 'Reset']) { const bb = await page.evaluate((l) => { const b = [...document.querySelectorAll('#diag button')].find(x => x.textContent === l).getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; }, label); await page.touchscreen.tap(bb[0], bb[1]); await wait(150); }
    check('diagnostics: tapping panel buttons does not fire a shot', (await page.evaluate(() => window.__zuma.game.stats.shots)) === shotsBefore);
    // a real shot -> input-to-frame sample; injected console.error + uncaught error are captured
    await page.waitForFunction(() => window.__zuma.game.shotCd <= 0, null, { timeout: 20000 * TM }); await page.touchscreen.tap(195, 330);
    await page.evaluate(() => { console.error('diag-test-console-error'); setTimeout(() => { throw new Error('diag-test-uncaught'); }, 0); });
    await wait(600 * TM);
    const rep = await page.evaluate(() => { window.__zuma.diag.snapshot('test'); return JSON.parse(JSON.stringify(window.__zuma.diag.report())); });
    check('diagnostics: report is valid JSON with device, frame stats, samples, events, errors', rep.device && rep.device.userAgent && rep.device.viewport === '390x844' && rep.frames.playFrames >= 10 && rep.frames.meanMs > 0 && rep.frames.p95Ms >= rep.frames.p50Ms && Array.isArray(rep.samples) && rep.samples.length >= 2 && Array.isArray(rep.events) && Array.isArray(rep.errors), JSON.stringify({ viewport: rep.device && rep.device.viewport, frames: rep.frames, samples: rep.samples && rep.samples.length }));
    check('diagnostics: shot recorded an input-to-frame delay sample', rep.inputToFrameMs.n >= 1 && rep.inputToFrameMs.mean >= 0 && rep.inputToFrameMs.mean < 5000, JSON.stringify(rep.inputToFrameMs));
    check('diagnostics: console.error and uncaught exceptions are captured in the report', rep.errors.some(e => /diag-test-console-error/.test(e.msg)) && rep.errors.some(e => /diag-test-uncaught/.test(e.msg)), JSON.stringify(rep.errors.slice(-4)));
    // Save (download) and Copy (clipboard) produce the same kind of JSON
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.evaluate(() => [...document.querySelectorAll('#diag button')].find(x => x.textContent === 'Save').click())]);
    const dlPath = await dl.path(); let dlJson = null; try { dlJson = JSON.parse(fs.readFileSync(dlPath, 'utf8')); } catch { /* ignore */ }
    check('diagnostics: Save downloads zuma-report-*.json that parses (' + dl.suggestedFilename() + ')', /^zuma-report-.*\.json$/.test(dl.suggestedFilename()) && dlJson && dlJson.device && Array.isArray(dlJson.errors));
    await page.evaluate(() => [...document.querySelectorAll('#diag button')].find(x => x.textContent === 'Copy').click()); await wait(500);
    const clip = await page.evaluate(async () => { try { return JSON.parse(await navigator.clipboard.readText()).device.viewport; } catch (e) { return 'ERR ' + e.message; } });
    const flash = await page.evaluate(() => document.getElementById('diag').innerText);
    check('diagnostics: Copy puts the report on the clipboard (or says it is blocked)', clip === '390x844' || /copy blocked/.test(flash), clip + ' / ' + flash.split('\n').pop());
    // debug mode opens every level in the grid for testers but never changes the saved progress
    await page.evaluate(() => window.__zuma.menu());
    const unl = await page.evaluate(() => { document.getElementById('btn-campaign').click(); const lv = [...document.querySelectorAll('#level-grid .lv')]; return { n: lv.length, lockedCount: lv.filter(b => b.classList.contains('locked')).length, saved: window.__zuma.save.unlocked }; });
    check('diagnostics: ?debug=1 shows all levels open in the grid while saved progress stays at level ' + unl.saved, unl.n === 10 && unl.lockedCount === 0 && unl.saved === 1, JSON.stringify(unl));
    check('diagnostics: only the injected errors appeared on the page', errors.every(e => /diag-test/.test(e)), errors.join('|'));
    await ctx.close();
  }

  // ============================================================ 19. marble marks (Phase 4): default on, Settings toggle, ?marks=0, tray glyphs, cheap in draw calls
  {
    const { ctx, page, errors } = await newPage();
    await page.goto(BASE + '/'); await page.waitForFunction(() => window.__zuma && window.__zuma.gfx, null, { timeout: 20000 * TM });
    const d0 = await page.evaluate(() => ({ save: window.__zuma.save.marks, gfx: window.__zuma.gfx.marks, sw: document.getElementById('set-marks').classList.contains('on') }));
    check('marks: ON by default (saved setting, renderer and Settings switch agree)', d0.save === true && d0.gfx === true && d0.sw === true, JSON.stringify(d0));
    await page.evaluate(() => window.__zuma.startCampaign(1)); await waitState(page, 'playing');
    const trayOn = await page.evaluate(() => getComputedStyle(document.getElementById('cur').querySelector('.marble') || document.getElementById('cur')).getPropertyValue('--g'));
    check('marks: tray marbles carry a glyph image when marks are on', /^\s*url\(["']?data:image\/png/.test(trayOn), trayOn.slice(0, 40));
    if (REAL) {
      const calls = await page.evaluate(() => { const g = window.__zuma.gfx, z = window.__zuma; const info = g.renderer.info, A = { dx: 0, dz: -1, guide: false, pred: null }; z.pause(); g.setMarks(true); g.frame(z.game, 0, A); const on = info.render.calls; g.setMarks(false); g.frame(z.game, 0, A); const off = info.render.calls; g.setMarks(true); return { on, off }; });
      check('marks: cost is at most one instanced draw per marble type plus the shooter and shots (<= +12 draw calls; ' + calls.on + ' vs ' + calls.off + ')', calls.on - calls.off >= 0 && calls.on - calls.off <= 12, JSON.stringify(calls));
      await page.evaluate(() => window.__zuma.resume && window.__zuma.resume());
    }
    // Settings toggle: off -> glyphs gone from the tray and the renderer, persisted; survives reload
    await page.evaluate(() => { window.__zuma.pause(); document.getElementById('btn-pause-settings').click(); });
    await page.evaluate(() => document.getElementById('set-marks').click()); await wait(200 * TM);
    const off1 = await page.evaluate(() => ({ save: JSON.parse(localStorage.getItem('zuma3d.v2')).marks, gfx: window.__zuma.gfx.marks, sw: document.getElementById('set-marks').classList.contains('on'), g: getComputedStyle(document.getElementById('cur').querySelector('.marble') || document.getElementById('cur')).getPropertyValue('--g').trim() }));
    check('marks: Settings switch turns them off everywhere and persists', off1.save === false && off1.gfx === false && off1.sw === false && off1.g === 'none', JSON.stringify(off1));
    await page.reload(); await page.waitForFunction(() => window.__zuma && window.__zuma.gfx, null, { timeout: 20000 * TM });
    const off2 = await page.evaluate(() => ({ save: window.__zuma.save.marks, gfx: window.__zuma.gfx.marks }));
    check('marks: the choice survives a reload', off2.save === false && off2.gfx === false, JSON.stringify(off2));
    await page.evaluate(() => { document.getElementById('btn-settings').click(); document.getElementById('set-marks').click(); }); await wait(200 * TM);
    check('marks: switching back on restores them', await page.evaluate(() => window.__zuma.save.marks === true && window.__zuma.gfx.marks === true));
    check('marks: no console errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
    // ?marks=0 is a session override: honoured, but never rewrites the saved setting
    const u = await newPage();
    await u.page.goto(BASE + '/?marks=0'); await u.page.waitForFunction(() => window.__zuma && window.__zuma.gfx, null, { timeout: 20000 * TM });
    await u.page.evaluate(() => window.__zuma.startCampaign(1)); await waitState(u.page, 'playing');
    const ov = await u.page.evaluate(() => ({ gfx: window.__zuma.gfx.marks, save: window.__zuma.save.marks, stored: (JSON.parse(localStorage.getItem('zuma3d.v2') || '{}')).marks, g: getComputedStyle(document.getElementById('cur').querySelector('.marble') || document.getElementById('cur')).getPropertyValue('--g').trim() }));
    check('marks: ?marks=0 turns them off for the session without changing the saved setting', ov.gfx === false && ov.save === true && ov.stored !== false && ov.g === 'none', JSON.stringify(ov));
    await u.ctx.close();
  }

  // ============================================================ 20. diagnostics audit (Phase 4 / Gate 4): privacy of the report, no storage/network, saved progress untouched, pause/restart/rotate
  {
    const src = fs.readFileSync(path.join(ROOT, 'diag.js'), 'utf8');
    check('diag audit: the module contains no network, storage, cookie or socket calls (nothing can leave the device or touch saved progress)', !/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|localStorage|sessionStorage|indexedDB|document\.cookie|EventSource)\b/.test(src.replace(/\/\/.*$/gm, '')));
    const { ctx, page, errors } = await newPage({ viewport: { width: 390, height: 844 } });
    const reqs = []; page.on('request', r => reqs.push(r.url()));
    await page.goto(BASE + '/?debug=1&secret=abc123&dpr=1.25&token=zzz#frag');
    await page.waitForFunction(() => window.__zuma && window.__zuma.gfx && window.__zuma.diag, null, { timeout: 20000 * TM });
    await page.evaluate(() => { document.getElementById('btn-settings').click(); document.getElementById('set-guide').click(); document.getElementById('btn-settings-back').click(); });   // create a real save first so the before/after comparison below is meaningful
    await page.evaluate(() => window.__zuma.startCampaign(1)); await waitState(page, 'playing');
    await page.evaluate(() => { console.error('boom at ' + location.origin + '/main.js:1:1'); });
    const before = await page.evaluate(() => JSON.stringify(localStorage.getItem('zuma3d.v2')));
    await page.waitForFunction(() => window.__zuma.diag.report().frames.playFrames >= 20, null, { timeout: 60000 * TM });
    const rep = await page.evaluate(() => JSON.parse(JSON.stringify(window.__zuma.diag.report())));
    const txt = JSON.stringify(rep);
    check('diag audit: report "page" is the path plus whitelisted graphics flags only (no secret/token/fragment/host): ' + rep.page, /^\/[^?#]*\?dpr=1\.25&debug=1$/.test(rep.page) && !/abc123|zzz|frag|secret|token/.test(txt) && !/127\.0\.0\.1/.test(txt), rep.page);
    check('diag audit: captured console errors have the site address stripped', rep.errors.some(e => /boom at \/main\.js/.test(e.msg)) && !/127\.0\.0\.1/.test(txt));
    check('diag audit: report carries a plain-language privacy statement and no save data (no score history, no settings object)', typeof rep.privacy === 'string' && /Nothing is sent/.test(rep.privacy) && !/"sfx"|"haptics"|"best"/.test(txt), '');
    const keys = await page.evaluate(() => Object.keys(localStorage).sort().join(','));
    check('diag audit: the only localStorage key is the game save (diagnostics create none): ' + keys, keys === 'zuma3d.v2');
    check('diag audit: no request leaves the origin while diagnostics run', reqs.every(u => u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')), reqs.filter(u => !u.startsWith(BASE)).join(','));
    // pause / resume / restart / rotate with diagnostics on: one loop, one canvas, panel stays inside the viewport, save unchanged by diag itself
    await page.evaluate(() => window.__zuma.pause()); await wait(400 * TM);
    const paused = await page.evaluate(() => ({ loops: window.__zuma.loops, canv: document.querySelectorAll('canvas').length, f: window.__zuma.diag.report().frames.playFrames }));
    await wait(500 * TM); const f2 = await page.evaluate(() => window.__zuma.diag.report().frames.playFrames);
    check('diag audit: paused frames are not counted as play frames, still one loop/one canvas', paused.loops === 1 && paused.canv === 1 && f2 === paused.f, JSON.stringify({ paused, f2 }));
    await page.evaluate(() => window.__zuma.resume()); await page.evaluate(() => window.__zuma.startCampaign(1)); await waitState(page, 'playing');
    await page.setViewportSize({ width: 844, height: 390 }); await wait(900 * TM);
    const rot = await page.evaluate(() => { const b = document.getElementById('diag').getBoundingClientRect(); return { inside: b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight, loops: window.__zuma.loops, canv: document.querySelectorAll('canvas').length, vp: window.__zuma.diag.report().device.viewport, ev: window.__zuma.diag.report().events.some(e => e.type === 'viewport') }; });
    check('diag audit: after rotation the panel is inside the viewport, viewport event logged, one loop/one canvas', rot.inside && rot.loops === 1 && rot.canv === 1 && rot.vp === '844x390' && rot.ev, JSON.stringify(rot));
    const after = await page.evaluate(() => { window.__zuma.diag.reset(); return JSON.stringify(localStorage.getItem('zuma3d.v2')); });
    check('diag audit: the saved progress string is byte-identical before and after a whole diagnostics session incl. Reset (nothing written, nothing corrupted)', after === before, before.slice(0, 80) + ' / ' + after.slice(0, 80));
    check('diag audit: no unexpected errors', errors.every(e => /boom at/.test(e)), errors.join('|'));
    await ctx.close();
  }

  // ============================================================ 13. offline layers, tested separately
  if (REAL) {
    // (a) shell cached but NO engine file and no CDN reachable: must show the error state, never a blank screen
    const B2 = `http://127.0.0.1:${NOVENDOR_PORT}`;
    const { ctx, page } = await newPage({ serviceWorkers: 'allow' });
    await page.route('https://unpkg.com/**', r => r.abort());
    await page.goto(B2 + '/'); await page.waitForFunction(() => !document.getElementById('screen-error').classList.contains('hidden'), null, { timeout: 15000 * TM });
    await page.evaluate(async () => { await navigator.serviceWorker.ready; await new Promise(r => setTimeout(r, 1000)); });
    await ctx.setOffline(true);
    await page.goto(B2 + '/zuma3d-android.html'); await wait(1500);
    const st = await page.evaluate(() => ({ err: !document.getElementById('screen-error').classList.contains('hidden'), msg: document.getElementById('error-msg').textContent, shell: !!document.querySelector('h1') }));
    check('offline (a): app shell loads offline from cache but, without the engine file, shows the explanatory error screen', st.err && /Three\.js/.test(st.msg), st.msg.slice(0, 80));
    await ctx.close();
    // (b) engine from the CDN fallback (CDN SIMULATED by routing the URL to the local r160 file; real unpkg is unreachable here)
    const c2 = await newPage();
    await c2.page.route('https://unpkg.com/three@0.160.0/build/three.module.js', r => r.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(path.join(ROOT, 'vendor/three.module.js')) }));
    await c2.page.goto(B2 + '/'); await c2.page.waitForFunction(() => window.__zuma && window.__zuma.gfx, null, { timeout: 20000 * TM });
    check('offline (b): with vendor file absent the CDN fallback path loads the engine (CDN simulated)', await visible(c2.page, 'screen-menu'));
    await c2.ctx.close();
  }

  // ============================================================ 12. audio: no context before a gesture; running after a real touch; sounds are produced
  {
    const { ctx, page, errors } = await newPage();
    await page.addInitScript(() => {
      const AC = window.AudioContext; window.__ac = { made: [], osc: 0, noise: 0 };
      window.AudioContext = class extends AC { constructor(...a) { super(...a); window.__ac.made.push(this); const co = this.createOscillator.bind(this); this.createOscillator = () => { window.__ac.osc++; return co(); }; const cb = this.createBufferSource.bind(this); this.createBufferSource = () => { window.__ac.noise++; return cb(); }; } };
    });
    await page.goto(BASE + '/'); await page.waitForFunction(() => window.__zuma && window.__zuma.gfx);
    await wait(500);
    check('audio: no AudioContext is created before any user gesture', (await page.evaluate(() => window.__ac.made.length)) === 0);
    const cdp = await ctx.newCDPSession(page);
    const box = await page.evaluate(() => { const b = document.getElementById('btn-campaign').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x, y: box.y }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForFunction(() => window.__ac.made.length > 0, null, { timeout: 10000 * TM });
    await page.waitForFunction(() => window.__ac.made[0].state === 'running', null, { timeout: 10000 * TM }).catch(() => {});
    check('audio: after a real touch gesture the AudioContext exists and is running', await page.evaluate(() => window.__ac.made.length === 1 && window.__ac.made[0].state === 'running'), await page.evaluate(() => window.__ac.made.map(c => c.state).join(',')));
    await page.evaluate(() => window.__zuma.startCampaign(1)); await waitState(page, 'playing');
    const o0 = await page.evaluate(() => window.__ac.osc + window.__ac.noise);
    await page.evaluate(() => { const g = window.__zuma.game; g.fire(0, -1); });
    await wait(600 * TM);
    check('audio: firing produces oscillator/noise voices', (await page.evaluate(() => window.__ac.osc + window.__ac.noise)) > o0);
    check('audio: no errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ============================================================ 11. engine load failure shows a readable error (no CDN, no vendor)
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const page = await ctx.newPage();
    await page.route('**/vendor/three.module.js', r => r.fulfill({ status: 404, body: 'nf' }));
    await page.route('https://unpkg.com/**', r => r.abort());
    await page.goto(BASE + '/'); await page.waitForFunction(() => !document.getElementById('screen-error').classList.contains('hidden'), null, { timeout: 15000 * TM });
    check('failure: missing Three.js shows an error screen with guidance', /Three\.js/.test(await page.textContent('#error-msg')));
    await ctx.close();
  }
} catch (e) {
  check('test run completed without throwing', false, e.stack || String(e));
} finally {
  await browser.close(); server.close(); server2.close();
}
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`);
fs.writeFileSync(path.join(ROOT, 'tests', REAL ? 'browser-results-real.json' : 'browser-results-stub.json'), JSON.stringify({ when: new Date().toISOString(), note: REAL ? 'REAL three.js r160 on SwiftShader (software WebGL)' : 'Three.js replaced by tests/fixtures/three-stub.js — UI/input/loop/SW verified, WebGL output NOT verified', results }, null, 1));
process.exit(failed.length ? 1 : 0);
