import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Game, D, STEP, FEED_S, HOLE_MARGIN, SLOW_DUR, SLOW_MULT, REVERSE_DUR, REVERSE_SPEED, BOMB_REACH, SHOT_COOLDOWN, MAX_PROJECTILES,
  PATH_DEFS, Path, getPath, levelConfig, LEVEL_COUNT, matchPoints, comboMult, mulberry32,
} from '../core.js';

// ---------- helpers ----------
const R_ = 0, G_ = 1, B_ = 2, Y_ = 3, P_ = 4, O_ = 5;
/** A level-1 game in `playing` state with a hand-built chain of contiguous marbles starting at arc position s0. */
function scene(colors, { s0 = 18, queue = 0, seed = 7, level = 1, powers = false } = {}) {
  const g = new Game({ seed, level });
  g.state = 'playing'; g.queue = queue; g.total = Math.max(g.total, colors.length + queue);
  g.cfg.powers = powers ? g.cfg.powers : []; g.cfg.surge = null;
  g.chain = colors.map((c, i) => g._newBall(s0 + i * D, c, null));
  g.drainEvents();
  return g;
}
const evs = (g, type) => g.drainEvents().filter(e => e.type === type);
function run(g, seconds) { const n = Math.round(seconds / STEP); for (let i = 0; i < n; i++) { g.step(STEP); } }
function aimAt(g, idx) {
  const p = g.path.pos(g.chain[idx].s); const l = Math.hypot(p.x, p.z);
  return [p.x / l, p.z / l];
}
function shootAt(g, idx, color) {
  if (color !== undefined) g.cur.color = color;
  g.shotCd = 0;
  const [dx, dz] = aimAt(g, idx);
  assert.ok(g.fire(dx, dz), 'fire accepted');
}
function collectUntil(g, pred, maxSec = 8) {
  const all = [];
  for (let i = 0; i < maxSec / STEP; i++) { g.step(STEP); const e = g.drainEvents(); all.push(...e); if (e.some(pred)) break; }
  return all;
}

// ---------- paths ----------
test('paths: arc-length parameterisation is uniform', () => {
  for (const name of Object.keys(PATH_DEFS)) {
    const p = getPath(name); const a = {}, b = {};
    for (let s = 1; s < p.L - 1; s += 0.37) {
      p.pos(s, a); p.pos(s + 0.5, b);
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      assert.ok(Math.abs(d - 0.5) < 0.02, `${name} @${s.toFixed(2)} chord=${d}`);
    }
  }
});

test('paths: no self-crossing, clear of the frog, long enough for every level', () => {
  for (const name of Object.keys(PATH_DEFS)) {
    for (const shift of [0, 0.7, 1.4]) {
      const p = getPath(name, shift); const pts = [];
      for (let s = 0; s <= p.L; s += 0.1) pts.push(p.pos(s, {}));
      let minSep = Infinity, minR = Infinity;
      for (let i = 0; i < pts.length; i++) {
        minR = Math.min(minR, Math.hypot(pts[i].x, pts[i].z));
        for (let j = i + 1; j < pts.length; j++) {
          if ((j - i) * 0.1 < 6) continue;
          minSep = Math.min(minSep, Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z));
        }
      }
      assert.ok(minSep >= 2.3, `${name}+${shift}: coils only ${minSep.toFixed(2)} apart`);
      assert.ok(minR >= 3.4, `${name}+${shift}: path comes within ${minR.toFixed(2)} of the frog`);
      assert.ok(p.L > 50, `${name} too short: ${p.L}`);
    }
  }
});

// ---------- levels ----------
test('levels: 10 campaign levels, strictly escalating, valid', () => {
  assert.equal(LEVEL_COUNT, 10);
  let prev = null;
  for (let n = 1; n <= 10; n++) {
    const c = levelConfig(n);
    assert.ok(c.colors >= 3 && c.colors <= 6); assert.ok(PATH_DEFS[c.pathName]);
    assert.ok(c.stars[0] < c.stars[1] && c.stars[1] < c.stars[2]);
    if (prev) { assert.ok(c.speed > prev.speed && c.total >= prev.total && c.colors >= prev.colors && c.clump <= prev.clump); }
    prev = c;
  }
  const names = new Set(Array.from({ length: 10 }, (_, i) => levelConfig(i + 1).name));
  assert.equal(names.size, 10);
  const e1 = levelConfig(1, 'endless'), e30 = levelConfig(30, 'endless');
  assert.ok(e30.speed > e1.speed && e30.speed <= 2.7 && e30.colors === 6);
});

