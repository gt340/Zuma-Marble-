# Phase 3 — Android device validation (CANDIDATE, not a release; no physical-device data exists)

Input artifact: `3d-zuma-v2-phase2.zip`, 6,727,884 bytes, sha256 `19afdaca704736836f56a0b63b701cd947669e50dbbbab7f437bc246ba357ca6` — **verified against the actual file** before anything else (it matched; `unzip -t` clean). A byte-identical preserved copy was made; the original `3d-zuma-v2.zip` (sha256 `0631306b…7a9d`) and its backup were not touched.
Legend: **VERIFIED-AUTOMATED** = produced by a command here (headless Chromium + software WebGL, real Three.js r160, or simulated bots). **PHYSICAL-DEVICE** = a human ran it on a phone (none yet). **ESTIMATE** = reasoning/arithmetic, not measured. Simulated players are never described as playtesters.

## Verdict
The game is **not shown to be release-ready on Android, and cannot be shown that way without physical-device data.** Every automated gate passes, two real defects were found and fixed (Android GPU-context loss left the game stuck; drawing buffer reallocated twice per rotation/quality step), and a procedure an ordinary Android user can follow is ready (`DEVICE-TEST.md`). The blockers are listed at the end.

## Gate 1 — preserve and audit
- Baseline on the untouched Phase 2 extraction, before any edit: `npm test` 41/41 exit 0; `node tests/browser.mjs` 103/103 exit 0; `REAL=1 node tests/browser.mjs` 114/114 exit 0 (`evidence-phase3/baseline-phase2-*.log`).
- Balance evidence review: `sensitivity-before-TAINTED.txt` is excluded from every conclusion. The remaining Phase 2 paired evidence (`tune-late-levels-paired.txt`) is untainted (surge object cloned) but has only 24 seeds per cell and **no uncertainty**; it was superseded by the rerun below.

## What changed and why (only targeted fixes + test instrumentation)
| File | Change | Why / evidence |
|---|---|---|
| `main.js`, `render.js`, `zuma3d-android.html` | WebGL **context restore**: on `webglcontextlost` pause and show "Graphics interrupted"; on `webglcontextrestored` call new `gfx.restoreContext()` (rebuilds the reflection map, reapplies size) and return to the pause screen. | Before: after a restore the player stayed on a dead error screen ("Reload to continue") although the context was back. Android reclaims GPU memory in the background. Test: same 50 marbles render with mean abs RGB difference 0.69/255 (worst 2.3) after recovery; with the rebuild disabled (negative control) it is 16.16, so the check can fail. |
| `render.js` | `applySize()`: stop calling `setSize` after `setPixelRatio` (which already re-applies the size). | Probe, `?adapt=0`, 3 trials: Phase 2 = 2 `setSize` calls per rotation, now 1; each adaptive quality step also reallocates once instead of twice (`resize-probe-phase*.txt`). Smaller risk of a rotation hitch; no behaviour change. |
| `diag.js` (new), `main.js`, `sw.js` (v2.0.4, caches `diag.js`) | Optional on-device diagnostics panel, **loaded only with `?debug=1`** (not even requested otherwise); `?debug=1` also opens all levels for that page load without changing saved progress. | Needed for Gate 2: an ordinary Android user has no console, so frame times, input-to-frame delay, quality changes, memory, console errors and a JSON report must come from the page. No extra render loop (checked by test). **This is test instrumentation, new surface area — the commander may reject it; removing it is deleting `diag.js` and ~12 lines in `main.js`.** |
| `DEVICE-TEST.md`, `README.md`, `package.json` | Rewritten device procedure (12 tests), new scripts. | Gate 2. |
| tests | New `tests/gfx-fallback.mjs` (20 checks, real r160), `tests/balance-ci.mjs`, `tests/legibility.mjs`; `browser.mjs` section 18 (11 new checks); resize test now runs with `?adapt=0` and demands exactly 1 call per rotation (stricter than before). | See below. |
Level parameters, `core.js`, colours and marble geometry were **not** changed.

