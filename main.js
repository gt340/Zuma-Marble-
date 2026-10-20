// main.js — UI, input, audio hookup and the single render loop. Game rules live in core.js; drawing lives in render.js.
import { Game, LEVEL_COUNT, SLOW_DUR, MAX_CHARGE } from './core.js';
import { pointerToAim } from './view.js';
import { createGfx, COLOR_CSS, iconURL, markURL } from './render.js';
import { Sound } from './audio.js';
import { loadSave, saveSave, resetSave } from './storage.js';

const $ = (id) => document.getElementById(id);
const sound = new Sound();
let save = loadSave();
let gfx = null, game = null, session = null;
let sessionId = 0, rafId = 0, lastT = 0, W = 0, H = 0;
const laterTimers = new Set();
const aim = { dx: 0, dz: -1, active: false, pointerId: null, keyL: false, keyR: false };
let hintShown = 0;

// ------------------------------------------------------------------ helpers
// Optional URL overrides for A/B testing graphics on a real device (see DEVICE-TEST.md): ?aa=0 ?dpr=1.25 ?halo=0 ?env=0 ?adapt=0. Defaults when absent.
function gfxFlags() {
  const o = {}; try {
    const q = new URLSearchParams(location.search), num = (k) => { const v = parseFloat(q.get(k)); return Number.isFinite(v) ? v : null; };
    if (q.get('aa') === '0') o.antialias = false;
    if (num('dpr') !== null) o.dprCap = Math.min(3, Math.max(0.5, num('dpr')));
    if (q.get('halo') === '0') o.halo = false;
    if (q.get('marks') === '0') o.marks = false;                       // A/B aid: hide the marble shapes for this page load (saved setting untouched)
    if (q.get('env') === '0') o.envMap = false;
    if (q.get('adapt') === '0') o.adaptive = false;
    if (q.get('guidedots') === '0' && q.get('debug') === '1') o.guideDots = false; // diagnostic only: keep prediction, hide rendered aim dots
    if (q.get('hudblur') === '0') {
      document.documentElement.classList.add('hud-blur-off');
      console.info('[zuma] HUD override', { backdropBlur: false });
    }
    if (Object.keys(o).length) console.info('[zuma] graphics overrides', o);
  } catch { /* ignore */ }
  return o;
}
// px rows occupied by the HUD (top bar bottom edge, bottom controls top edge); null when the HUD is not laid out
// On-device diagnostics (?debug=1 only): the module is not even requested otherwise.
let diag = null;
const pendingGpuTiming = [];
const bootStartedAt = performance.now();
const pendingBootPhases = [];
let firstFrameTimingRecorded = false;
function recordBootPhase(name, start, end = performance.now()) {
  const sample = { name, durationMs: Math.max(0, end - start), sinceBootMs: Math.max(0, end - bootStartedAt) };
  if (diag && typeof diag.bootPhase === 'function') diag.bootPhase(sample);
  else { pendingBootPhases.push(sample); if (pendingBootPhases.length > 100) pendingBootPhases.shift(); }
}
const DEBUG = (() => { try { return new URLSearchParams(location.search).get('debug') === '1'; } catch { return false; } })();
// ?debug=1 lets a tester open every level in the grid for this page load only (the saved progress is never changed)
const openTo = () => (DEBUG ? LEVEL_COUNT : save.unlocked);
function maybeDiag() {
  try {
    if (new URLSearchParams(location.search).get('debug') !== '1') return;
    import('./diag.js').then((m) => { diag = m.createDiag({ gfx: () => gfx, game: () => game, safeTop: () => { const h = hudSafe(); return h ? h.top : 0; }, version: 'main' }); for (const sample of pendingGpuTiming) diag.gpuTiming(sample); pendingGpuTiming.length = 0; for (const sample of pendingBootPhases) diag.bootPhase(sample); pendingBootPhases.length = 0; })
      .catch((e) => console.warn('[zuma] diagnostics failed to load', e && e.message));
  } catch { /* ignore */ }
}
function hudSafe() { const t = document.getElementById('topbar'), b = document.getElementById('bottom'); if (!t || !b) return null; const tr = t.getBoundingClientRect(), br = b.getBoundingClientRect(); if (!tr.height || !br.height) return null; const bt = Math.min(...[...b.children].map(c => c.getBoundingClientRect().top)); return { top: tr.bottom, bottom: bt }; }
function later(fn, ms) {                       // UI-layer delay that is cancelled when the session changes (no stale callbacks)
  const tok = sessionId;
  const id = setTimeout(() => { laterTimers.delete(id); if (tok === sessionId) fn(); }, ms);
  laterTimers.add(id);
}
function clearLater() { for (const id of laterTimers) clearTimeout(id); laterTimers.clear(); }
function haptic(p) { if (save.haptics && navigator.vibrate) { try { navigator.vibrate(p); } catch { /* ignore */ } } }
function newSeed() { try { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0]; } catch { return (Date.now() >>> 0); } }
function persist() { saveSave(save); }
const SCREENS = ['loading', 'error', 'menu', 'levels', 'howto', 'settings', 'pause', 'complete', 'over'];
function showScreen(name) { for (const s of SCREENS) $('screen-' + s).classList.toggle('hidden', s !== name); }
function applySettings() {
  sound.set(save.volume, save.sfx);
  $('set-sfx').classList.toggle('on', save.sfx); $('set-haptics').classList.toggle('on', save.haptics); $('set-guide').classList.toggle('on', save.guide); $('set-marks').classList.toggle('on', save.marks);
  if (gfx) gfx.setMarks(marksEnabled());
  $('set-vol').value = Math.round(save.volume * 100);
}
function fmt(n) { return Math.round(n).toLocaleString('en-US'); }