test('spawn generator never produces a run of three and respects the level colour count', () => {
  for (let lvl = 1; lvl <= 10; lvl++) {
    const g = new Game({ seed: lvl, level: lvl }); g.state = 'playing';
    const seq = []; let guard = 0;
    while ((g.queue > 0 || g.chain.length) && guard++ < 200000) { g.step(STEP); if (g.chain.length && g.chain[0].s < 0.3) { /* tail */ } if (g.chain.length && g.chain[g.chain.length - 1].s > g.path.L - 5) break; }
    const col = g.chain.map(b => b.color);
    for (const c of col) assert.ok(c >= 0 && c < g.cfg.colors);
    for (let i = 2; i < col.length; i++) assert.ok(!(col[i] === col[i - 1] && col[i] === col[i - 2]), `run of 3 at level ${lvl}`);
    assert.deepEqual(g.checkInvariants(), []);
  }
});

// ---------- 1 & 2: matching and scoring ----------
test('1. a group of three is removed', () => {
  const g = scene([R_, G_, B_, B_, Y_, R_]);
  shootAt(g, 2, B_);
  const e = collectUntil(g, x => x.type === 'match');
  const m = e.find(x => x.type === 'match');
  assert.ok(m, 'match event'); assert.equal(m.n, 3);
  assert.equal(g.chain.length, 4);
  assert.deepEqual(g.chain.map(b => b.color).sort(), [R_, G_, Y_, R_].sort());
});

test('2. groups of 4, 5 and larger score correctly (single match, combo 1, first shot)', () => {
  assert.deepEqual([3, 4, 5, 6, 7].map(matchPoints), [30, 70, 140, 240, 370]);
  for (const n of [3, 4, 5, 7]) {
    const cols = [R_, G_, ...Array(n - 1).fill(B_), Y_, R_];       // n-1 blues + 1 shot blue = n
    const g = scene(cols);
    shootAt(g, 2, B_);
    const e = collectUntil(g, x => x.type === 'match');
    const m = e.find(x => x.type === 'match');
    assert.equal(m.n, n); assert.equal(m.combo, 1);
    assert.equal(m.pts, matchPoints(n)); assert.equal(g.score, matchPoints(n));
  }
});

test('2b. streak and combo bonuses are applied exactly once', () => {
  assert.equal(comboMult(1), 1); assert.equal(comboMult(3), 2);
  const g = scene([R_, G_, B_, B_, Y_, P_, P_, O_, R_, G_, G_, Y_]);
  shootAt(g, 2, B_); collectUntil(g, x => x.type === 'match');
  assert.equal(g.streak, 1);
  run(g, 1.0); assert.equal(g.combo, 0, 'combo window lapsed');
  const before = g.score;
  const idx = g.chain.findIndex(b => b.color === P_);
  shootAt(g, idx, P_);
  const m = collectUntil(g, x => x.type === 'match').find(x => x.type === 'match');
  assert.equal(m.pts, matchPoints(3) + 10);                       // streak bonus = 10 * previous streak (1)
  assert.equal(g.score, before + m.pts);
});

// ---------- 3: cascade ----------
test('3. insertion between two matching groups produces a physical cascade', () => {
  const g = scene([R_, R_, B_, B_, R_, R_]);
  shootAt(g, 3, B_);
  const all = collectUntil(g, x => x.type === 'match' && x.cascade, 10);
  const matches = all.filter(x => x.type === 'match');
  assert.equal(matches.length, 2, 'blue match, then red cascade');
  assert.equal(matches[0].n, 3); assert.equal(matches[0].color, B_);
  assert.equal(matches[1].n, 4); assert.equal(matches[1].color, R_); assert.equal(matches[1].combo, 2); assert.equal(matches[1].cascade, true);
  assert.ok(all.some(x => x.type === 'join'));
  assert.equal(g.chain.length, 0);
  assert.deepEqual(g.checkInvariants(), []);
});