## Gate 2 — device procedure
`DEVICE-TEST.md` now has: three ways to serve (LAN http, USB + localhost, HTTPS URL) with exact commands; how to record device/Android/Chrome/viewport; the panel; orientation script; a minute-by-minute 10-minute session; FPS/frame-time sampling; touch response (with the honest limit that the panel measures input→next-frame only); heat/battery; memory/GPU-count growth; audio; offline reload; engine-load failure recovery; graphics A/B table with A–B–A order; battery-saver/30 Hz test; background survival; failure-report instructions; suggested blockers; result table. **No physical result is claimed anywhere.** Not executed by any human.

## Gate 3 — graphics fallbacks (real r160; `tests/gfx-fallback.mjs` 20/20, exit 0)
- **Invalid overrides cannot break start-up:** 23 odd query strings (empty, NaN, Infinity, negative, 1e999, `%00`, malformed UTF-8, script text, 4000 repeated keys, duplicates…) all reach the menu, no errors, `dprCap` within 0.5–3. Semantics: `dpr<=0` clamps to 0.5; NaN/Infinity/empty ignored; `aa`/`halo`/`env`/`adapt` act only on the exact value `0`.
- **Lowest quality is playable:** `?aa=0&dpr=0.5&halo=0&env=0&adapt=0` (backing store 180x320 vs 630x1120 default at DPR 3): taps fire, tray tap does not fire, pause/resume, 10 level restarts and 2 rotations without errors; one loop, one canvas. Aim vectors for three taps are **identical** across default / dpr=1 / lowest, so graphics settings do not change touch mapping. Legibility at this setting is a human question (marbles ≈ 8 canvas px at dpr 0.5 on a 3x screen).
- **Resources:** after two warm-up cycles, two more full cycles (pause, all 10 levels, 2 rotations) add no geometries, textures or programs in all three configs; textures ≤ 6 (4 power icons + flash sprite + reflection map, created lazily).
- **Adaptive quality (state machine driven with synthetic frame times, no timing noise):** fast frames, paused frames and isolated 0.1 s stalls never downgrade; sustained slowness steps down monotonically in 5 changes (1.5 → 1.25 → 1 → glow off → 0.75) and stops; 20 fast windows and borderline windows afterwards change nothing. **Recovery is not implemented** (one-way ratchet) — so it cannot oscillate, and also never recovers within a page load. Documented in the test name and `DEVICE-TEST.md`.
- **Context loss/restore:** see the fix above.
- Known, unverified: frame time is the signal, so a device capped at 30 fps by battery saver (33.3 ms > the 28 ms threshold) would be stepped down to the floor even if its GPU is idle (ESTIMATE from the code; `DEVICE-TEST.md` test 11 checks it).

## Gate 4 — gameplay quality (SIMULATED players, held-out seeds 90000+, never used for tuning)
Full table, 150 seeds per cell, win rate [Wilson 95% interval]:
| Bot | L1 | L2 | L3 | L4 | L5 | L6 | L7 | L8 | L9 | L10 |
|---|---|---|---|---|---|---|---|---|---|---|
| expert | 100% [98%–100%] | 100% [98%–100%] | 100% [98%–100%] | 100% [98%–100%] | 100% [98%–100%] | 100% [98%–100%] | 100% [98%–100%] | 100% [98%–100%] | 100% [98%–100%] | 100% [98%–100%] |
| good | 100% [98%–100%] | 100% [98%–100%] | 100% [98%–100%] | 100% [98%–100%] | 100% [98%–100%] | 100% [98%–100%] | 100% [98%–100%] | 96% [92%–98%] | 80% [73%–86%] | 35% [28%–43%] |
| casual | 100% [98%–100%] | 100% [98%–100%] | 100% [98%–100%] | 100% [98%–100%] | 99% [95%–100%] | 94% [89%–97%] | 81% [74%–86%] | 41% [34%–49%] | 4% [2%–8%] | 1% [0%–4%] |