// ------------------------------------------------------------------ three.js loading (local vendor copy first, CDN fallback)
async function loadThree() {
  const urls = ['./vendor/three.module.js', 'https://unpkg.com/three@0.160.0/build/three.module.js'];
  let err = null;
  for (const u of urls) { try { return await import(u); } catch (e) { err = e; } }
  throw err || new Error('three.js not found');
}

// ------------------------------------------------------------------ menus
function refreshMenu() {
  $('best-campaign').textContent = fmt(save.bestCampaign); $('best-endless').textContent = fmt(save.bestEndless);
  const done = Object.keys(save.stars).length; $('best-levels').textContent = done + '/' + LEVEL_COUNT;
}
function buildLevelGrid() {
  const g = $('level-grid'); g.textContent = '';
  const stages = ['Verdant Temple', 'Jade Passage', 'Ember Vault', 'Crystal Labyrinth', 'Eclipse Citadel', "Zuma's Heart"];
  for (let n = 1; n <= LEVEL_COUNT; n++) {
    if ((n - 1) % 5 === 0) {
      const label = document.createElement('div'); label.className = 'stage-label';
      label.textContent = 'STAGE ' + (Math.floor((n - 1) / 5) + 1) + ' · ' + stages[Math.floor((n - 1) / 5)];
      g.appendChild(label);
    }
    const b = document.createElement('button'); b.className = 'lv' + (n > openTo() ? ' locked' : '');
    const st = save.stars[n] || 0;
    b.innerHTML = n + '<small>' + '★'.repeat(st) + '☆'.repeat(st ? 3 - st : 0) + '</small>';
    b.setAttribute('aria-label', 'Level ' + n + (n > openTo() ? ' locked' : ''));
    b.onclick = () => { sound.unlock(); if (n > openTo()) { sound.click(); return; } sound.click(); startSession('campaign', n); };
    g.appendChild(b);
  }
}
function goMenu() {
  sessionId++; clearLater(); game = null; session = null;
  if (gfx) gfx.clearFx();
  $('hud').classList.add('hidden'); setDanger(false, 0);
  refreshMenu(); showScreen('menu');
}