test('3b. non-matching ends: front segment stops, rear closes the gap, no secondary match', () => {
  const g = scene([G_, G_, R_, B_, B_, Y_, Y_]);
  shootAt(g, 4, B_);
  collectUntil(g, x => x.type === 'match');                      // removes B B B -> gap between R and Y
  const head0 = g.chain[g.chain.length - 1].s;
  run(g, 0.3);
  assert.ok(Math.abs(g.chain[g.chain.length - 1].s - head0) < 1e-9, 'front segment is stationary while a gap exists');
  assert.ok(g.chain[3].s - g.chain[2].s > D + 1e-3, 'gap still open');
  run(g, 4);
  assert.deepEqual(g.checkInvariants(), []);
  assert.ok(g.chain[3].s - g.chain[2].s <= D + 1e-4, 'gap closed');
  assert.equal(g.chain.length, 5); assert.ok(g.chain[g.chain.length - 1].s > head0, 'whole chain moves again afterwards');
});

test('3c. matching ends roll the front segment BACK (towards the entrance)', () => {
  const g = scene([R_, R_, G_, G_, G_, R_, R_], { s0: 22 });
  g.chain.splice(2, 3);                                          // simulate removal: R R | R R
  g.chain[2].s += 3 * D; g.chain[3].s += 3 * D;
  const s0 = g.chain[2].s;
  run(g, 0.05);
  assert.ok(g.chain[2].s < s0 - 0.2, 'front rolls back');
});

// ---------- 4 & 5: order and spacing ----------
test('4. ordering and spacing hold after insertion from either side', () => {
  for (const side of [1, -1]) {
    const g = scene([R_, G_, B_, Y_, P_, O_, R_, G_]);
    const idx = 4; const p = g.path.pos(g.chain[idx].s), t = g.path.tan(g.chain[idx].s);
    // approach from a point offset along the tangent so contact lands on the requested side
    g.cur.color = Y_; g.shotCd = 0;
    const tx = p.x + t.x * 0.5 * side, tz = p.z + t.z * 0.5 * side; const l = Math.hypot(tx, tz);
    assert.ok(g.fire(tx / l, tz / l));
    for (let i = 0; i < 400; i++) { g.step(STEP); assert.deepEqual(g.checkInvariants(), []); }
    assert.equal(g.projectiles.length, 0);
  }
});

test('4b. predicted impact equals the real insertion (same collision code)', () => {
  const g = scene([R_, G_, B_, Y_, P_, O_, R_, G_, B_, Y_]); g.cfg.speed = 0;
  for (const idx of [2, 5, 8]) {
    const [dx, dz] = aimAt(g, idx);
    const pr = g.predict(dx, dz); assert.ok(pr.hit);
    g.cur.color = P_; g.next.color = P_; g.shotCd = 0; const n0 = g.chain.length;
    const ids = g.chain.map(b => b.id);
    g.fire(dx, dz);
    collectUntil(g, x => x.type === 'insert', 2);
    const ins = g.chain.find(b => !ids.includes(b.id));
    assert.ok(ins, 'inserted'); assert.equal(g.chain.length, n0 + 1 - (g.chain.length < n0 + 1 ? 0 : 0));
    const at = g.chain.indexOf(ins);
    const neighbour = pr.side === 'ahead' ? g.chain[at - 1] : g.chain[at + 1];
    assert.equal(neighbour.id, pr.ballId, 'inserted next to predicted ball, on predicted side');
    g.chain.splice(at, 1);                                       // restore for next iteration
    for (let j = at; j < g.chain.length; j++) { /* contiguous spacing may differ, fine for the next prediction */ }
  }
});

test('5. ordering and spacing hold after removals (fuzz: bot plays 20 minutes of game time)', () => {
  let steps = 0;
  for (const seed of [1, 2, 3]) {
    const g = new Game({ seed, level: 3 }); const rng = mulberry32(seed * 99);
    for (let i = 0; i < 120 * 400; i++) {
      if (i % 40 === 0 && g.state === 'playing') {
        const n = g.chain.length;
        if (n) { const k = Math.floor(rng() * n); const [dx, dz] = aimAt(g, k); if (rng() < 0.2) g.swap(); g.fire(dx, dz); }
      }
      g.step(STEP); steps++;
      if (i % 7 === 0) assert.deepEqual(g.checkInvariants(), [], `seed ${seed} step ${i}`);
      if (g.state === 'complete') g.nextLevel();
      if (g.state === 'over') g.reset();
    }
  }
  assert.ok(steps > 100000);
});

