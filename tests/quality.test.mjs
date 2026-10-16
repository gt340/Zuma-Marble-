// Phase 4 / Gate 3: adaptive-quality policy under synthetic frame-time profiles (pure, deterministic; the controller has no clock of its own).
// These are MODEL profiles, not device measurements: they check the policy's logic (hysteresis, back-off, revert, recovery, ceilings).
import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveQuality, CFG, trimmedMean } from '../quality.js';

function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const VS = 1000 / 60;
/** Drive a controller for `seconds` of running time. `cost(level, tSec)` -> frame interval in ms (before jitter). Returns the log of decisions. */
function drive(aq, seconds, cost, { jitter = 0.5, seed = 1, hitch = null } = {}) {
  const rnd = mulberry32(seed), log = []; let t = 0;
  while (t < seconds * 1000) {
    let ms = Math.max(1, cost(aq.level, t / 1000) + (rnd() - 0.5) * 2 * jitter);
    if (hitch && rnd() < hitch.p) ms = hitch.ms;
    t += ms; const r = aq.sample(ms, true); if (r) log.push({ t: Math.round(t / 1000), ...r });
  }
  return log;
}
const ladder4 = () => new AdaptiveQuality(4);

test('trimmedMean ignores the slowest 10% (isolated hitches do not move it)', () => {
  const a = Array(90).fill(16.7).concat(Array(10).fill(120));
  assert.ok(Math.abs(trimmedMean(a) - 16.7) < 1e-9);
  assert.equal(trimmedMean([]), 0);
});

test('fast device (60 Hz and 120 Hz): never changes anything over 10 minutes', () => {
  for (const ms of [VS, 1000 / 120, 1000 / 90]) { const aq = ladder4(); const log = drive(aq, 600, () => ms); assert.equal(log.length, 0, 'ms ' + ms); assert.equal(aq.level, 0); }
});

test('slow device whose cost falls with quality: steps down until it is under the threshold, then stops (no revert, no oscillation)', () => {
  const aq = ladder4(); const log = drive(aq, 300, (lv) => 48 * Math.pow(0.8, lv));   // 48, 38.4, 30.7, 24.6
  assert.deepEqual(log.map(l => l.action), ['down', 'down', 'down']);
  assert.equal(aq.level, 3); assert.equal(aq.state.reverts, 0);
  assert.ok(log[0].t >= 4, 'first step needs two slow windows (>= 4 s), got t=' + log[0].t);
});

test('never walks past the bottom of the ladder', () => {
  const aq = ladder4(); drive(aq, 600, () => 80); assert.ok(aq.level <= 3);
});

test('STABLE 30 FPS CAP (cost does not depend on quality): downgrades are reverted, probing stops after 3 failures, quality stays at the top', () => {
  const aq = ladder4(); const log = drive(aq, 1200, () => 1000 / 30, { jitter: 0.6 });
  assert.equal(aq.level, 0, 'ends at full quality');
  const downs = log.filter(l => l.action === 'down').length, reverts = log.filter(l => l.action === 'revert').length;
  assert.equal(downs, reverts, 'every downgrade was undone'); assert.equal(downs, CFG.MAX_FAILED_PROBES);
  assert.ok(log.every(l => l.t <= 600), 'it stops probing; last change at t=' + log.at(-1).t + ' s');
  assert.equal(aq.state.capSuspected, true);
  // time spent below full quality is bounded: each failed probe costs ~ (settle + 1 window)
  let low = 0, lv = 0, lt = 0; for (const l of log) { if (lv > 0) low += l.t - lt; lv = l.level; lt = l.t; } assert.ok(low <= 3 * 8, 'seconds below top quality: ' + low);
});

test('vsync-quantised overload (cost 36 ms @60 Hz shows as 50/33/33 ms): keeps the one step that helped, reverts the one that did not, then settles', () => {
  const aq = ladder4(); const cost = (lv) => { const c = 36 * Math.pow(0.85, lv); return Math.ceil(c / VS - 1e-9) * VS; };
  const log = drive(aq, 400, cost, { jitter: 0.2 });
  assert.equal(aq.level, 1); assert.deepEqual(log.slice(0, 3).map(l => l.action), ['down', 'down', 'revert']);
});

test('unstable load (3 s smooth / 1 s heavy, repeating): bounded number of changes, no thrash', () => {
  const aq = ladder4(); const log = drive(aq, 600, (lv, t) => (t % 4 < 3 ? 16.7 : 45 * Math.pow(0.8, lv)), { jitter: 1 });
  assert.ok(log.length <= 6, 'changes ' + log.length + ' ' + JSON.stringify(log.map(l => l.action + l.t)));
});

test('isolated hitches (1 in 200 frames at 200 ms, below the stall limit) do not cause a downgrade', () => {
  const aq = ladder4(); const log = drive(aq, 600, () => VS, { hitch: { p: 0.005, ms: 200 } }); assert.equal(log.length, 0);
});

