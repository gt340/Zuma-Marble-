// core.js — pure gameplay logic for 3D Zuma. No DOM, no Three.js, no timers, no Math.random.
// Everything is driven by Game.step(dt) with a seeded RNG, so runs are reproducible and testable in Node.
//
// Coordinates: world X/Z plane (frog at 0,0). Chain positions are arc-length `s` (world units) along a Path.
// chain[0] is the TAIL (entrance side, smallest s); chain[n-1] is the HEAD (closest to the skull hole).

export const R = 0.48;                 // marble radius
export const D = 2 * R;                // marble diameter == spacing of touching marbles along the path
export const STEP = 1 / 120;           // fixed simulation step (s)
export const MUZZLE = 1.55;            // projectile spawn distance from frog centre
export const SHOT_SPEED = 30;          // projectile speed (units/s)
export const HIT = D * 0.95;           // centre distance at which a projectile touches a marble
export const FEED_S = -D;              // arc position where new marbles appear (inside the entrance gate)
export const HOLE_MARGIN = 0.25;       // head crossing (L - margin) loses a life
export const DANGER_DIST = 11;         // head closer than this to the hole => danger meter
export const SLOW_DUR = 6, SLOW_MULT = 0.35;
export const REVERSE_DUR = 2.0, REVERSE_SPEED = 3.2;
export const BACKROLL = 11;            // roll-back speed of a segment whose join would match
export const ROLL_SPEED = 8;           // opening / refill speed while few marbles are on the path
export const MIN_ON_PATH = 14;
export const BOMB_REACH = 2.2 * D;     // arc distance each side of the bomb that is destroyed
export const MAX_CHARGE = 2;
export const SHOT_COOLDOWN = 0.2;
export const MAX_PROJECTILES = 3;
export const SPEED_RAMP = 0.3;         // chain speed grows by up to +30% as the level's marbles are released
const EPS = 1e-5;

export const POWERS = ['bomb', 'rainbow', 'slow', 'reverse'];

// ---------------------------------------------------------------- RNG
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- Paths (arc-length parameterised)
const TAU = Math.PI * 2;
export const PATH_DEFS = {
  spiral:   { kind: 'spiral', rOut: 9.2, rIn: 3.8, turns: 1.65, a0: Math.PI * 0.92, dir: 1,  squash: 0.95 },
  spiralCW: { kind: 'spiral', rOut: 9.2, rIn: 3.8, turns: 1.7,  a0: Math.PI * 0.08, dir: -1, squash: 0.95 },
  square:   { kind: 'square', rOut: 9.0, rIn: 4.0, turns: 1.6,  a0: Math.PI * 1.0,  dir: 1,  squash: 1, e: 0.5 },
  wobble:   { kind: 'wobble', rOut: 9.0, rIn: 4.0, turns: 1.75, a0: Math.PI * 0.6,  dir: -1, squash: 0.95, wobble: 0.4, k: 5 },
  fuse:     { kind: 'fuse',   rOut: 9.3, rIn: 3.7, turns: 1.75, a0: Math.PI * 1.15, dir: 1,  squash: 0.95, ease: 0.8 },
};

function rawPoint(def, t) {
  const a = def.a0 + def.dir * def.turns * TAU * t;
  let r;
  if (def.kind === 'fuse') {
    r = def.rOut + (def.rIn - def.rOut) * Math.pow(t, def.ease);   // dives in fast, then winds slowly
  } else {
    r = def.rOut + (def.rIn - def.rOut) * t;
  }
  if (def.kind === 'wobble') r += def.wobble * Math.sin(t * TAU * def.k);
  let c = Math.cos(a), s = Math.sin(a);
  if (def.kind === 'square') {
    c = Math.sign(c) * Math.pow(Math.abs(c), def.e);
    s = Math.sign(s) * Math.pow(Math.abs(s), def.e);
  }
  return [r * c, r * s * (def.squash ?? 1)];
}