// ---------- 6: bomb ----------
test('6. bomb removes exactly the marbles within its reach and leaves a valid chain', () => {
  const cols = [R_, G_, B_, Y_, P_, O_, R_, G_, B_, Y_, P_, O_];
  const g = scene(cols); g.charges.bomb = 1;
  assert.ok(g.usePower('bomb')); assert.equal(g.armed, 'bomb');
  const target = 6;
  shootAt(g, target);
  const e = collectUntil(g, x => x.type === 'bomb', 2);
  const b = e.find(x => x.type === 'bomb'); assert.ok(b);
  assert.equal(b.n, 5); assert.ok(b.radius >= 2 * D && b.radius < 3 * D);
  assert.equal(g.chain.length, cols.length - 4);              // bomb marble was inserted then removed with 4 neighbours
  assert.equal(g.charges.bomb, 0); assert.equal(g.armed, null);
  const left = g.chain.map(x => x.color);
  assert.equal(left.length, 8);
  assert.deepEqual(g.checkInvariants(), []);
  assert.ok(g.score >= 20 * 5 + 50);
  run(g, 3); assert.deepEqual(g.checkInvariants(), []);
});

test('6b. bomb at the tail / head ends does not corrupt the chain', () => {
  for (const idx of [0, 11]) {
    const g = scene([R_, G_, B_, Y_, P_, O_, R_, G_, B_, Y_, P_, O_]); g.charges.bomb = 1; g.usePower('bomb');
    shootAt(g, idx); collectUntil(g, x => x.type === 'bomb', 2);
    assert.deepEqual(g.checkInvariants(), []); assert.ok(g.chain.length >= 6 && g.chain.length <= 11);
  }
});

// ---------- 7: rainbow ----------
test('7. rainbow becomes the real best colour and triggers the normal cascade', () => {
  const g = scene([R_, R_, G_, G_, R_, R_]); g.charges.rainbow = 1; g.usePower('rainbow');
  shootAt(g, 2);                                                // contact lands next to the green pair
  const all = collectUntil(g, x => x.type === 'match' && x.cascade, 10);
  const rb = all.find(x => x.type === 'rainbow'); assert.ok(rb);
  const matches = all.filter(x => x.type === 'match');
  assert.ok(matches.length >= 1);
  assert.equal(matches[0].color, rb.color, 'removed group has the rainbow\'s actual gameplay colour');
  for (const m of matches) for (const b of m.balls) assert.ok(b.color >= 0);
  assert.equal(g.charges.rainbow, 0);
});

test('7b. rainbow with no useful neighbour becomes a plain marble of a real colour', () => {
  const g = scene([R_, G_, B_, Y_, P_]); g.charges.rainbow = 1; g.usePower('rainbow');
  shootAt(g, 2); collectUntil(g, x => x.type === 'insert', 2);
  for (const b of g.chain) assert.ok(b.color >= 0, 'no wild/-1 colours stay in the chain');
  assert.equal(g.chain.length, 6);
});

// ---------- 8: slow ----------
test('8. slow expires and restores the original speed; re-activation refreshes (never stacks)', () => {
  const g = scene(Array.from({ length: 20 }, (_, i) => i % 5), { queue: 0, s0: 2 });
  g.charges.slow = 2;
  const speed = () => { const a = g.chain[g.chain.length - 1].s; run(g, 0.5); return (g.chain[g.chain.length - 1].s - a) / 0.5; };
  const v0 = speed();
  assert.ok(g.usePower('slow')); assert.equal(g.slowT, SLOW_DUR);
  const vs = speed();
  assert.ok(Math.abs(vs / v0 - SLOW_MULT) < 0.02, `slow ratio ${vs / v0}`);
  run(g, 2.5);
  assert.ok(g.usePower('slow'));
  assert.equal(g.slowT, SLOW_DUR, 'refreshed to full, not 6+remaining');
  const e = g.drainEvents(); assert.ok(e.some(x => x.type === 'slow_on' && x.refresh));
  run(g, SLOW_DUR + 0.1);
  assert.equal(g.slowT, 0); assert.ok(g.drainEvents().some(x => x.type === 'slow_off'));
  const v1 = speed();
  assert.ok(Math.abs(v1 / v0 - 1) < 0.02, `restored ratio ${v1 / v0}`);
});