// ------------------------------------------------------------------ session / game flow
function startSession(mode, level) {
  sessionId++; clearLater();
  game = new Game({ seed: newSeed(), mode, level, lives: 3 });
  session = { mode, startLevel: level, committed: false };
  gfx.clearFx();
  showScreen(null); $('hud').classList.remove('hidden');
  buildPowerButtons(); hintShown = 0; $('hint').style.opacity = 1;
  gfx.setLevel(game.path); gfx.resize(innerWidth, innerHeight, hudSafe());   // HUD is laid out now, so the camera can keep the track clear of it
  hudCache.score = -1; displayScore = 0;
  sound.unlock();
}
function updateBests() {
  if (!game || !session) return;
  if (session.mode === 'campaign') save.bestCampaign = Math.max(save.bestCampaign, game.score);
  else { save.bestEndless = Math.max(save.bestEndless, game.score); save.bestWave = Math.max(save.bestWave, game.level); }
  save.bestCombo = Math.max(save.bestCombo, game.stats.maxCombo);
  persist();
}
function commitScores() { if (session && !session.committed) { session.committed = true; updateBests(); } }
function showComplete(ev) {
  const camp = game.mode === 'campaign';
  if (camp) {
    save.stars[ev.level] = Math.max(save.stars[ev.level] || 0, ev.stars);
    save.unlocked = Math.max(save.unlocked, Math.min(LEVEL_COUNT, ev.level + 1));
    save.bestCampaign = Math.max(save.bestCampaign, game.score);
  }
  save.bestCombo = Math.max(save.bestCombo, game.stats.maxCombo); persist();
  const last = camp && ev.level >= LEVEL_COUNT;
  $('complete-title').textContent = last ? 'Campaign complete!' : 'Level ' + ev.level + ' clear!';
  $('complete-stars').innerHTML = [1, 2, 3].map(i => '<span class="' + (i <= ev.stars ? '' : 'off') + '">★</span>').join('');
  $('complete-stats').innerHTML =
    '<span>Play score</span><b>' + fmt(ev.playScore) + '</b>' +
    '<span>Clear bonus</span><b>+' + fmt(ev.bonus) + '</b>' +
    '<span>Accuracy</span><b>' + Math.round(ev.accuracy * 100) + '%</b>' +
    '<span>Best combo</span><b>x' + ev.maxCombo + '</b>' +
    '<span>Next star at</span><b>' + (ev.stars >= 3 ? 'max' : fmt(ev.target[ev.stars])) + '</b>' +
    '<span>Total score</span><b>' + fmt(ev.score) + '</b>';
  $('btn-next').textContent = last ? 'Endless mode' : 'Next level';
  showScreen('complete');
}
function showOver(ev) {
  const prev = session.mode === 'campaign' ? save.bestCampaign : save.bestEndless;
  commitScores();
  const best = session.mode === 'campaign' ? save.bestCampaign : save.bestEndless;
  $('over-new').classList.toggle('hidden', !(ev.score > 0 && ev.score > prev));
  $('over-stats').innerHTML =
    '<span>Final score</span><b>' + fmt(ev.score) + '</b>' +
    '<span>' + (session.mode === 'endless' ? 'Wave reached' : 'Level reached') + '</span><b>' + ev.level + '</b>' +
    '<span>Highest combo</span><b>x' + ev.maxCombo + '</b>' +
    '<span>Marbles cleared</span><b>' + ev.cleared + '</b>' +
    '<span>Best score</span><b>' + fmt(best) + '</b>';
  sound.gameOver(); showScreen('over');
}
function pauseGame() {
  if (!game || game.paused || !['playing', 'intro', 'respawn', 'devour'].includes(game.state)) return;
  game.setPaused(true); showScreen('pause'); sound.click();
}
function resumeGame() { if (!game || !game.paused) return; game.setPaused(false); showScreen(null); sound.click(); }