export class Path {
  constructor(def) {
    this.def = def;
    const M = 6000, px = new Float64Array(M + 1), pz = new Float64Array(M + 1), cum = new Float64Array(M + 1);
    for (let i = 0; i <= M; i++) { const p = rawPoint(def, i / M); px[i] = p[0]; pz[i] = p[1]; }
    for (let i = 1; i <= M; i++) cum[i] = cum[i - 1] + Math.hypot(px[i] - px[i - 1], pz[i] - pz[i - 1]);
    const L = cum[M], K = Math.ceil(L / 0.05), ds = L / K;
    const xs = new Float64Array(K + 1), zs = new Float64Array(K + 1);
    let j = 0;
    for (let k = 0; k <= K; k++) {
      const target = k * ds;
      while (j < M - 1 && cum[j + 1] < target) j++;
      const f = (target - cum[j]) / ((cum[j + 1] - cum[j]) || 1);
      xs[k] = px[j] + (px[j + 1] - px[j]) * f;
      zs[k] = pz[j] + (pz[j + 1] - pz[j]) * f;
    }
    const tx = new Float64Array(K + 1), tz = new Float64Array(K + 1);
    for (let k = 0; k <= K; k++) {
      const a = Math.max(0, k - 2), b = Math.min(K, k + 2);
      const dx = xs[b] - xs[a], dz = zs[b] - zs[a], l = Math.hypot(dx, dz) || 1;
      tx[k] = dx / l; tz[k] = dz / l;
    }
    Object.assign(this, { L, K, ds, xs, zs, tx, tz });
  }
  pos(s, out) {
    out = out || { x: 0, z: 0 };
    if (s <= 0) { out.x = this.xs[0] + this.tx[0] * s; out.z = this.zs[0] + this.tz[0] * s; return out; }
    if (s >= this.L) { const e = this.K; out.x = this.xs[e] + this.tx[e] * (s - this.L); out.z = this.zs[e] + this.tz[e] * (s - this.L); return out; }
    const f = s / this.ds, i = Math.floor(f), w = f - i;
    out.x = this.xs[i] + (this.xs[i + 1] - this.xs[i]) * w;
    out.z = this.zs[i] + (this.zs[i + 1] - this.zs[i]) * w;
    return out;
  }
  tan(s, out) {
    out = out || { x: 0, z: 0 };
    const f = Math.min(this.K - 1e-9, Math.max(0, s / this.ds)), i = Math.floor(f), w = f - i;
    let x = this.tx[i] + (this.tx[i + 1] - this.tx[i]) * w, z = this.tz[i] + (this.tz[i + 1] - this.tz[i]) * w;
    const l = Math.hypot(x, z) || 1; out.x = x / l; out.z = z / l; return out;
  }
}
const pathCache = new Map();
export function getPath(name, a0Shift = 0) {
  const key = name + '@' + a0Shift.toFixed(3);
  if (!pathCache.has(key)) pathCache.set(key, new Path({ ...PATH_DEFS[name], a0: PATH_DEFS[name].a0 + a0Shift }));
  return pathCache.get(key);
}

// ---------------------------------------------------------------- Levels
export const LEVEL_COUNT = 10;
const T = [
  // name, path, colors, total, speed, clump, powers, powerP, surge
  ['Awakening',     'spiral',   3, 30, 0.85, 0.35, ['bomb'],                         0.06, null],
  ['Mossy Steps',   'spiralCW', 4, 36, 0.95, 0.32, ['bomb', 'slow'],                 0.07, null],
  ['Temple Gate',   'square',   4, 42, 1.05, 0.30, ['bomb', 'slow', 'rainbow'],      0.07, null],
  ['Serpent Coil',  'wobble',   5, 48, 1.15, 0.26, ['bomb', 'slow', 'rainbow'],      0.07, null],
  ['Long Fuse',     'fuse',     5, 54, 1.25, 0.24, ['bomb', 'slow', 'rainbow'],      0.07, { every: 18, dur: 2.5, mult: 1.7 }],
  ['Jade Spiral',   'spiral',   5, 60, 1.35, 0.22, POWERS,                           0.07, { every: 17, dur: 2.5, mult: 1.7 }],
  ['Skull Maze',    'square',   6, 66, 1.36, 0.20, POWERS,                           0.07, { every: 16, dur: 3.0, mult: 1.8 }],
  ['Storm Coil',    'wobble',   6, 72, 1.38, 0.18, POWERS,                           0.07, { every: 15, dur: 3.0, mult: 1.8 }],
  ['Fuse of Doom',  'fuse',     6, 80, 1.42, 0.15, POWERS,                           0.07, { every: 14, dur: 3.5, mult: 1.8 }],
  ["Zuma's Heart",  'spiralCW', 6, 90, 1.46, 0.12, POWERS,                           0.07, { every: 13, dur: 3.5, mult: 1.9 }],
];
export function levelConfig(n, mode = 'campaign') {
  let row, name, pathName, a0Shift = 0, level = n;
  if (mode === 'campaign') {
    row = T[Math.min(Math.max(n, 1), LEVEL_COUNT) - 1];
    [name, pathName] = row;
    const [, , colors, total, speed, clump, powers, powerP, surge] = row;
    return finish({ name, pathName, a0Shift, colors, total, speed, clump, powers, powerP, surge });
  }
  const names = ['spiral', 'square', 'wobble', 'fuse', 'spiralCW'];
  pathName = names[(n - 1) % names.length];
  a0Shift = ((n - 1) % 3) * 0.7;
  const colors = Math.min(6, 4 + Math.floor((n - 1) / 2));
  const total = 60 + 6 * Math.min(n, 10);
  const speed = Math.min(2.7, 1.4 + 0.11 * (n - 1));
  const clump = Math.max(0.1, 0.26 - 0.012 * n);
  const surge = n >= 3 ? { every: Math.max(11, 17 - n), dur: 3, mult: 1.9 } : null;
  return finish({ name: `Wave ${n}`, pathName, a0Shift, colors, total, speed, clump, powers: POWERS, powerP: 0.07, surge });
  function finish(c) {
    c.level = level; c.mode = mode;
    c.stars = [Math.round(c.total * 20), Math.round(c.total * 29), Math.round(c.total * 38)];   // play-score targets (calibrated with tests/calibrate.mjs)
    return c;
  }
}