test('8b. reverse moves the whole chain backwards at a fixed rate, spacing preserved, then ends', () => {
  const g = scene(Array.from({ length: 10 }, (_, i) => i % 5), { s0: 20 });
  g.charges.reverse = 1; const s0 = g.chain.map(b => b.s);
  assert.ok(g.usePower('reverse'));
  let n = 0; while (g.reverseT > 0 && n++ < 1000) g.step(STEP);
  assert.equal(g.reverseT, 0);
  const d = g.chain.map((b, i) => b.s - s0[i]);
  for (const x of d) assert.ok(Math.abs(x + REVERSE_SPEED * REVERSE_DUR) < 0.03, `moved ${x}`);
  assert.deepEqual(g.checkInvariants(), []);
});

// ---------- 9 & 10: life ----------
test('9. a life is lost exactly once per endpoint crossing', () => {
  const g = scene([R_, G_, B_, Y_, P_], { s0: 5 });
  g.chain[g.chain.length - 1].s = g.path.L - HOLE_MARGIN + 0.01;
  let i = 0; while (g.state !== 'respawn' && i++ < 2000) g.step(STEP);
  assert.equal(g.state, 'respawn');
  assert.equal(g.lives, 2); assert.equal(g.queue, 5, 'devoured marbles return to the level queue'); assert.equal(g.chain.length, 0);
  for (let k = 0; k < 1200; k++) g.step(STEP);                    // keeps running: no second loss
  const lost = g.drainEvents().filter(e => e.type === 'life_lost');
  assert.equal(lost.length, 1); assert.equal(g.lives, 2); assert.equal(g.state, 'playing');
});

test('10. game over occurs when lives reach zero, once', () => {
  const g = scene([R_, G_, B_], { s0: 5 }); g.lives = 1;
  g.chain[2].s = g.path.L;
  for (let i = 0; i < 600; i++) g.step(STEP);
  const e = g.drainEvents();
  assert.equal(e.filter(x => x.type === 'game_over').length, 1);
  assert.equal(g.state, 'over'); assert.equal(g.lives, 0); assert.equal(g.result.won, false);
  const d = g.digest(); for (let i = 0; i < 100; i++) g.step(STEP); assert.equal(g.digest(), d);
  assert.equal(g.fire(0, -1), false);
});

// ---------- 11: restart ----------
test('11. reset() restores a clean initial state identical to a fresh game', () => {
  const fresh = new Game({ seed: 5, level: 2 });
  const g = new Game({ seed: 5, level: 2 });
  g.state = 'playing';
  for (let i = 0; i < 120 * 30; i++) { if (i % 30 === 0 && g.chain.length) { const [dx, dz] = aimAt(g, g.chain.length - 1); g.fire(dx, dz); } g.step(STEP); }
  g.charges.bomb = 2; g.usePower('slow');
  assert.notEqual(g.digest(), fresh.digest());
  g.reset();
  assert.equal(g.digest(), fresh.digest());
  assert.deepEqual(g.drainEvents().map(e => e.type), ['level_start']);
  assert.equal(g.projectiles.length, 0);
});

test('11b. restartLevel keeps score/lives but clears the board', () => {
  const g = scene([R_, G_, B_]); g.score = 777; g.lives = 2;
  g.restartLevel();
  assert.equal(g.score, 777); assert.equal(g.lives, 2); assert.equal(g.chain.length, 0); assert.equal(g.queue, g.cfg.total); assert.equal(g.state, 'intro');
});

// ---------- 12: pause ----------
test('12. pause freezes chain, projectiles and timers; resume continues', () => {
  const g = scene(Array.from({ length: 12 }, (_, i) => i % 5), { s0: 4 });
  g.charges.slow = 1; g.usePower('slow'); g.fire(0.3, -1);
  run(g, 0.1);
  g.setPaused(true);
  const d = g.digest(), t = g.t;
  for (let i = 0; i < 1200; i++) g.step(STEP); g.advance(5);
  assert.equal(g.digest(), d); assert.equal(g.t, t);
  assert.equal(g.fire(0, -1), false); assert.equal(g.swap(), false); assert.equal(g.usePower('bomb'), false);
  g.setPaused(false); run(g, 0.2);
  assert.notEqual(g.digest(), d);
});

