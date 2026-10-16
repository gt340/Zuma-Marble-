# Phase 1 — Audit of the original `zuma3d-android.html`

Evidence labels:
- **[measured]** the original, unmodified source was executed in Node (`audit/harness.mjs`) with a stubbed Three.js (real vector math, a faithful port of `CatmullRomCurve3`) and fake timers. Raw output: `audit/results.txt`. Re-run: `node audit/experiments.mjs audit/original/zuma3d-android.html`.
- **[computed]** pure geometry on the original camera/path numbers (`audit/e10.mjs`).
- **[code-read]** found by reading the source only; not executed. The original was never run in a real browser/GPU here.

## 1. Why the chain is neither predictable-by-design nor threatening-by-design

| # | Issue | Cause | Impact | Correction |
|---|---|---|---|---|
| 1.1 | Chain speed is wildly uneven **[measured]**: 2.2 – 15 world-units/s (avg 9.3) at `BASE_SPEED`. With no input the head reaches the lose line in **2.9 s**. | `progress` is the Catmull-Rom *parameter* t, not arc length; `progress += BASE_SPEED*dt*60`. | Pressure is chaotic, not designed; the player cannot read a rhythm. The "very slow start" comment is false. | All positions are arc-length `s` in world units; speed is in units/s per level. |
| 1.2 | Path is only 52.8 units, **self-crossing** (2204 sampled point-pairs < 1.2 apart but > 6 arc-units apart) and ends **1.0 unit from the frog** **[measured]**. | Radius formula `0.42+0.58·sin(1.6πt)` goes negative after t≈0.625, flipping the spiral through the centre. | Shots hit the wrong stretch of chain; the "danger endpoint" is hidden under the frog. | Analytic non-intersecting paths (spiral, rounded-square spiral, wobble spiral, long fuse); skull hole ≥ 3.4 from the frog. A test asserts no self-crossing for every path. |
| 1.3 | Pressure never varies: one scalar speed, time ramp (÷90 s, ×2.4) × score ramp (×1.5). Spawn is `Math.random() < 0.012` **per frame** **[code-read]**. | No level model; spawn not time-based. | Spawn rate doubles on 120 Hz phones; identical loop forever. | Fixed 120 Hz simulation step, per-level speed, colours, chain length, surges, clump rate. |

## 2. Aiming, shooting, collision, insertion

| # | Issue | Cause | Impact | Correction |
|---|---|---|---|---|
| 2.1 | Effective hit radius ≈ **0.3** instead of 0.96 **[measured]**: lateral offsets ≥ 0.4 pass straight through. At a 30 fps frame (dt 1/30) **every** shot tunnels, even dead-centre. | Projectile spawns at y = 1.4, balls at y ≈ 0.5; `distanceTo` is 3-D (Δy = 0.9). Step is 0.68/frame, discrete test. | "Shots pass through marbles." | 2-D swept circle-vs-circle test (exact first contact), speed-independent. |
| 2.2 | Aim error up to 3.4° (≈ 0.38 units at the ball, ball radius 0.48) **[computed]**. | Ray cast to plane y = 0 while balls sit at y = 0.5. | Tapping a ball visibly can miss. | Ray cast to the ball-height plane; shot direction = that exact point. |
| 2.3 | Projectile starts at frog centre, not the muzzle **[code-read]**. | `mesh.position.copy(frog.position)`. | Shot appears from the body. | Spawn at muzzle along aim direction. |
| 2.4 | `insert()` always inserts *before* the hit ball, new ball takes the hit ball's progress, then pushes **all** later balls by 0.85 spacing, clamped at 0.985 **[code-read]**. | No side-of-impact test; no contiguity check. | Wrong order; 15 % overlap; balls near the end stack at one point. | Side test via path tangent; place at slot; push head-side balls only until overlap is resolved. |
| 2.5 | Collision picks the first ball in *array* order inside the radius, not the nearest **[code-read]**; arrays are not in path order (4.2). | loop `break` on first match. | Attaches to a farther ball. | Earliest time-of-impact over all balls. |
| 2.6 | `pointercancel` is wired to `onUp`, which **fires a shot** **[code-read]**; no pointer capture. | shared handler. | System gesture/cancel shoots. | Cancel aborts; pointer capture; shoot only on real release. |
| 2.7 | No trajectory, muzzle flash, trail, impact flash, recoil. | not implemented. | Misses feel arbitrary. | Predicted-impact guide using the *same* collision code, plus effects. |

## 3. Matches and chain reactions

| # | Issue | Cause | Impact | Correction |
|---|---|---|---|---|
| 3.1 | After removing n balls, the join spacing is 0.55, 0.40, 0.25, 0.10 of normal for n = 3, 4, 5, 6 and **order inverts** for n ≥ 7 **[measured]**. | `removeRange` pulls later balls back by `1.15 × gap`. | Overlap, reversed ordering. | Removal leaves a true gap; physics closes it (3.2). |
| 3.2 | No gap-closing or roll-back; data teleports, view lerps at 0.28/frame **[code-read]**. | Index adjacency treated as physical adjacency. | No Zuma feel. | Segment model: front segment stops, rear closes the gap, matching ends trigger a fast roll-back. |
| 3.3 | Cascades are two `setTimeout(match(...))` calls using indices captured before the chain changed **[code-read]**. | Async stale indices. | Wrong or double processing. | Cascade is driven by the simulation: merge event → match check. No timers anywhere in logic. |
| 3.4 | No combo tracking or multiplier; scoring flat. | — | No reward for skill. | Combo, shot streak, size bonus, accuracy bonus. |