// ---------------------------------------------------------------- Scoring helpers
export function matchPoints(n) { return 10 * n + 15 * (n - 3) * (n - 2); }
export function comboMult(combo) { return 1 + 0.5 * (Math.max(1, combo) - 1); }

// ---------------------------------------------------------------- Game
export class Game {
  constructor(opts = {}) {
    this.opts = { seed: 1, mode: 'campaign', level: 1, lives: 3, ...opts };
    this.reset();
  }

  /** Full restart of a run (new score, lives, level). */
  reset() {
    this.seed = this.opts.seed >>> 0;
    this.rng = mulberry32(this.seed);
    this.mode = this.opts.mode;
    this.level = this.opts.level;
    this.lives = this.opts.lives;
    this.score = 0;
    this.nextId = 1;
    this.paused = false;
    this.acc = 0;
    this.stats = { shots: 0, matchedShots: 0, maxCombo: 0, cleared: 0, bombs: 0, bestMatch: 0, levelsDone: 0 };
    this.charges = { bomb: 0, rainbow: 0, slow: 0, reverse: 0 };
    this.events = [];
    this._setupLevel();
  }

  /** Restart only the current level (score/lives kept) — used after a lost life is handled by the UI or for replay. */
  restartLevel() { this._setupLevel(); }

  nextLevel() {
    if (this.state !== 'complete') return false;
    this.level += 1;
    this._setupLevel();
    return true;
  }

  _setupLevel() {
    this.cfg = levelConfig(this.level, this.mode);
    this.path = getPath(this.cfg.pathName, this.cfg.a0Shift);
    this.chain = [];
    this.projectiles = [];
    this.queue = this.cfg.total;
    this.total = this.cfg.total;
    this.cleared = 0;
    this.state = 'intro';
    this.stateT = 1.8;
    this.t = 0;
    this.slowT = 0; this.reverseT = 0;
    this.armed = null;
    this.combo = 0; this.comboT = 0; this.streak = 0; this.rolling = false;
    this.shotCd = 0;
    this.danger = 0; this.dangerOn = false; this.surgeOn = false;
    this.gen = { last: -1, run: 0, sincePower: 3 };
    this.levelShots = 0; this.levelMatched = 0; this.levelStartScore = this.score;
    this.cur = { color: this._pickShooterColor() };
    this.next = { color: this._pickShooterColor() };
    this.result = null;
    this.emit('level_start', { level: this.level, name: this.cfg.name, total: this.total, mode: this.mode });
  }

  emit(type, data) { this.events.push({ type, ...data }); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  // ------------------------------------------------ public controls
  setPaused(p) { if (this.state === 'over') return; this.paused = !!p; this.emit(p ? 'pause' : 'resume'); }

  advance(dt) {
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= STEP) { this.step(STEP); this.acc -= STEP; }
  }

  swap() {
    if (this.paused || (this.state !== 'playing' && this.state !== 'intro')) return false;
    const c = this.cur; this.cur = this.next; this.next = c;
    this.emit('swap', {});
    return true;
  }

  usePower(kind) {
    if (this.paused || this.state !== 'playing' || !(kind in this.charges) || this.charges[kind] <= 0) return false;
    if (kind === 'bomb' || kind === 'rainbow') {
      this.armed = this.armed === kind ? null : kind;
      this.emit('arm', { kind: this.armed });
      return true;
    }
    if (kind === 'slow') {
      this.charges.slow--;
      const refresh = this.slowT > 0;
      this.slowT = SLOW_DUR;                       // activating again REFRESHES the timer; it never stacks
      this.emit('slow_on', { refresh, dur: SLOW_DUR });
      return true;
    }
    if (kind === 'reverse') {
      if (!this.chain.length) return false;
      this.charges.reverse--;
      this.reverseT = REVERSE_DUR;
      this.emit('reverse_on', { dur: REVERSE_DUR });
      return true;
    }
    return false;
  }