// ------------------------------------------------------------------ HUD
const hudCache = { score: -1, lives: -1, goal: '', fill: -1, slow: '', rev: false, surge: false, curKey: '', nxtKey: '', counts: '' };
let displayScore = 0;
function buildPowerButtons() {
  document.querySelectorAll('.power').forEach(b => { const k = b.dataset.power, im = b.querySelector('img'); if (!im.src || !im.src.startsWith('data:')) im.src = iconURL(k); });
}
const MARKS_URL_OFF = (() => { try { return new URLSearchParams(location.search).get('marks') === '0'; } catch { return false; } })();
const marksEnabled = () => !!save.marks && !MARKS_URL_OFF;
function marbleEl(el, color, armed) {
  const on = marksEnabled(), key = (armed || ('c' + color)) + (on ? 'm' : '');
  if (el._k === key) return; el._k = key;
  el.className = 'marble' + (armed ? ' ' + armed : '');
  el.style.setProperty('--c', armed ? '#fff' : (COLOR_CSS[color] || '#888'));
  el.style.setProperty('--g', on && !armed && color >= 0 ? 'url(' + markURL(color) + ')' : 'none');
}
function setDanger(on, level) {
  const v = $('vignette'); v.classList.toggle('on', on); v.classList.toggle('crit', on && level > 0.7); $('danger-label').classList.toggle('on', on);
}
function updateHud(dt) {
  const g = game;
  displayScore += (g.score - displayScore) * Math.min(1, dt * 9); if (Math.abs(g.score - displayScore) < 0.6) displayScore = g.score;
  const sc = Math.round(displayScore); if (sc !== hudCache.score) { hudCache.score = sc; $('score').textContent = fmt(sc); }
  if (g.lives !== hudCache.lives) { hudCache.lives = g.lives; $('lives').innerHTML = [0, 1, 2].map(i => '<i class="' + (i < g.lives ? '' : 'gone') + '">♥</i>').join(''); }
  const name = g.mode === 'endless' ? 'Wave <b>' + g.level + '</b>' : 'L<b>' + g.level + '</b> · ' + g.cfg.name;
  const left = g.marblesLeft(); const gk = name + left; if (gk !== hudCache.goal) { hudCache.goal = gk; $('goal-name').innerHTML = name; $('goal-text').textContent = left + ' marbles left'; }
  const fill = Math.round(100 * g.cleared / g.total); if (fill !== hudCache.fill) { hudCache.fill = fill; $('goal-fill').style.width = fill + '%'; }
  const slow = g.slowT > 0 ? g.slowT.toFixed(1) : ''; if (slow !== hudCache.slow) { hudCache.slow = slow; $('chip-slow').classList.toggle('hidden', !slow); $('chip-slow').querySelector('b').textContent = slow ? slow + 's' : ''; }
  const rev = g.reverseT > 0; if (rev !== hudCache.rev) { hudCache.rev = rev; $('chip-rev').classList.toggle('hidden', !rev); }
  if (g.surgeOn !== hudCache.surge) { hudCache.surge = g.surgeOn; $('chip-surge').classList.toggle('hidden', !g.surgeOn); }
  marbleEl($('cur'), g.cur.color, g.armed); marbleEl($('nxt'), g.next.color, null);
  const ck = JSON.stringify(g.charges) + g.armed;
  if (ck !== hudCache.counts) {
    hudCache.counts = ck;
    document.querySelectorAll('.power').forEach(b => { const k = b.dataset.power, c = g.charges[k]; b.querySelector('.count').textContent = c; b.classList.toggle('empty', c <= 0); b.classList.toggle('armed', g.armed === k); });
  }
  const dOn = g.dangerOn && g.state === 'playing'; setDanger(dOn, g.danger);
  if (dOn) sound.danger(g.danger);
  if (hintShown && performance.now() - hintShown > 5000) $('hint').style.opacity = 0;
}
function banner(text, subText) {
  const b = $('banner'); b.innerHTML = text + (subText ? '<small>' + subText + '</small>' : '');
  b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
}
function comboText(t) { const c = $('combo'); c.textContent = t; c.classList.remove('show'); void c.offsetWidth; c.classList.add('show'); }
function pop(text, x, z, color) {
  const p = gfx.screenOf(x, z); if (!p) return;
  const box = $('pops'); while (box.childElementCount > 9) box.removeChild(box.firstChild);
  const e = document.createElement('div'); e.className = 'pop'; e.textContent = text; e.style.left = p.x + 'px'; e.style.top = p.y + 'px'; if (color) e.style.setProperty('--c', color);
  box.appendChild(e); setTimeout(() => { if (e.parentNode) e.parentNode.removeChild(e); }, 1000);
}

