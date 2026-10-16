# Phase 2 — Mobile gameplay optimisation (report; not released)

Base artifact: `3d-zuma-v2.zip`, sha256 `0631306b3aa63c13bade5a52274b7d9e89eadcc70ae76c3133db342999d57a9d` (verified before any change, left untouched; backup copy kept).
Legend: **MEASURED** = produced by a command in this environment (desktop Chromium, software WebGL; relative ratios only, absolute ms mean nothing for phones). **ESTIMATE** = reasoning, not measured. **UNVERIFIED** = needs a physical device.

## Baseline (before)
38 unit, 103 stand-in browser, 107 real-engine browser checks: all pass (exit 0). Responsible files: rendering quality `render.js`; marble size/camera `view.js` (+ `render.js` `applyView`); HUD `zuma3d-android.html`, `main.js`; audio `audio.js`; level difficulty `core.js` (table `T`).

## Gate 2 — rendering (MEASURED, 360x640 @DPR2, level 10, 59 marbles, relative frame time)
| Option | Frame time vs baseline |
|---|---|
| pixel ratio cap 1.75 -> 1.5 / 1.25 / 1.0 | 78% / 63% / 49% (cost tracks pixel count) |
| MSAA off | 87% |
| glow (halo) pass off | 99% (negligible) |
| reflection map applied to every standard material -> only marbles + metals | **44%** (733 -> 325 ms; no map at all = 32%) |
Findings -> changes (all in `render.js`, reversible via options):
1. Reflection map is sampled only by materials that need it (marbles, bomb/rainbow shooter, gold/edge metals, jewel). `opts.envScope:'all'` restores the old behaviour. Visual difference: ground ~2% darker (mean abs pixel diff 5.9/255, `tests/evidence-phase2/env-scope-before-after.png`).
2. The map is generated after the first rendered frame instead of during start-up. App time-to-menu (software GL, 3 runs): OLD 4.3-6.2 s -> NEW 1.0-2.3 s. Whole-app frame rate at level 7: OLD 1.3-1.8 fps -> NEW 3.5-3.8 fps (software GL; an upper bound on nothing).
3. Adaptive quality: ignores paused frames (previous gate), skips no-op cap steps on DPR-1 screens, order now resolution -> glow -> a last-resort 0.75 pixel ratio (up to 6 steps) because resolution is the lever that measurably works.
4. MSAA: **not changed** (13% in software GL; cannot be toggled at runtime; visual quality). New opt-in override `?aa=0` for device A/B tests.
5. Geometry/material reuse, disposal, resize: reviewed; tests show live GPU objects constant across 15 rapid restarts and a ~3-minute sustained endless run (heap 7.7 -> 9.3 MB, geometries 36, textures 2, shader programs 15 constant after warm-up; programs rose from 12 to 15 because marble and non-marble materials now compile separate variants), `setSize` never called while idle and <= 2 times per orientation change.
6. Added tools: `gfx.setQuality()`, `gfx.ensureEnv()`, URL overrides (`?aa ?dpr ?halo ?env ?adapt`), `tests/bench.mjs`.

## Gate 3 — portrait readability (MEASURED)
- Marble on-screen diameter at centre: 360x640 15.8 -> 16.6 px, 390x844 17.2 -> 18.1 px, 412x915 18.1 -> 19.1 px (4.4% -> 4.6% of width). Change: camera footprint padding 1.1 -> 0.85 world units (marble radius 0.48 + glow 0.15 = 0.63) and side margin 0.94 -> 0.965. Marble radius, spacing, collision and chain logic untouched. A larger gain is not possible without cropping the width-bound spiral or changing path geometry (not done).
- Colour separation, rendered pixels at 360x640 (CIE76 dE between closest marble colours): yellow/orange 23.4 -> 37-39 by re-spacing yellow `#ffd23a -> #ffe03a` and orange `#ff8a2a -> #ff6a1a` (other four unchanged; blue/purple 43, red/orange ~41). DOM tray/rainbow-icon colours updated to match.
- HUD, aim guide, power buttons, danger label, touch targets (>= 44 px) re-checked at 360/390/412 portrait and 3 landscape sizes: all layout checks pass.
- Regression tests added: view test 18 (marble edge + glow stays on screen for every path/size), `COLOR_CSS == COLOR_HEX`, browser: marble diameter >= 14 css px at 7 viewports, real-pixel colour-separation dE >= 33 (measured 37.0), graphics-override honoured / garbage ignored, resize churn, adaptive quality.

## Gate 4 — late-level balance (SIMULATED players, never humans)
Before running anything I ran the existing scripts. Defect found in my own scripts: they mutated the shared surge object of the level table, tainting later variants (`sensitivity-before-TAINTED.txt`); fixed, rerun (`sensitivity-fixed.txt`).
Sensitivity (16 seeds, casual bot, win%): L8 base 25% -> speed x0.9 75%, x0.8 94%, no surge 63%, one colour less 75%; L9 base 6% -> only "no surge" moves it (31%); L10 0% under every single change. Good bot L10: base 19% -> speed x0.9 63%, x0.8 75%, no surge 56%. **Speed is the dominant lever, surge strength second, colour count third, power-up frequency weak/inconsistent.**
Smallest adjustment shipped (`core.js` table only): campaign speed L7-L10 from 1.40/1.45/1.50/1.55 to 1.36/1.38/1.42/1.46 (smooth ramp 1.35 -> 1.36 -> 1.38 -> 1.42 -> 1.46; the existing strictly-increasing test is kept). Marble totals, colours, clump, surges, powers unchanged.
Paired seeds, 24 per cell (`tune-late-levels-paired.txt`), win% / lives lost per run:
| | L7 | L8 | L9 | L10 |
|---|---|---|---|---|
| good before | 100/1.1 | 100/1.5 | 75/2.2 | 21/2.8 |
| good after | 100/1.3 | 100/1.3 | 75/2.2 | 38/2.6 |
| casual before | 63/2.3 | 25/2.7 | 0/3.0 | 0/3.0 |
| casual after | 67/2.2 | 42/2.6 | 4/3.0 | 0/3.0 |
Full table, 12 seeds (`balance-after.txt` vs `balance-before.txt`): expert 100% all levels, lives lost at L9/L10 0.50/0.50 -> 0.25/0.50; good L10 17% -> 42%; casual L8 33% -> 67%, L9 8% -> 8%, L10 0%.
Remaining: the casual bot still falls off a cliff at L9 (67% -> 8%) and cannot beat L10; this is left as meaningful challenge, not tuned further. Statistical noise at 12-24 seeds is about +-10 percentage points. Bots have no cascade lookahead and aim at static positions.
Guard test added: L10 speed >= 1.5x L1, L8-10 speed within 1.35-1.5, totals/colours never shrink, L7-10 keep surge >= 1.8x.

## Gate 5 — regression safety
See report for commands/counts. Randomized state-transition test (450 operations stub, 160 real) passes; resource behaviour above.

## Remaining risks
Physical-device FPS/thermal/touch/audio unverified; MSAA cost on weak GPUs untested; ~2% darker ground; yellow/orange now closer to red/orange in hue than before (rendered red/orange dE ~41, no pair below 37); L9-L10 difficulty for casual players unknown; reflection map build time on real GPUs unknown (`gfx.envBuildMs`); 3 extra shader programs compiled; CDN fallback still unverified.