  /** Fire along unit direction (dx,dz). Returns true if a projectile was created. */
  fire(dx, dz) {
    if (this.paused || this.state !== 'playing' || this.shotCd > 0 || this.projectiles.length >= MAX_PROJECTILES) return false;
    const l = Math.hypot(dx, dz);
    if (!(l > 1e-6)) return false;
    dx /= l; dz /= l;
    let type = 'normal', color = this.cur.color;
    if (this.armed && this.charges[this.armed] > 0) {
      type = this.armed; this.charges[type]--; this.armed = null; color = -1;
      this.emit('arm', { kind: null });
    } else {
      this.cur = this.next;
      this.next = { color: this._pickShooterColor() };
      this.stats.shots++; this.levelShots++;
    }
    const p = { id: this.nextId++, x: dx * MUZZLE, z: dz * MUZZLE, vx: dx * SHOT_SPEED, vz: dz * SHOT_SPEED, color, type, age: 0, counted: type === 'normal' };
    this.projectiles.push(p);
    this.shotCd = SHOT_COOLDOWN;
    this.emit('shot', { id: p.id, x: p.x, z: p.z, dx, dz, kind: type, color });
    return true;
  }

  /** Predict where a shot along (dx,dz) would land, using the SAME collision code as live projectiles. */
  /**
   * Where a shot fired along (dx,dz) will land. lead=true (default, used by the aim guide) accounts for the chain
   * moving while the projectile flies; lead=false is the static-chain geometry (what the bots use).
   */
  predict(dx, dz, lead = true) {
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const x0 = dx * MUZZLE, z0 = dz * MUZZLE, maxLen = 24;
    let off = null, h = this._firstHit(x0, z0, dx, dz, maxLen, null);
    if (lead && h && this.chain.length && this.state === 'playing') {
      const segs = this._segments(); const sv = this.reverseT > 0 ? null : this._segmentVel(segs).vel;
      const n = this.chain.length; if (!this._pv || this._pv.length < n) { this._pv = new Float64Array(n + 64); this._po = new Float64Array(n + 64); }   // reused: predict() runs every frame
      const vel = this._pv;
      for (let k = 0; k < segs.length; k++) for (let i = segs[k][0]; i <= segs[k][1]; i++) vel[i] = sv ? sv[k] : -REVERSE_SPEED;
      for (let it = 0; it < 4 && h; it++) {                  // fixed-point: flight time depends on where it lands
        const T = h.t / SHOT_SPEED;
        off = this._po; for (let i = 0; i < n; i++) off[i] = vel[i] * T;
        const h2 = this._firstHit(x0, z0, dx, dz, maxLen, off);
        if (!h2) break;
        const done = h2.index === h.index && Math.abs(h2.t - h.t) < 1e-3; h = h2; if (done) break;
      }
    }
    if (!h) return { hit: false, x: x0 + dx * maxLen, z: z0 + dz * maxLen, x0, z0 };
    const cx = x0 + dx * h.t, cz = z0 + dz * h.t;
    const slot = this._slot(h.index, cx, cz, off ? off[h.index] : 0);
    return { hit: true, x: cx, z: cz, x0, z0, index: h.index, ballId: this.chain[h.index].id, side: slot.side, lead: !!off };
  }

  // ------------------------------------------------ simulation
  step(dt) {
    if (this.paused || this.state === 'over') return;
    this._tickVisuals(dt);
    switch (this.state) {
      case 'intro':
        this.stateT -= dt;
        if (this.stateT <= 0) { this.state = 'playing'; this.emit('go', {}); }
        return;
      case 'respawn':
        this.stateT -= dt;
        if (this.stateT <= 0) { this.state = 'playing'; this.emit('go', { respawn: true }); }
        return;
      case 'devour': this._stepDevour(dt); return;
      case 'complete': return;
      default: break;
    }
    // ---- playing
    this.t += dt;
    this.shotCd = Math.max(0, this.shotCd - dt);
    if (this.slowT > 0) { this.slowT -= dt; if (this.slowT <= 0) { this.slowT = 0; this.emit('slow_off', {}); } }
    this._stepSurge();
    this._stepChain(dt);
    this._stepProjectiles(dt);
    this.comboT -= dt;
    if (this.combo > 0 && this.comboT <= 0 && !this.rolling) { this.emit('combo_end', { combo: this.combo }); this.combo = 0; }
    this._stepDanger();
    this._checkComplete();
  }