// ------------------------------------------------------------------ game events -> sound / visuals / UI
function onEvent(ev) {
  gfx.event(ev, game);
  switch (ev.type) {
    case 'level_start': gfx.setLevel(game.path); banner(ev.mode === 'endless' ? 'WAVE ' + ev.level : 'LEVEL ' + ev.level, ev.name + ' · ' + ev.total + ' marbles'); break;
    case 'go': banner('GO!'); sound.go(); break;
    case 'shot': sound.shoot(); haptic(8); hintShown = hintShown || performance.now(); break;
    case 'insert': sound.insert(); break;
    case 'join': sound.join(); break;
    case 'swap': sound.swap(); break;
    case 'match': {
      sound.match(ev.n, ev.combo); haptic(ev.n >= 5 ? [20, 30, 30] : 14);
      let cx = 0, cz = 0; for (const b of ev.balls) { cx += b.x; cz += b.z; } cx /= ev.balls.length; cz /= ev.balls.length;
      pop('+' + fmt(ev.pts), cx, cz, COLOR_CSS[ev.color]);
      if (ev.n >= 5) comboText('5-MARBLE COMBO!' + (ev.combo >= 2 ? ' · x' + ev.combo : '') + (ev.cascade ? ' · CHAIN' : ''));
      else if (ev.n === 4) comboText('4-MARBLE COMBO' + (ev.combo >= 2 ? ' · x' + ev.combo : '') + (ev.cascade ? ' · CHAIN' : ''));
      else if (ev.n === 3) comboText('3-MARBLE COMBO' + (ev.combo >= 2 ? ' · x' + ev.combo : '') + (ev.cascade ? ' · CHAIN' : ''));
      else if (ev.combo >= 2) comboText('COMBO x' + ev.combo + (ev.cascade ? ' · CHAIN' : ''));
      else if (ev.streak >= 3) comboText('STREAK x' + ev.streak);
      break;
    }
    case 'bomb': sound.bomb(); haptic([30, 40, 30]); pop('+' + fmt(ev.pts), ev.x, ev.z, '#ff8a2a'); if (ev.combo >= 2) comboText('COMBO x' + ev.combo); break;
    case 'rainbow': sound.rainbow(); break;
    case 'slow_on': sound.slowOn(); banner(ev.refresh ? 'SLOW REFRESHED' : 'SLOW'); break;
    case 'slow_off': sound.slowOff(); break;
    case 'reverse_on': sound.reverseOn(); banner('REVERSE'); break;
    case 'power_gain': { sound.powerGain(); haptic(15); const b = document.querySelector('.power[data-power="' + ev.kind + '"]'); if (b) { b.classList.remove('gain'); void b.offsetWidth; b.classList.add('gain'); } pop('+' + ev.kind.toUpperCase(), ev.x, ev.z, '#ffd96a'); break; }
    case 'surge_on': sound.surge(); banner('SURGE!'); break;
    case 'life_lost': sound.lifeLost(); haptic(120); banner('LIFE LOST', ev.lives + (ev.lives === 1 ? ' life left' : ' lives left')); break;
    case 'respawn': break;
    case 'level_complete':
      banner(game.mode === 'endless' ? 'WAVE CLEARED' : 'CLEAR!', '+' + fmt(ev.bonus) + ' bonus'); haptic([30, 30, 30, 30]); sound.complete();
      if (game.mode === 'endless') {
        updateBests();
        later(() => { if (game && game.state === 'complete') { game.nextLevel(); gfx.clearFx(); hudCache.goal = ''; } }, 2600);
      } else later(() => showComplete(ev), 1100);
      break;
    case 'game_over': later(() => showOver(ev), 1200); break;
    default: break;
  }
}