Paired BEFORE (Phase 1 speeds 1.40/1.45/1.50/1.55) vs AFTER (shipped 1.36/1.38/1.42/1.46), same 400 seeds per cell:
| Bot / level | BEFORE win [95% CI] | AFTER win [95% CI] | diff | only-AFTER / only-BEFORE | sign-test p | lives lost Δ (±95%) |
|---|---|---|---|---|---|---|
| expert L7 | 100% [99%–100%] | 100% [99%–100%] | +0.0 pp | 0 / 0 | 1 | -0.02 ±0.02 |
| expert L8 | 100% [99%–100%] | 100% [99%–100%] | +0.0 pp | 0 / 0 | 1 | -0.05 ±0.03 |
| expert L9 | 100% [99%–100%] | 100% [99%–100%] | +0.0 pp | 0 / 0 | 1 | -0.10 ±0.06 |
| expert L10 | 100% [99%–100%] | 100% [99%–100%] | +0.0 pp | 0 / 0 | 1 | -0.16 ±0.06 |
| good L7 | 100% [99%–100%] | 100% [99%–100%] | +0.2 pp | 1 / 0 | 1 | -0.04 ±0.06 |
| good L8 | 99% [97%–100%] | 98% [96%–99%] | -0.8 pp | 4 / 7 | 0.549 | -0.12 ±0.07 |
| good L9 | 76% [72%–80%] | 82% [78%–85%] | +6.0 pp | 66 / 42 | 0.0264 | -0.07 ±0.06 |
| good L10 | 22% [19%–27%] | 35% [30%–40%] | +12.5 pp | 102 / 52 | 6.87e-05 | -0.13 ±0.06 |
| casual L7 | 73% [68%–77%] | 77% [73%–81%] | +4.2 pp | 79 / 62 | 0.178 | -0.06 ±0.07 |
| casual L8 | 37% [32%–42%] | 46% [42%–51%] | +9.5 pp | 98 / 60 | 0.00312 | -0.10 ±0.06 |
| casual L9 | 2% [1%–3%] | 3% [2%–5%] | +1.5 pp | 12 / 6 | 0.238 | -0.01 ±0.02 |
| casual L10 | 0% [0%–1%] | 0% [0%–1%] | +0.0 pp | 0 / 0 | 1 | +0.00 ±0.00 |

Integrity: `{'tableUnchangedAfterAllRuns': True, 'orderIndependentAndRepeatable': True}` — the level table is byte-identical before and after all runs, a BEFORE-first rerun is bit-identical to the AFTER-first run (no order dependence, no shared mutable state), and two separate full executions of `balance-ci.mjs` produced identical output (`diff` of the generated tables: identical).
Reading: the speed change helped where it was aimed — good bot L10 +12.5 pp (p≈7e-5), casual L8 +9.5 pp (p≈0.003), good L9 +6 pp (p≈0.03) — with no significant harm anywhere; other cells are within noise. **Level parameters were not changed in Phase 3.**
**Level 9 and Level 10 are flagged for human playtesting.** On held-out seeds the casual bot goes 81% (L7) → 41% (L8) → 4% (L9) → 1% (L10) in the full table, and even the good bot wins only ~35% of L10. Bots have no cascade look-ahead and aim at static spots, so these numbers say nothing reliable about real people in either direction.
Corrections to Phase 2 wording: "noise about ±10 pp at 12–24 seeds" was too optimistic (95% half-widths for mid-range rates are about ±26 pp at n=12 and ±19 pp at n=24); Phase 2's casual L8 figure 67% (n=12) is not supported — at n=150 it is 41% [34–49]; the "67% → 8%" cliff should read L7 81% → L8 41% → L9 4% → L10 1%.