// ---------- 13 & 15: completion and empty chain ----------
test('13. level completion triggers exactly once', () => {
  const g = scene([], { queue: 0 }); g.stats.shots = 0;
  for (let i = 0; i < 1000; i++) g.step(STEP);
  const e = g.drainEvents().filter(x => x.type === 'level_complete');
  assert.equal(e.length, 1); assert.equal(g.state, 'complete');
  const sc = g.score; for (let i = 0; i < 1000; i++) g.step(STEP);
  assert.equal(g.score, sc); assert.equal(g.drainEvents().filter(x => x.type === 'level_complete').length, 0);
  assert.equal(g.nextLevel(), true); assert.equal(g.level, 2); assert.equal(g.state, 'intro'); assert.equal(g.nextLevel(), false);
});

test('15. empty chain mid-level refills quickly and awards nothing', () => {
  const g = scene([], { queue: 20 });
  const sc = g.score;
  run(g, 6);
  assert.equal(g.score, sc);
  assert.equal(g.drainEvents().filter(x => x.type === 'level_complete').length, 0);
  assert.ok(g.chain.length >= 14, 'fast refill roll-in');
  assert.equal(g.state, 'playing');
  assert.deepEqual(g.checkInvariants(), []);
});

// ---------- 14 & 16: projectiles and rapid input ----------
test('14. projectiles are removed after collision or expiry', () => {
  const g = scene([R_, G_, B_, Y_, P_, O_, R_, G_], { s0: 14 });
  shootAt(g, 3, Y_ === 3 ? P_ : Y_);
  assert.equal(g.projectiles.length, 1);
  run(g, 1); assert.equal(g.projectiles.length, 0);
  const g2 = scene([R_, G_, B_], { s0: 14 });
  g2.shotCd = 0; g2.fire(0, 1);                                   // straight away from the chain
  run(g2, 3); assert.equal(g2.projectiles.length, 0);
  assert.ok(g2.drainEvents().some(x => x.type === 'miss'));
});

test('16. rapid repeated input cannot corrupt state', () => {
  const g = scene(Array.from({ length: 16 }, (_, i) => i % 5), { s0: 6, queue: 10 });
  let fired = 0;
  for (let i = 0; i < 1000; i++) { if (g.fire(0.2, -1)) fired++; }
  assert.equal(fired, 1, 'cooldown stops same-instant rapid fire');
  assert.equal(g.projectiles.length, 1);
  for (let i = 0; i < 1000; i++) g.swap();                        // even number of swaps -> unchanged parity, no throw
  for (let i = 0; i < 1000; i++) { g.usePower('bomb'); g.usePower('slow'); g.usePower('reverse'); }
  for (let i = 0; i < 3000; i++) { if (i % 3 === 0) g.fire(Math.sin(i), -Math.cos(i)); g.step(STEP); assert.ok(g.projectiles.length <= MAX_PROJECTILES); }
  assert.deepEqual(g.checkInvariants(), []);
  assert.ok(g.cur.color >= 0 && g.next.color >= 0);
});

// ---------- determinism ----------
test('determinism: same seed + same inputs => identical state', () => {
  const play = () => {
    const g = new Game({ seed: 42, level: 4 }); g.state = 'playing';
    for (let i = 0; i < 120 * 40; i++) {
      if (i % 50 === 0 && g.chain.length) { const [dx, dz] = aimAt(g, (i / 50 * 7) % g.chain.length | 0); g.fire(dx, dz); }
      g.step(STEP);
    }
    return g.digest();
  };
  assert.equal(play(), play());
});

test('insertion side: a shot hitting the head side of a marble goes AFTER it', () => {
  const g = scene([R_, G_, B_, Y_, P_, O_], { s0: 20 });
  const idx = 3, p = g.path.pos(g.chain[idx].s), t = g.path.tan(g.chain[idx].s);
  const hx = p.x + t.x * 0.6, hz = p.z + t.z * 0.6;                // contact on the head side
  const slot = g._slot(idx, hx, hz); assert.equal(slot.side, 'ahead'); assert.equal(slot.idx, idx + 1);
  const slot2 = g._slot(idx, p.x - t.x * 0.6, p.z - t.z * 0.6); assert.equal(slot2.side, 'behind'); assert.equal(slot2.idx, idx);
});