// ------------------------------------------------------------------ input
function setAimFromPointer(e) {
  if (!gfx || !gfx.view) return;
  const r = gfx.canvas.getBoundingClientRect();
  const a = pointerToAim(gfx.view, e.clientX - r.left, e.clientY - r.top, r.width, r.height);
  if (a) { aim.dx = a.dx; aim.dz = a.dz; }
}
function playable() { return game && !game.paused && game.state === 'playing'; }
function fireNow() { return playable() && game.fire(aim.dx, aim.dz); }
function bindInput() {
  const c = gfx.canvas;
  c.addEventListener('pointerdown', (e) => {
    sound.unlock(); if (!e.isPrimary || aim.pointerId !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    aim.pointerId = e.pointerId; aim.active = true; setAimFromPointer(e);
    try { c.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    e.preventDefault();
  }, { passive: false });
  c.addEventListener('pointermove', (e) => {
    if (!e.isPrimary) return;
    if (e.pointerType === 'mouse' || aim.pointerId === e.pointerId) setAimFromPointer(e);
  }, { passive: true });
  const release = (e, fire) => {
    if (aim.pointerId !== e.pointerId) return;
    if (fire) { setAimFromPointer(e); if (fireNow() && diag) diag.input(e.timeStamp); }
    aim.pointerId = null; aim.active = false;
    try { c.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  c.addEventListener('pointerup', (e) => { release(e, true); e.preventDefault(); }, { passive: false });
  c.addEventListener('pointercancel', (e) => release(e, false));          // a cancelled gesture NEVER shoots
  c.addEventListener('lostpointercapture', (e) => { if (aim.pointerId === e.pointerId) { aim.pointerId = null; aim.active = false; } });
  c.addEventListener('contextmenu', (e) => e.preventDefault());

  $('tray').addEventListener('click', () => { sound.unlock(); if (game) game.swap(); });
  document.querySelectorAll('.power').forEach(b => b.addEventListener('click', () => { sound.unlock(); if (game && !game.usePower(b.dataset.power)) sound.click(); }));
  $('btn-pause').addEventListener('click', pauseGame);

  window.addEventListener('keydown', (e) => {
    sound.unlock();
    if (e.code === 'ArrowLeft') { aim.keyL = true; e.preventDefault(); } else if (e.code === 'ArrowRight') { aim.keyR = true; e.preventDefault(); }
    if (e.repeat) return;
    switch (e.code) {
      case 'Space': if (game) { game.swap(); e.preventDefault(); } break;
      case 'Enter': case 'ArrowUp': if (playable()) { fireNow(); e.preventDefault(); } break;
      case 'KeyP': case 'Escape': if (game && game.paused) resumeGame(); else pauseGame(); break;
      case 'Digit1': if (game) game.usePower('bomb'); break; case 'Digit2': if (game) game.usePower('rainbow'); break;
      case 'Digit3': if (game) game.usePower('slow'); break; case 'Digit4': if (game) game.usePower('reverse'); break;
      default: break;
    }
  });
  window.addEventListener('keyup', (e) => { if (e.code === 'ArrowLeft') aim.keyL = false; if (e.code === 'ArrowRight') aim.keyR = false; });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });
  window.addEventListener('blur', () => { aim.keyL = aim.keyR = false; });
}
function keyboardAim(dt) {
  const t = (aim.keyR ? 1 : 0) - (aim.keyL ? 1 : 0); if (!t) return;
  const a = t * 1.7 * dt, c = Math.cos(a), s = Math.sin(a), dx = aim.dx * c - aim.dz * s, dz = aim.dx * s + aim.dz * c;
  const l = Math.hypot(dx, dz) || 1; aim.dx = dx / l; aim.dz = dz / l;
}

function bindMenus() {
  const click = (id, fn) => $(id).addEventListener('click', () => { sound.unlock(); sound.click(); fn(); });
  click('btn-campaign', () => { buildLevelGrid(); showScreen('levels'); });
  click('btn-endless', () => startSession('endless', 1));
  click('btn-howto', () => showScreen('howto'));
  let settingsFrom = 'menu';
  click('btn-settings', () => { settingsFrom = 'menu'; showScreen('settings'); });
  click('btn-pause-settings', () => { settingsFrom = 'pause'; showScreen('settings'); });
  click('btn-settings-back', () => showScreen(settingsFrom));
  document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => { sound.click(); showScreen(b.dataset.back); }));
  click('btn-resume', resumeGame);
  click('btn-restart', () => { commitScores(); startSession(game.mode, game.mode === 'endless' ? 1 : game.level); });
  click('btn-quit', () => { commitScores(); goMenu(); });
  click('btn-next', () => {
    if (!game) return;
    if (game.mode === 'campaign' && game.level >= LEVEL_COUNT) { commitScores(); startSession('endless', 1); return; }
    if (game.nextLevel()) { gfx.clearFx(); hudCache.goal = ''; showScreen(null); }
  });
  click('btn-replay', () => { commitScores(); startSession(game.mode, game.level); });
  click('btn-complete-menu', () => { commitScores(); goMenu(); });
  click('btn-again', () => startSession(session.mode, session.mode === 'endless' ? 1 : game.level));
  click('btn-over-menu', goMenu);
  const sw = (id, key) => $(id).addEventListener('click', () => { save[key] = !save[key]; applySettings(); persist(); sound.unlock(); sound.click(); });
  sw('set-sfx', 'sfx'); sw('set-haptics', 'haptics'); sw('set-guide', 'guide'); sw('set-marks', 'marks');
  $('set-vol').addEventListener('input', (e) => { save.volume = +e.target.value / 100; applySettings(); });
  $('set-vol').addEventListener('change', () => { persist(); sound.unlock(); sound.click(); });
  click('set-reset', () => { if (confirm('Reset all progress and best scores?')) { save = resetSave(); applySettings(); refreshMenu(); buildLevelGrid(); } });
  $('btn-reload').addEventListener('click', () => location.reload());
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; $('btn-install').classList.remove('hidden'); });
  $('btn-install').addEventListener('click', async () => { if (!deferred) return; try { deferred.prompt(); await deferred.userChoice; } catch { /* ignore */ } deferred = null; $('btn-install').classList.add('hidden'); });
}

