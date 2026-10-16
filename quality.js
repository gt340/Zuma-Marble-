// quality.js — pure adaptive-quality controller (no DOM, no Three.js, no clock of its own: it is driven by frame intervals).
//
// Problem it solves (Phase 3 finding): the old policy was a one-way ratchet — "45-frame mean > 28 ms => step down, never come back". A phone that is
// merely capped at 30 fps (battery saver, 30 Hz display mode) has a 33 ms frame interval whatever we render, so it was driven all the way to
// 0.75x resolution for nothing, and a transient hitch (resume, GC, thermal burst) lowered quality for the rest of the session.
//
// What can and cannot be known (stated, not hidden): from frame intervals alone a stable 30 Hz cap and a GPU that takes 25-33 ms per frame on a
// 60 Hz display (vsync rounds it up to 33 ms) look IDENTICAL. So this controller does not guess the cause; it tests the EFFECT:
//   1. overload  = two consecutive slow windows (trimmed mean > SLOW_MS)            -> one step down the ladder
//   2. benefit   = after the step the next window must be at least BENEFIT faster or back under SLOW_MS; if not, the step did not help,
//                  i.e. the limit is not our rendering cost (a cap, or a bottleneck we do not control) -> REVERT the step and lock out
//                  further downgrades with exponential back-off (so a capped device settles at full quality and stops probing)
//   3. recovery  = only after HEADROOM_WINDOWS consecutive windows under FAST_MS (and no lockout): one step UP, on probation — if the next window
//                  is slow again the step is reverted at once and upgrades are locked out with back-off
// Hysteresis: down above SLOW_MS (28), up only below FAST_MS (20) — an 8 ms dead band. Cooldown: SETTLE_MS after every change is ignored.
// Limitation: if the device is both capped at 30 AND genuinely over budget at 60, we cannot tell; the policy errs towards keeping quality (an
// unnecessary downgrade costs sharpness for the whole session, an unnecessary upgrade attempt costs one 2 s probe and is reverted).
// Manual overrides are ceilings: the ladder is built from them (level 0 = what the user/URL asked for), so recovery never exceeds them,
// and ?adapt=0 simply never constructs this object.

export const CFG = Object.freeze({
  WINDOW_MS: 2000, MIN_SAMPLES: 20,        // a window closes after >= 2 s of running frames (and >= 20 of them)
  STALL_MS: 250, STALL_RUN: 4,             // an ISOLATED interval above this is a stall (tab switch, resume, GC, hitch), not a rendering cost: dropped, counted.
                                           // STALL_RUN or more in a row is not a stall, it is a device running at < 4 fps: those frames are measured (clamped to 1 s)
  TRIM: 0.1,                               // trimmed mean drops the slowest 10% of intervals so isolated hitches cannot trigger a downgrade
  SLOW_MS: 28, FAST_MS: 20,                // hysteresis band (36 fps / 50 fps)
  DOWN_WINDOWS: 2,                         // consecutive slow windows before the first step down (4 s)
  HEADROOM_WINDOWS: 5,                     // consecutive fast windows before a step up (10 s)
  SETTLE_MS: 1000,                         // frames right after a change are ignored (buffer reallocation, shader warm-up)
  BENEFIT: 0.06,                           // a downgrade must cut the trimmed mean by >= 6% (or end under SLOW_MS)
  LOCK_MS: 30000, LOCK_MAX_MS: 480000,     // back-off for failed probes: 30 s, doubling, capped at 8 min of running time
  MAX_FAILED_PROBES: 3,                    // downgrade probes that bought nothing: after this many the device is treated as cap-limited for the session
});

export function trimmedMean(a, trim = CFG.TRIM) {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y), keep = Math.max(1, Math.ceil(s.length * (1 - trim)));
  let sum = 0; for (let i = 0; i < keep; i++) sum += s[i];
  return sum / keep;
}