  _tickVisuals(dt) {
    const k = Math.exp(-dt * 16);
    for (const b of this.chain) {
      if (b.vis) { b.vis *= k; if (Math.abs(b.vis) < 1e-4) b.vis = 0; }
      if (b.blend) { b.blend = Math.max(0, b.blend - dt * 8); }
    }
  }

  _flowSpeed() {
    const frac = (this.total - this.queue) / this.total;       // released fraction of this level's marbles
    let v = this.cfg.speed * (1 + SPEED_RAMP * frac);
    if (this.surgeOn) v *= this.cfg.surge.mult;
    return v;
  }

  _stepSurge() {
    const s = this.cfg.surge;
    if (!s) return;
    const on = (this.t % s.every) > (s.every - s.dur);
    if (on !== this.surgeOn) { this.surgeOn = on; this.emit(on ? 'surge_on' : 'surge_off', {}); }
  }

  _segments() {
    const c = this.chain, segs = [];
    let a = 0;
    for (let i = 1; i <= c.length; i++) {
      if (i === c.length || c[i].s - c[i - 1].s > D + EPS) { segs.push([a, i - 1]); a = i; }
    }
    return segs;
  }

  /** Per-segment velocity along the path (units/s) from the current state; shared by the simulation and the aim prediction. */
  _segmentVel(segs) {
    const c = this.chain;
    const slowF = this.slowT > 0 ? SLOW_MULT : 1;
    const v = this._flowSpeed() * slowF;
    const roll = c.length < MIN_ON_PATH && this.queue > 0;
    const vel = new Array(segs.length).fill(0);
    let v0 = roll ? ROLL_SPEED : v;
    if (segs.length > 1) v0 = Math.max(v0, Math.max(v * 2.2, 2.4 * slowF));   // rear segments close gaps faster than the flow
    vel[0] = v0;
    let rolling = false;
    const open = new Array(segs.length).fill(0);
    for (let k = 1; k < segs.length; k++) {
      const ia = segs[k - 1][1], ib = segs[k][0];
      open[k] = c[ib].s - c[ia].s - D;
      if (c[ia].color === c[ib].color && c[ia].color >= 0) {
        let left = 0, right = 0;
        for (let i = ia; i >= segs[k - 1][0] && c[i].color === c[ia].color; i--) left++;
        for (let i = ib; i <= segs[k][1] && c[i].color === c[ib].color; i++) right++;
        if (left + right >= 3) { vel[k] = -BACKROLL; rolling = true; }   // matching ends: front segment rolls back
      }
    }
    return { vel, open, rolling };
  }