// ------------------------------------------------------------------ loop (exactly one)
function frame(now) {
  rafId = requestAnimationFrame(frame);
  if (!firstFrameTimingRecorded) { firstFrameTimingRecorded = true; recordBootPhase('firstAnimationFrameFromBoot', bootStartedAt, performance.now()); }
  if (diag) diag.frameStart();
  const rawMs = Math.max(0, now - lastT), dt = Math.min(0.1, rawMs / 1000); lastT = now;
  if (diag) diag.frame(now);
  if (innerWidth !== W || innerHeight !== H) {
    const resizeStart = diag ? performance.now() : 0;
    W = innerWidth; H = innerHeight; gfx.resize(W, H, hudSafe());
    if (diag) diag.section('resize', resizeStart, performance.now());
  }
  let pred = null;
  if (game) {
    let phaseStart = diag ? performance.now() : 0;
    if (!game.paused) { keyboardAim(dt); game.advance(dt); }
    for (const ev of game.drainEvents()) onEvent(ev);
    if (diag) diag.section('simulationEvents', phaseStart, performance.now());
    if (game) {
      phaseStart = diag ? performance.now() : 0;
      updateHud(dt);
      if (diag) diag.section('hud', phaseStart, performance.now());
      phaseStart = diag ? performance.now() : 0;
      if (save.guide && game.state === 'playing') pred = game.predict(aim.dx, aim.dz);
      if (diag) diag.section('prediction', phaseStart, performance.now());
    }
  }
  const renderStart = diag ? performance.now() : 0;
  gfx.frame(game, game && game.paused ? 0 : dt, { dx: aim.dx, dz: aim.dz, guide: save.guide && !!pred, pred }, rawMs);
  if (diag) { const renderEnd = performance.now(); diag.section('render', renderStart, renderEnd); diag.frameEnd(renderEnd); }
}
function startLoop() { if (rafId) return; lastT = performance.now(); rafId = requestAnimationFrame(frame); }