## 4. Spacing, progress, ordering

| # | Issue | Cause | Impact | Correction |
|---|---|---|---|---|
| 4.1 | Neighbour spacing is 0.36–2.49 units = **0.38×–2.6× the ball diameter** **[measured]**. | `BALL_SPACING` is in t units. | Overlaps and gaps by construction. | Spacing = diameter in arc length; invariant tested. |
| 4.2 | New spawns are `push()`ed to the array end though they have the **lowest** progress: after 12 s, 100 order-inversion pairs among 23 balls **[measured]**. | `addBall` appends. | Matches can join balls from opposite ends; `loseLife` pops the wrong end. | Chain kept sorted by `s`; spawn inserts at the tail (index 0). |
| 4.3 | "Tight packing" only closes gaps, never fixes overlaps **[code-read]**. | one-sided `if`. | Overlaps persist. | Hard constraint `s[i+1]-s[i] ≥ D` each step. |

## 5. Power-ups

| # | Issue | Cause | Impact | Correction |
|---|---|---|---|---|
| 5.1 | 22.7 % of shots are power marbles, **70 % of them bombs**, 19 % rainbow, 11 % slow **[measured, 200k shots]**. | `randomPower() \|\| BOMB` fallback plus a second roll. | Specials are routine; no decision. | Powers are *earned* from marked chain marbles, stored (max 2), armed deliberately. |
| 5.2 | Bomb/slow marbles carry a hidden random colour and take part in colour matches invisibly **[code-read]**. | colour index kept, mesh overridden. | Unexplained removals. | Special marbles keep their visible colour plus a symbol; fired power marbles are explicit types. |
| 5.3 | Rainbow keeps `userData.rainbow`, so the per-frame emissive animation overwrites the new colour; may choose a colour that forms no match **[code-read]**. | flag never cleared. | Appearance ≠ gameplay colour. | Rainbow resolves to a real colour (best run) and is repainted as that colour. |
| 5.4 | Bomb/match run from timers: after `restart()` a pending bomb detonated in the **new** game: +150 points, 5 balls gone, no shot **[measured]**. | timers not cancelled. | Cheating/bugs. | No timers; state machine. |
| 5.5 | Chain-embedded power marbles never trigger anything **[code-read]**. | flag only used for visuals. | Dead feature. | They grant a charge when destroyed. |

## 6. Difficulty, scoring, lives

One endless wave; no goals; ramp is time/score based; life loss pushes the chain back 0.18 and sets a 1.5 s slow; no penalty. **[code-read]** Corrections: 10 levels + endless, goals, star targets, per-level parameters, controlled life-loss state (section 7).

## 7. Empty chain, async, cleanup, restart

| # | Issue | Cause | Impact | Correction |
|---|---|---|---|---|
| 7.1 | Clearing the chain awards **+57,600 points and creates 1,728 marbles** (cap is 48) within the 1.6 s respawn window **[measured]**. | The `meshes.length === 0` check runs every frame and each frame schedules another `spawnInit`. | Score corruption, freeze. | Level-complete is a one-shot state transition; empty chain mid-level just refills. |
| 7.2 | Stale timers after restart (5.4); `recovering` is one shared flag cleared by whichever timeout fires first **[code-read]**. | — | Overlapping effects cancel each other. | Timers live in state and are reset by `reset()`. |
| 7.3 | `loseLife()` has no state guard; it relies on pushing the chain back 0.18 **[code-read]**. | called from inside the per-ball loop. | Re-trigger risk. | `playing → devour → respawn` state machine; exactly one life per crossing. |
| 7.4 | No pause **[code-read]**. | — | — | Core `paused` flag freezes everything. |

## 8. Mobile performance

- Every `prepBall` allocates 2.2 geometries + 2.2 materials + 2.2 meshes; each `spawnBurst(12)` allocates 12 geometries + 12 materials **[measured]**; the source contains no `.dispose()` call **[code-read]** → GPU memory grows every shot.
- 1024² PCF-soft shadow map, per-ball unique materials and highlight child meshes (2+ draw calls/ball), 4 lights + ACES, DPR up to 2 with MSAA **[code-read]**.
- Noise buffer re-allocated on every explosion; external Google Fonts blocks first paint offline **[code-read]**.
- Correction: one `InstancedMesh` for the chain, shared geometry/materials, pooled particles, DPR cap + adaptive quality, no per-frame allocation in the hot path, no external fonts.

## 9. Camera, controls, UI, audio, PWA

- Portrait 390×844: **14 % of the path is outside the view**; landscape/desktop 0 % **[computed]**. `onResize` never re-frames. → camera fits the path bounds per aspect.
- HUD shows only the *next* marble; no pause, swap, danger warning, settings or persisted best score; the controls hint never hides **[code-read]**.
- Service worker: cache-first for everything (stale HTML after updates); `cache.addAll` includes the CDN module, so **one failed CDN fetch aborts the whole install**; fonts are not cached; the README claim "works offline after first load" was not verified by the original author **[code-read]**. Manifest uses `"purpose": "any maskable"` combined (should be separate entries).
- Audio unlock on the Play click is fine; no variation, no combo/danger audio.