export class AdaptiveQuality {
  /** @param levels number of ladder steps (level 0 = best/ceiling). The owner maps a level index to actual settings. */
  constructor(levels, cfg = {}) {
    this.c = { ...CFG, ...cfg };
    this.n = Math.max(1, levels | 0);
    this.level = 0;
    this.reset();
  }
  reset() {
    this.buf = []; this.winMs = 0; this.stalls = 0; this.stallRun = 0; this.slowDevice = false;
    this.slowRun = 0; this.fastRun = 0; this.settle = 0;
    this.probe = null;                       // {kind:'down'|'up', prevLevel, before}
    this.clock = 0;                          // running time seen so far (ms) — the only clock
    this.downLockUntil = 0; this.upLockUntil = 0; this.downBackoff = this.c.LOCK_MS; this.upBackoff = this.c.LOCK_MS;
    this.lastMean = 0; this.windows = 0; this.changes = 0; this.reverts = 0; this.capSuspected = false; this.failedDown = 0;
  }
  /** Current state for diagnostics / tests. */
  get state() {
    return { level: this.level, levels: this.n, lastMeanMs: +this.lastMean.toFixed(2), windows: this.windows, changes: this.changes, reverts: this.reverts,
      capSuspected: this.capSuspected, probe: this.probe ? this.probe.kind : null, downLocked: this.clock < this.downLockUntil, upLocked: this.clock < this.upLockUntil, stalls: this.stalls };
  }
  /** Frames that are not "running" (paused, hidden, dt=0) break the window: nothing measured across a pause is meaningful. */
  interrupt() { this.buf.length = 0; this.winMs = 0; }
  /**
   * Feed one rendered frame. `ms` = raw interval since the previous frame (NOT the game's clamped dt); `running` = false for paused frames.
   * Returns null, or {action:'down'|'up'|'revert', level, reason, meanMs} when the owner must apply `level`.
   */
  sample(ms, running = true) {
    if (!running || !(ms > 0)) { this.interrupt(); return null; }
    if (ms > this.c.STALL_MS) {
      if (!this.slowDevice && ++this.stallRun < this.c.STALL_RUN) { this.stalls++; this.interrupt(); return null; }   // isolated: also restarts the window (it straddles a context switch)
      this.slowDevice = true; ms = Math.min(ms, 1000);                                                              // persistent: a genuinely overloaded device, keep measuring
    } else if (ms < this.c.STALL_MS * 0.6) { this.stallRun = 0; this.slowDevice = false; }                          // hysteresis: only clearly normal frames end slow-device mode
    this.clock += ms;
    if (this.settle > 0) { this.settle -= ms; return null; }
    this.buf.push(ms); this.winMs += ms;
    if (this.winMs < this.c.WINDOW_MS || this.buf.length < this.c.MIN_SAMPLES) return null;
    const mean = trimmedMean(this.buf); this.buf.length = 0; this.winMs = 0; this.lastMean = mean; this.windows++;
    return this.window(mean);
  }
  change(level, action, reason, mean, probe) {
    this.level = level; this.changes++; this.settle = this.c.SETTLE_MS; this.slowRun = 0; this.fastRun = 0; this.probe = probe || null;
    return { action, level, reason, meanMs: +mean.toFixed(2) };
  }
  window(mean) {
    const c = this.c, slow = mean > c.SLOW_MS, fast = mean < c.FAST_MS;
    // ---- judge the previous change first
    if (this.probe) {
      const p = this.probe; this.probe = null;
      if (p.kind === 'down') {
        const helped = mean <= c.SLOW_MS || mean <= p.before * (1 - c.BENEFIT);
        if (!helped) {                       // lowering quality did not move the frame time: not our rendering cost. Undo, stop probing for a while.
          this.reverts++; this.capSuspected = true; this.failedDown++; this.downBackoff = Math.min(c.LOCK_MAX_MS, this.downBackoff * 2);
          this.downLockUntil = this.failedDown >= c.MAX_FAILED_PROBES ? Infinity : this.clock + this.downBackoff / 2;   // after 3 fruitless probes stop for the session (cap-limited)
          return this.change(p.prevLevel, 'revert', `downgrade did not help (${p.before.toFixed(1)} -> ${mean.toFixed(1)} ms): frame rate is limited by something other than rendering cost (e.g. a 30 fps cap)`, mean);
        }
        this.capSuspected = false;
      } else if (p.kind === 'up') {
        if (slow) {                          // the extra quality is not affordable: back down immediately, wait longer before trying again
          this.reverts++; this.upLockUntil = this.clock + this.upBackoff; this.upBackoff = Math.min(c.LOCK_MAX_MS, this.upBackoff * 2);
          return this.change(p.prevLevel, 'revert', `upgrade not affordable (${mean.toFixed(1)} ms)`, mean);
        }
        this.upBackoff = c.LOCK_MS;          // a successful upgrade resets the back-off
      }
    }
    // ---- streaks (hysteresis: a window inside the dead band resets both)
    this.slowRun = slow ? this.slowRun + 1 : 0;
    this.fastRun = fast ? this.fastRun + 1 : 0;
    if (slow && this.slowRun >= c.DOWN_WINDOWS && this.level < this.n - 1 && this.clock >= this.downLockUntil) {
      return this.change(this.level + 1, 'down', `sustained overload (${mean.toFixed(1)} ms mean over ${this.slowRun} windows)`, mean, { kind: 'down', prevLevel: this.level, before: mean });
    }
    if (fast && this.fastRun >= c.HEADROOM_WINDOWS && this.level > 0 && this.clock >= this.upLockUntil) {
      return this.change(this.level - 1, 'up', `sustained headroom (${mean.toFixed(1)} ms mean over ${this.fastRun} windows)`, mean, { kind: 'up', prevLevel: this.level });
    }
    return null;
  }
}