test('projectile cannot tunnel through a marble at any step size', () => {
  for (const frames of [1 / 240, 1 / 120, 1 / 60, 1 / 30, 1 / 10]) {
    for (let off = -0.8; off <= 0.8; off += 0.2) {
      const g = scene([R_, G_, B_], { s0: 20 }); g.shotCd = 0; g.cfg.speed = 0;
      const p = g.path.pos(g.chain[1].s); const l = Math.hypot(p.x, p.z);
      const nx = -p.z / l, nz = p.x / l;                           // lateral offset of the aim line at the marble
      const ax = p.x + nx * off, az = p.z + nz * off;
      g.fire(ax, az);
      let hit = false; for (let i = 0; i < 4 / frames; i++) { g.step(frames); if (g.drainEvents().some(e => e.type === 'insert')) { hit = true; break; } }
      assert.equal(hit, true, `frame=${frames} offset=${off.toFixed(1)}`);
    }
  }
});

// ---------- bot playthrough (acts as the core-level "complete playthrough" check) ----------
import { Bot } from './bot.mjs';
test('18a. a skilled bot completes campaign level 1 and 2 with no invariant breach', () => {
  for (const lvl of [1, 2]) {
    const g = new Game({ seed: 11 + lvl, level: lvl, lives: 3 });
    const bot = new Bot(g, { skill: 1, reaction: 0.35 });
    let t = 0;
    while (g.state !== 'complete' && g.state !== 'over' && t < 600) { bot.tick(STEP); g.step(STEP); t += STEP; if ((t * 120 | 0) % 11 === 0) assert.deepEqual(g.checkInvariants(), []); }
    assert.equal(g.state, 'complete', `level ${lvl} state=${g.state} left=${g.marblesLeft()}`);
    assert.ok(g.result.stars >= 1);
  }
});

// ---- regression: aim guide must account for the chain moving during projectile flight (audit gate, defect "guide ignores chain motion")
import { measure as measureAim } from './aimguide.mjs';
test('aim guide with lead predicts the real insertion slot >= 95% of the time (levels 1, 4, 10)', () => {
  for (const lvl of [1, 4, 10]) {
    const r = measureAim(lvl, 60, 7, { lead: true });
    assert.ok(r.total >= 12, `L${lvl}: enough clean samples (${r.total})`);
    assert.ok(r.exactPct >= 95, `L${lvl}: exact ${r.exactPct.toFixed(0)}%`);
  }
});
test('aim guide lead is a real correction: the static-chain guess is wrong in a large share of refill-phase shots', () => {
  const st = measureAim(1, 40, 7, { lead: false });
  assert.ok(st.exactPct < 60, `static guess exact ${st.exactPct.toFixed(0)}% (if this rises the lead logic may be redundant)`);
});
test('predict(lead) equals static prediction when the chain is stationary', () => {
  const g = new Game({ seed: 3, level: 1 }); run(g, 6);
  g.cfg.speed = 0; g.queue = 0; g.slowT = 0; run(g, 1);
  const p = g.path.pos(g.chain[Math.floor(g.chain.length / 2)].s, {});
  const a = g.predict(p.x, p.z, true), b = g.predict(p.x, p.z, false);
  assert.equal(a.index, b.index); assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 1e-6);
});

// ---- regression: DOM colour table must match the 3D colour table (tray/HUD vs marbles)
import { COLOR_HEX, COLOR_CSS } from '../render.js';
test('COLOR_CSS and COLOR_HEX describe the same six colours', () => {
  assert.equal(COLOR_HEX.length, 6); assert.equal(COLOR_CSS.length, 6);
  COLOR_HEX.forEach((h, i) => assert.equal(COLOR_CSS[i], '#' + h.toString(16).padStart(6, '0'), 'colour ' + i));
});

// ---- regression: late-level tuning keeps meaningful challenge (speed band, growth in size/colours, surge present) while staying tunable
test('campaign tuning guard: level 10 stays much harder than level 1; levels 8-10 speed stays in the tuned band', () => {
  const L = Array.from({ length: LEVEL_COUNT }, (_, i) => levelConfig(i + 1, 'campaign'));
  assert.ok(L[9].speed >= L[0].speed * 1.5, 'L10 speed >= 1.5x L1');
  for (const l of [8, 9, 10]) assert.ok(L[l - 1].speed >= 1.35 && L[l - 1].speed <= 1.5, `L${l} speed ${L[l - 1].speed}`);
  for (let i = 1; i < L.length; i++) { assert.ok(L[i].total >= L[i - 1].total, 'marble totals never shrink'); assert.ok(L[i].colors >= L[i - 1].colors, 'colour count never shrinks'); }
  for (const l of [7, 8, 9, 10]) assert.ok(L[l - 1].surge && L[l - 1].surge.mult >= 1.8, `L${l} keeps its surge`);
});