test('a device that persistently runs at < 4 fps is NOT mistaken for a run of stalls: it is measured and downgraded', () => {
  const aq = new AdaptiveQuality(4); const log = drive(aq, 400, (lv) => 420 * Math.pow(0.6, lv), { jitter: 10 });   // 420, 252, 151, 91 ms
  assert.ok(aq.level >= 2, 'level ' + aq.level + ' ' + JSON.stringify(log.map(l => l.action + l.level)));
  const bq = new AdaptiveQuality(4); for (let i = 0; i < 3; i++) bq.sample(900, true); for (let i = 0; i < 2000; i++) bq.sample(VS, true); assert.equal(bq.level, 0, 'three isolated-looking stalls then smooth play: no change');
});

test('stalls (> 250 ms: resume from background, GC) are ignored and restart the window', () => {
  const aq = ladder4(); let t = 0; const rnd = mulberry32(7);
  for (let i = 0; i < 20000; i++) { const ms = i % 90 === 0 ? 900 : VS + rnd(); aq.sample(ms, true); }
  assert.equal(aq.level, 0); assert.ok(aq.state.stalls > 100);
});

test('paused frames break the window; a long pause then a fast game triggers nothing', () => {
  const aq = ladder4(); const rnd = mulberry32(3);
  for (let r = 0; r < 200; r++) { for (let i = 0; i < 30; i++) aq.sample(VS + rnd(), true); for (let i = 0; i < 10; i++) aq.sample(0, false); }
  assert.equal(aq.level, 0); assert.equal(aq.state.changes, 0);
  // a pause that lands inside an otherwise slow stretch: windows never complete across the pause, so no downgrade from 29 ms frames chopped into 1 s pieces
  const bq = ladder4(); for (let r = 0; r < 100; r++) { for (let i = 0; i < 30; i++) bq.sample(29, true); bq.sample(0, false); } assert.equal(bq.level, 0);
});

test('RECOVERY: after an overload ends, quality comes back ONE step at a time, only after 10 s of headroom each, and stops at the ceiling', () => {
  const aq = ladder4(); const heavyUntil = 40;
  const log = drive(aq, 300, (lv, t) => t < heavyUntil ? 48 * Math.pow(0.8, lv) : 12);   // heavy for 40 s, then easy
  const ups = log.filter(l => l.action === 'up'); assert.equal(ups.length, 3); assert.equal(aq.level, 0);
  for (let i = 1; i < ups.length; i++) assert.ok(ups[i].t - ups[i - 1].t >= 10, 'gap ' + (ups[i].t - ups[i - 1].t));
  assert.ok(ups[0].t >= heavyUntil + 8, "first step up only after ~10 s of headroom (window alignment allows up to 2 s less): t=" + ups[0].t);
  assert.ok(ups.every((u, i) => u.level === 2 - i), 'strictly one level per step');
});

test('recovery that is not affordable is reverted at once and retried with exponential back-off (probation)', () => {
  const aq = ladder4();
  // level 0 would cost 40 ms, level 1+ is fine (25 ms; between FAST 20 and SLOW 28 => no upgrade) -> make level>=1 cheap enough to want an upgrade
  const cost = (lv) => lv === 0 ? 40 : 15;
  const log = drive(aq, 900, cost, { jitter: 0.3 });
  const ups = log.filter(l => l.action === 'up'), rev = log.filter(l => l.action === 'revert');
  assert.ok(ups.length >= 2 && rev.length >= 2); assert.equal(aq.level, 1);
  const gaps = ups.map(u => u.t); for (let i = 2; i < gaps.length; i++) assert.ok(gaps[i] - gaps[i - 1] >= gaps[i - 1] - gaps[i - 2], 'back-off does not shrink: ' + gaps.join(','));
  assert.ok(ups.length <= 7, 'bounded retries: ' + ups.length);
});

test('hysteresis dead band: a device sitting at 24 ms (between 20 and 28) never changes level in either direction', () => {
  const aq = ladder4(); assert.equal(drive(aq, 600, () => 24, { jitter: 1 }).length, 0);
  const bq = ladder4(); bq.level = 2; assert.equal(drive(bq, 600, () => 24, { jitter: 1 }).length, 0); assert.equal(bq.level, 2);
});

test('a one-step ladder (manual override already at the floor/ceiling) never changes', () => {
  const aq = new AdaptiveQuality(1); assert.equal(drive(aq, 300, () => 90).length, 0); assert.equal(aq.level, 0);
});

test('the controller needs no clock and is deterministic: same samples, same decisions', () => {
  const run = () => JSON.stringify(drive(ladder4(), 300, (lv, t) => t < 60 ? 45 * Math.pow(0.8, lv) : 14, { seed: 11 }));
  assert.equal(run(), run());
});