### Is a 14 CSS-px marble legible? (the guard test is not enough)
The browser guard test only proves a geometric floor. Measured on the real renderer (`tests/legibility.mjs`, two archived runs, level 7): median marble diameter 16.4–16.5 px (360x640), 18.0 (390x844), 19.0 (412x915); minimum 15.4 px; neighbour spacing equals the diameter. ESTIMATE (1 CSS px = 1/160 in; 30 cm): 2.6–3.0 mm on screen, 30–35 arcmin; a 9 mm fingertip covers 3–3.5 marbles, so the target under the finger is hidden while aiming.
Rendered colour separation for normal vision stays ≥ 34 (CIE76). **But colour is the only identity cue** (no symbols/patterns). Under *simulated* colour-vision deficiency (Machado 2009, severity 1.0) the closest pairs fall to: protan blue/purple **1.3–13.3** (below 10 in 5 of 6 samples), deutan blue/purple 8.9–18.5 and red/orange 9.2–22, tritan closest pair 12.8 / 23.0 / 20.4 at the three sizes (second run only). Samples vary because the marbles on screen vary. These are model outputs, not people, and the decision threshold is unknown; ~8% of male players have a red-green deficiency, so this needs a human check and a product decision (a non-colour cue is a feature, not done here). Verdict: **14 px is not evidence of legibility; actual legibility is UNVERIFIED until people look at a phone.** No change made.

## Gate 5 — regression (final tree; exit codes)
| Command | Result | Exit |
|---|---|---|
| `npm test` | 41/41 | 0 |
| `node tests/browser.mjs` (stand-in engine; includes randomized race fuzz, 450 ops) | 114/114 (was 103; +11 diagnostics checks) | 0 |
| `REAL=1 node tests/browser.mjs` (real r160; race fuzz 160 ops, states reached 5 distinct) | 125/125 (was 114; +11) | 0 |
| `node tests/gfx-fallback.mjs` (real r160) | 20/20 | 0 |
| `node tests/bench.mjs 2` (render benchmark, relative only) | OLD env-on-all 627.7 ms vs NEW 228.1 ms = 36% (no env 27%); first run 657.1 → 252.0 = 38% | 0 |
| `node tests/balance.mjs 12` | table in `final-balance-12seeds.log` | 0 |
| `node tests/balance-ci.mjs 150 400` | integrity true/true, identical on rerun | 0 |
First attempts that failed and why (kept in `evidence-phase3/first-attempt-failures/`): (1) real suite 124/125 — the resize test counted an adaptive-quality step that landed inside the rotation window (probe: the extra calls came from `render.js` adaptive step); fixed by the `applySize` change and by isolating the test with `?adapt=0` and a stricter assertion (exactly 1). (2) gfx 18/20 — my warm-up did not render every power-icon kind (random seeds), so the texture plateau looked like growth although it stayed ≤ 6; fixed by deterministically tagging four marbles with each icon kind in the warm-up. No assertion was loosened. One process incident: a detached runner died overnight before its last four stages; those stages were rerun in full.

## Classification
**VERIFIED-AUTOMATED:** everything in the Gate 3 and Gate 5 sections; context loss/restore (emulated with `WEBGL_lose_context`); balance tables and their integrity; colour measurements.
**PHYSICAL-DEVICE:** none. No human has run `DEVICE-TEST.md`.
**ESTIMATES:** marble size in mm/arcmin; 30 Hz false-downgrade; fingertip occlusion; legibility judgement.
**UNVERIFIED:** FPS/thermals/touch feel/audio on phones; MSAA cost on weak GPUs; reflection-map build time on a real GPU; real context-loss behaviour on Android; offline/PWA install over HTTPS; the CDN fallback; human colour legibility including colour-vision deficiency; L9/L10 difficulty for real players.

## Remaining blockers
1. No physical-device results (the whole of `DEVICE-TEST.md`).
2. Colour-only marble identity with simulated CVD pairs well under the normal-vision margin — needs human CVD check and a decision.
3. L9/L10 difficulty needs human playtesting.
4. Adaptive quality never recovers and may over-react on a 30 fps-capped device (needs test 11).
5. Acceptance decision on `diag.js` / `?debug=1` (new, optional, off by default).
Nothing was pushed, deployed or published; no earlier ZIP was overwritten.