// ------------------------------------------------------------------ boot
async function boot() {
  let phaseStart = performance.now();
  maybeDiag();
  recordBootPhase('requestDiagnostics', phaseStart);
  phaseStart = performance.now();
  applySettings(); bindMenus();
  recordBootPhase('initialUiSetup', phaseStart);
  // register the service worker BEFORE loading the engine, so the shell is cached even if the engine fails to load this time
  phaseStart = performance.now();
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});
  recordBootPhase('serviceWorkerRegistrationRequest', phaseStart);
  let THREE;
  phaseStart = performance.now();
  try { THREE = await loadThree(); recordBootPhase('loadThreeResolve', phaseStart); }
  catch (e) {
    recordBootPhase('loadThreeFailed', phaseStart);
    $('error-msg').textContent = 'The 3D engine (Three.js) could not be loaded. Serve this folder over http(s) and either run ./fetch-three.sh (offline copy) or connect to the internet. (' + (e && e.message ? e.message : e) + ')';
    showScreen('error'); return;
  }
  phaseStart = performance.now();
  try {
    gfx = createGfx(THREE, $('stage'), { ...gfxFlags(), onQuality: (q) => console.info('[zuma] quality ' + q.action, q), onSectionTiming: DEBUG ? (name, start, end) => { if (diag) diag.section(name, start, end); } : null, onGpuTiming: DEBUG ? (sample) => { if (diag) diag.gpuTiming(sample); else { pendingGpuTiming.push(sample); if (pendingGpuTiming.length > 32) pendingGpuTiming.shift(); } } : null });
    recordBootPhase('createGfx', phaseStart);
  } catch (e) {
    recordBootPhase('createGfxFailed', phaseStart);
    $('error-msg').textContent = 'WebGL could not start on this device/browser. (' + (e && e.message ? e.message : e) + ')';
    showScreen('error'); return;
  }
  phaseStart = performance.now();
  gfx.setMarks(marksEnabled());
  // Android can reclaim GPU memory (e.g. while the app is in the background). Pause, say so, and recover when the browser restores the context.
  let lostFrom = null;
  const visibleScreen = () => SCREENS.find((n) => !$('screen-' + n).classList.contains('hidden')) || null;
  gfx.canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault(); if (lostFrom === null) lostFrom = visibleScreen() || 'game'; pauseGame();
    $('error-title').textContent = 'Graphics interrupted';
    $('error-msg').textContent = 'The system reclaimed graphics memory. Waiting for it to come back; if nothing happens in a few seconds, reload (your campaign progress is saved).'; showScreen('error');
  });
  gfx.canvas.addEventListener('webglcontextrestored', () => {
    try { gfx.restoreContext(); } catch (err) { console.warn('[zuma] restoreContext failed', err && err.message); }
    $('error-title').textContent = 'Could not start';
    const back = lostFrom; lostFrom = null;
    showScreen(game && game.paused ? 'pause' : (back && back !== 'error' && back !== 'game' ? back : (game ? null : 'menu')));
  });
  recordBootPhase('contextRecoveryHandlers', phaseStart);
  phaseStart = performance.now();
  W = innerWidth; H = innerHeight; gfx.resize(W, H, hudSafe());
  const demo = new Game({ seed: 1, level: 1 }); gfx.setLevel(demo.path);       // backdrop for the menu
  recordBootPhase('initialResizeAndMenuScene', phaseStart);
  phaseStart = performance.now();
  bindInput(); refreshMenu(); buildPowerButtons(); showScreen('menu');
  recordBootPhase('inputAndMenuReady', phaseStart);
  startLoop();
  recordBootPhase('bootToLoopStart', bootStartedAt);
}
// Small hook for automated tests / debugging. Read-mostly; does not bypass the rules in core.js.
window.__zuma = {
  get game() { return game; }, get gfx() { return gfx; }, get save() { return save; }, aim, sound,
  startCampaign: (n = 1) => startSession('campaign', n), startEndless: () => startSession('endless', 1), pause: pauseGame, resume: resumeGame, menu: goMenu,
  get loops() { return rafId ? 1 : 0; }, get diag() { return diag; },
};
boot();