  _stepChain(dt) {
    const c = this.chain;
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      for (const b of c) b.s -= REVERSE_SPEED * dt;
      while (c.length && c[0].s < FEED_S) { const b = c.shift(); this.queue++; this.emit('retreat', { id: b.id }); }
      if (this.reverseT <= 0) { this.reverseT = 0; this.emit('reverse_off', {}); }
      this.rolling = false;
      return;
    }
    if (!c.length) { this.rolling = false; this._spawn(); return; }
    const segs = this._segments();
    const { vel, open, rolling } = this._segmentVel(segs);
    this.rolling = rolling;
    for (let k = 0; k < segs.length; k++) {
      if (vel[k] === 0) continue;
      const d = vel[k] * dt;
      for (let i = segs[k][0]; i <= segs[k][1]; i++) c[i].s += d;
    }
    // contact resolution, tail -> head: a rear segment that reaches a front one pushes it (never overlaps)
    const joins = [];
    for (let k = 1; k < segs.length; k++) {
      const ia = segs[k - 1][1], ib = segs[k][0];
      const need = c[ia].s + D - c[ib].s;
      if (need > -1e-9) {
        if (need > 0) for (let i = segs[k][0]; i <= segs[k][1]; i++) { c[i].s += need; c[i].vis -= need; }
        if (open[k] > EPS) joins.push([c[ia].id, c[ib].id]);
      }
    }
    this._spawn();
    for (const [ida, idb] of joins) {            // join events (gap closed) -> secondary match check
      const i = this._indexOf(ida);
      if (i < 0 || i + 1 >= c.length || c[i + 1].id !== idb) continue;
      this.emit('join', { id: ida });
      this._resolveFrom(i, false);
    }
  }

  _indexOf(id) { const c = this.chain; for (let i = 0; i < c.length; i++) if (c[i].id === id) return i; return -1; }

  _genColor() {
    const n = this.cfg.colors, g = this.gen;
    let c;
    if (g.last >= 0 && g.run < 2 && this.rng() < this.cfg.clump) c = g.last;
    else { do { c = Math.floor(this.rng() * n); } while (n > 1 && c === g.last); }
    g.run = c === g.last ? g.run + 1 : 1; g.last = c;
    return c;
  }

  _newBall(s, color, token) {
    return { id: this.nextId++, color, s, token: token || null, vis: 0, blend: 0, fx: 0, fromX: 0, fromZ: 0 };
  }

  _spawn() {
    const c = this.chain;
    let guard = 0;
    while (this.queue > 0 && guard++ < 8) {
      let s;
      if (!c.length) s = FEED_S;
      else {
        const tail = c[0];
        if (tail.s < FEED_S + D - 1e-9) break;
        s = (tail.s - D < FEED_S + D) ? tail.s - D : FEED_S;
      }
      let token = null;
      this.gen.sincePower++;
      if (this.cfg.powers.length && this.gen.sincePower >= 7 && this.rng() < this.cfg.powerP) {
        token = this.cfg.powers[Math.floor(this.rng() * this.cfg.powers.length)];
        this.gen.sincePower = 0;
      }
      const b = this._newBall(s, this._genColor(), token);
      c.unshift(b);
      this.queue--;
    }
  }

  // ------------------------------------------------ projectiles
  _firstHit(x0, z0, dx, dz, maxLen, off = null) {
    // earliest distance t in [0,maxLen] along a unit ray at which a marble centre is within HIT of the ray point
    const c = this.chain, tmp = { x: 0, z: 0 };
    let best = null;
    for (let i = 0; i < c.length; i++) {
      if (c[i].s < 0.2) continue;                      // still inside the entrance gate
      this.path.pos(off ? c[i].s + off[i] : c[i].s, tmp);
      const fx = x0 - tmp.x, fz = z0 - tmp.z;
      const b = fx * dx + fz * dz, cc = fx * fx + fz * fz - HIT * HIT;
      let t;
      if (cc <= 0) t = 0;
      else {
        const disc = b * b - cc;
        if (disc < 0) continue;
        t = -b - Math.sqrt(disc);
        if (t < 0 || t > maxLen) continue;
      }
      if (best === null || t < best.t) best = { t, index: i };
    }
    return best;
  }

  _slot(i, cx, cz, off = 0) {
    const b = this.chain[i], p = this.path.pos(b.s + off), tg = this.path.tan(b.s + off);
    const side = ((cx - p.x) * tg.x + (cz - p.z) * tg.z) >= 0 ? 'ahead' : 'behind';
    return side === 'ahead' ? { side, idx: i + 1, s: b.s + D } : { side, idx: i, s: b.s };
  }

  _stepProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      const len = SHOT_SPEED * dt;
      const dx = p.vx / SHOT_SPEED, dz = p.vz / SHOT_SPEED;
      p.age += dt;
      const h = this.chain.length ? this._firstHit(p.x, p.z, dx, dz, len) : null;
      if (h) {
        const cx = p.x + dx * h.t, cz = p.z + dz * h.t;
        this.projectiles.splice(i, 1);
        this._land(p, h.index, cx, cz);
        continue;
      }
      p.x += dx * len; p.z += dz * len;
      if (p.age > 2.2 || Math.hypot(p.x, p.z) > 19) {
        this.projectiles.splice(i, 1);
        if (p.counted) this.streak = 0;
        this.emit('miss', { id: p.id, x: p.x, z: p.z });
      }
    }
  }

  _land(p, hitIndex, cx, cz) {
    const c = this.chain, slot = this._slot(hitIndex, cx, cz);
    const nb = this._newBall(slot.s, p.color, null);
    nb.fromX = cx; nb.fromZ = cz; nb.blend = 1;
    c.splice(slot.idx, 0, nb);
    for (let j = slot.idx + 1; j < c.length; j++) {            // push head-side marbles only as far as needed
      const need = c[j - 1].s + D - c[j].s;
      if (need > 1e-9) { c[j].s += need; c[j].vis -= need; } else break;
    }
    const pos = this.path.pos(nb.s);
    this.emit('insert', { id: nb.id, x: cx, z: cz, sx: pos.x, sz: pos.z, kind: p.type });
    if (p.type === 'bomb') { this._bomb(slot.idx); return; }
    if (p.type === 'rainbow') {
      nb.color = this._rainbowColor(slot.idx);
      nb.fx = 1;                                              // renderer: sparkle once, but body is the real colour
      this.emit('rainbow', { id: nb.id, color: nb.color });
    }
    const matched = this._resolveFrom(slot.idx, true);
    if (p.counted || p.type === 'rainbow') {
      if (matched) { this.streak++; this.stats.matchedShots++; this.levelMatched++; }
      else this.streak = 0;
    }
  }

  _touching(i) { const c = this.chain; return i >= 0 && i + 1 < c.length && c[i + 1].s - c[i].s <= D + EPS; }

  _runAround(idx) {
    const c = this.chain, col = c[idx].color;
    let L = idx, Rr = idx;
    while (L > 0 && this._touching(L - 1) && c[L - 1].color === col) L--;
    while (Rr < c.length - 1 && this._touching(Rr) && c[Rr + 1].color === col) Rr++;
    return [L, Rr];
  }

  _rainbowColor(idx) {
    const c = this.chain;
    const cand = new Set();
    if (this._touching(idx - 1) && c[idx - 1].color >= 0) cand.add(c[idx - 1].color);
    if (this._touching(idx) && c[idx + 1].color >= 0) cand.add(c[idx + 1].color);
    if (!cand.size) {                                       // isolated: use the most common colour on the board
      const cnt = new Array(this.cfg.colors).fill(0);
      for (const b of c) if (b.color >= 0) cnt[b.color]++;
      let best = 0; for (let i = 1; i < cnt.length; i++) if (cnt[i] > cnt[best]) best = i;
      return best;
    }
    let bestC = -1, bestN = -1, bestHead = -1;
    for (const col of cand) {
      let l = 0, r = 0;
      for (let i = idx - 1; i >= 0 && this._touching(i) && c[i].color === col; i--) l++;
      for (let i = idx + 1; i < c.length && this._touching(i - 1) && c[i].color === col; i++) r++;
      const n = 1 + l + r, head = r;
      if (n > bestN || (n === bestN && head > bestHead)) { bestN = n; bestC = col; bestHead = head; }
    }
    return bestC;
  }

  /** Check for a match containing chain[idx]. Returns true if a group was removed. */
  _resolveFrom(idx, fromShot) {
    const c = this.chain;
    if (idx < 0 || idx >= c.length || c[idx].color < 0) return false;
    const [L, Rr] = this._runAround(idx);
    const n = Rr - L + 1;
    if (n < 3) return false;
    this.combo++; this.comboT = 0.45;
    this.stats.maxCombo = Math.max(this.stats.maxCombo, this.combo);
    this.stats.bestMatch = Math.max(this.stats.bestMatch, n);
    const color = c[L].color;
    const balls = this._removeRange(L, Rr);
    const streakBonus = fromShot ? Math.min(100, 10 * this.streak) : 0;   // streak counts shots before this one
    const pts = Math.round(matchPoints(n) * comboMult(this.combo)) + streakBonus;
    this.score += pts;
    this.emit('match', { n, color, pts, combo: this.combo, cascade: !fromShot, streak: this.streak + (fromShot ? 1 : 0), balls });
    return true;
  }

  _bomb(idx) {
    const c = this.chain, s0 = c[idx].s;
    let L = idx, Rr = idx;
    while (L > 0 && s0 - c[L - 1].s <= BOMB_REACH + EPS) L--;
    while (Rr < c.length - 1 && c[Rr + 1].s - s0 <= BOMB_REACH + EPS) Rr++;
    const center = this.path.pos(s0);
    this.combo++; this.comboT = 0.45;
    this.stats.maxCombo = Math.max(this.stats.maxCombo, this.combo);
    this.stats.bombs++;
    const balls = this._removeRange(L, Rr);
    const pts = Math.round((20 * balls.length + 50) * comboMult(this.combo));
    this.score += pts;
    this.emit('bomb', { x: center.x, z: center.z, radius: BOMB_REACH, n: balls.length, pts, combo: this.combo, balls });
  }

  _removeRange(L, Rr) {
    const removed = this.chain.splice(L, Rr - L + 1);
    const balls = [];
    for (const b of removed) {
      const p = this.path.pos(b.s);
      balls.push({ id: b.id, color: b.color, x: p.x, z: p.z, token: b.token });
      if (b.token && b.color !== undefined) {
        this.charges[b.token] = Math.min(MAX_CHARGE, this.charges[b.token] + 1);
        this.emit('power_gain', { kind: b.token, x: p.x, z: p.z, count: this.charges[b.token] });
      }
    }
    this.cleared += removed.length;
    this.stats.cleared += removed.length;
    return balls;
  }

  // ------------------------------------------------ danger / life / completion
  _stepDanger() {
    const c = this.chain;
    if (!c.length) { this._setDanger(0); return; }
    const head = c[c.length - 1];
    const dist = this.path.L - head.s;
    this._setDanger(Math.min(1, Math.max(0, 1 - dist / DANGER_DIST)));
    if (head.s >= this.path.L - HOLE_MARGIN) this._loseLife();
  }

  _setDanger(v) {
    this.danger = v;
    const on = this.dangerOn ? v > 0.02 : v > 0.08;     // hysteresis
    if (on !== this.dangerOn) { this.dangerOn = on; this.emit(on ? 'danger_on' : 'danger_off', {}); }
  }

  _loseLife() {
    if (this.state !== 'playing') return;                // guard: exactly one transition per crossing
    this.lives--;
    this.state = 'devour'; this.stateT = 0;
    this.projectiles = [];
    this.armed = null;
    this.slowT = 0; this.reverseT = 0; this.surgeOn = false;
    this.combo = 0; this.streak = 0; this.rolling = false;
    this._setDanger(1);
    this.devoured = 0;
    this.emit('life_lost', { lives: this.lives });
  }

  _stepDevour(dt) {
    this.stateT -= dt;
    while (this.stateT <= 0 && this.chain.length) {
      this.stateT += 0.045;
      const b = this.chain.pop();
      const p = this.path.pos(b.s);
      this.queue++; this.devoured++;
      this.emit('devour', { id: b.id, color: b.color, x: p.x, z: p.z });
    }
    if (!this.chain.length) {
      this._setDanger(0);
      if (this.lives <= 0) {
        this.state = 'over';
        this.result = this._result(false);
        this.emit('game_over', { ...this.result });
      } else {
        this.state = 'respawn'; this.stateT = 1.5;
        this.emit('respawn', { lives: this.lives });
      }
    }
  }

  _checkComplete() {
    if (this.state !== 'playing' || this.queue !== 0 || this.chain.length !== 0) return;
    this.state = 'complete';                              // one-shot: later steps never re-enter
    this.stats.levelsDone++;
    const acc = this.levelShots ? this.levelMatched / this.levelShots : 0;
    const bonus = 1000 + this.lives * 250 + Math.round(acc * 1000);
    this.score += bonus;
    const levelScore = this.score - this.levelStartScore;
    const playScore = levelScore - bonus;                   // stars judge play (matches, combos, streaks), not the flat bonus
    const stars = this.cfg.stars.filter(t => playScore >= t).length;
    this.result = { ...this._result(true), bonus, accuracy: acc, levelScore, playScore, stars, target: this.cfg.stars };
    this.emit('level_complete', { ...this.result });
  }

  _result(won) {
    return { won, score: this.score, level: this.level, lives: this.lives, maxCombo: this.stats.maxCombo, mode: this.mode, cleared: this.stats.cleared, shots: this.stats.shots, matchedShots: this.stats.matchedShots };
  }

  _pickShooterColor() {
    const n = this.cfg.colors, c = this.chain;
    if (!c.length) return Math.floor(this.rng() * n);
    const w = new Array(n).fill(0);
    for (let i = 0; i < c.length; i++) {
      if (c[i].color < 0 || c[i].s < 0.5) continue;
      w[c[i].color] += i >= c.length - 12 ? 2 : 1;           // colours near the hole are favoured
    }
    let tot = 0; for (const x of w) tot += x;
    if (!tot) return Math.floor(this.rng() * n);
    let r = this.rng() * tot;
    for (let i = 0; i < n; i++) { r -= w[i]; if (r < 0) return i; }
    return n - 1;
  }

  // ------------------------------------------------ introspection (tests / UI)
  ballWorld(b, out) { return this.path.pos(b.s, out); }
  marblesLeft() { return this.queue + this.chain.length; }
  checkInvariants() {
    const c = this.chain, errs = [];
    for (let i = 1; i < c.length; i++) {
      const gap = c[i].s - c[i - 1].s;
      if (!(gap >= D - 1e-6)) errs.push(`overlap/order at ${i}: gap=${gap}`);
    }
    const ids = new Set(c.map(b => b.id));
    if (ids.size !== c.length) errs.push('duplicate ids');
    return errs;
  }
  digest() {
    return JSON.stringify({
      state: this.state, level: this.level, lives: this.lives, score: this.score, queue: this.queue, cleared: this.cleared,
      chain: this.chain.map(b => [b.color, +b.s.toFixed(4), b.token]), proj: this.projectiles.length, charges: this.charges,
      combo: this.combo, streak: this.streak, slowT: this.slowT, reverseT: this.reverseT, armed: this.armed, paused: this.paused,
    });
  }
}
