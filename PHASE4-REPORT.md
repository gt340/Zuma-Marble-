# Phase 4 report — marble symbols, adaptive quality, diagnostics audit

Input: `3d-zuma-v2-phase3-candidate.zip` (sha256 `09fccb3d…e6555930`, verified before any change). Nothing was pushed, deployed or published; the Phase 3 ZIP and all earlier backups are untouched.
Evidence labels: **MEASURED** = produced by a command in this folder (software WebGL / synthetic input, never a phone). **MODEL** = simulated colour vision or synthetic frame times. **NOT VERIFIED** = needs a person and a phone. No physical-device testing was done in this phase.

## What changed

| File | Change |
|---|---|
| `render.js` | Marble marks (6 instanced decal layers + shooter/shot decals, camera-facing, no shader changes). Adaptive quality now driven by `quality.js`; ladder built from overrides; `frame(game, dt, aim, rawMs)`; `gfx.quality` exposes level/reverts/capSuspected; `setMarks()`. |
| `quality.js` (new) | Pure adaptive-quality controller (hysteresis, cooldown, benefit test with revert, back-off, gradual recovery). |
| `main.js`, `storage.js`, `zuma3d-android.html` | `marks` setting (default on) + Settings switch, `?marks=0`, tray glyphs via CSS, raw frame interval passed to the renderer, log lines `[zuma] quality down/up/revert`. |
| `diag.js` | Report `page` is now path + whitelisted graphics flags only; site address stripped from captured errors; plain-language `privacy` field. |
| `sw.js` | Precaches `quality.js`; cache `zuma3d-v2.0.5`. |
| tests | new `marks.test.mjs`, `quality.test.mjs`, `marks.mjs`, `marks-sheet.py`, `quality-compare.mjs`; extended `browser.mjs` (sections 19, 20, SW offline `?debug=1`), `gfx-fallback.mjs` (section C rewritten, mark texture re-upload after context restore). |
| **unchanged (byte-identical to Phase 3)** | `core.js` (rules, collision radii, chain spacing, insertion, matching, all level parameters incl. levels 9–10), `view.js`, `audio.js`. |

## Gate 1 — baseline (pristine Phase 3 tree, before editing)
`npm test` 41/41 exit 0 · `node tests/browser.mjs` 114/114 exit 0 · `REAL=1 node tests/browser.mjs` 125/125 exit 0 · `node tests/gfx-fallback.mjs` 20/20 exit 0 · `bench.mjs 2` exit 0 (logs: `baseline-phase3-*.log`).

## Gate 2 — marble identification (MEASURED on real r160 pixels, software GL; colour vision is MODEL)
Design: one dark glyph per marble type, drawn as a flat decal facing the camera on the marble's visible face: red **+**, green **triangle**, blue **two bars**, yellow **×**, purple **dot**, orange **ring**. Palette, radii, spacing, insertion physics and matching rules untouched (`core.js` byte-identical; all 63 unit tests pass). Token marbles (bomb, rainbow, etc.) keep their icon and get no symbol. Settings → "Marble symbols" toggles them (saved); `?marks=0` for one visit.

`tests/marks.mjs`, 6 viewports (360×640, 390×844, 412×915 portrait and 640×360, 844×390, 915×412 landscape), each under normal / protanopia / deuteranopia / tritanopia simulation (Machado 2009), ~45 marbles per view:

| Check | Threshold (fixed before the final runs, not relaxed) | Result |
|---|---|---|
| Every marble's symbol changes luminance by ≥ 20 L\* | ≥ 20 | min **45.5 – 53.0** across views/modes |
| Marble type recovered from luminance structure alone (hue discarded, shading removed, ±1 px shift, leave-one-out) | ≥ 90 % | **95 – 100 %** (final run; four repeat runs of the final glyph set: 91–100 %) |
| Control, symbols off, same classifier | ≤ 50 % | **≤ 30 %** |
| Cost (real renderer) | — | +7 draw calls, +≈100 triangles, +6 textures of 64 px (≈130 KB) |

Contact sheets `marks-sheet-390x844.png`, `marks-sheet-844x390.png` (on/off × normal/protan/deutan) and raw screenshots are in `tests/evidence-phase4/`. Diameter of the smallest simulated marble is 12.7 CSS px (640×360); the symbols remain separable there but with the least margin.
Regression tests: `tests/marks.test.mjs` (6 unit), browser sections 19 (default on, tray glyph, Settings toggle persists across reload, `?marks=0` does not change the saved setting, draw-call overhead) and a check that mark textures survive WebGL context restore.
How the design got there (honest history, logs in `first-attempt-failures/`): a flat decal on the top of each sphere floated and was foreshortened in landscape → switched to camera-facing; early identification numbers were wrong because my crop size varied per marble and because the chain's first marbles are hidden by entrance scenery (now excluded by position, documented); a square and a diamond were confused with the triangle/plus at 9–11 px → replaced by ×.

Limits: + and × are the closest pair for a human at small size (the classifier separates them; a person may not, see DEVICE-TEST test 13). The classifier and the CVD matrices are models. Nobody with colour-vision deficiency has seen this.

## Gate 3 — adaptive quality (MEASURED with synthetic frame intervals and the real renderer; devices NOT VERIFIED)
Finding from Phase 3 confirmed: the old policy was a one-way ratchet (45-frame mean > 28 ms ⇒ step, max 6, never back) and fully degraded a stable 30 fps cap.
What is and is not detectable: a stable 30 Hz cap and a GPU needing 25–33 ms per frame on a 60 Hz display give identical frame intervals. **Reliable cap detection from intervals is impossible**; the policy tests the effect of a step instead (`quality.js` header explains it): overload = 2 consecutive slow 2 s windows (trimmed mean > 28 ms) → one step down; the step must cut the frame time ≥ 6 % or end under 28 ms, otherwise it is **reverted**, downgrades are locked out with back-off, and after 3 fruitless probes the session is treated as cap-limited. Recovery needs 5 consecutive windows under 20 ms (10 s), goes one rung at a time and is reverted at once if not affordable (own back-off). Dead band 20–28 ms, 1 s settle after every change, stalls > 250 ms ignored (but ≥ 4 in a row are treated as a really slow device), paused frames break the window. `?dpr=` / `?halo=0` set the ladder's top (ceilings); `?adapt=0` and any explicit `setQuality()` switch it off. Ladder: DPR caps → 0.75× with no glow (the glow pass alone costs ≈1 %, a standalone step would always fail the benefit test).

Synthetic before/after (`tests/quality-compare.txt`, 10 simulated minutes, 5 rungs):

| Profile | Old: final rung / % time below full | New: final rung / % time below full |
|---|---|---|
| Fast 60 Hz, 120 Hz | 0 / 0 % | 0 / 0 % |
| **Stable 30 fps cap** | 4 / **99.8 %** | **0 / 1.5 %** (3 probes, all reverted, then stops) |
| Overloaded, cost falls with quality | 4 / 99.5 % | 4 / 99.3 % (same, correct) |
| Vsync-quantised overload | 4 / 99.6 % | 1 / 99.3 % (keeps the one step that helped) |
| 6 s transient burst | 3 / 99.7 % | 0 / 2.2 % (recovered) |
| 2-minute thermal-style load then easy | 2 / 89.7 % | 0 / 22.7 % (recovered step by step) |
| Unstable 3 s smooth / 1 s heavy | 2 / 99.3 % | 0 / 0 % (trimmed mean stays under the threshold; the heavy second is accepted) |

Tests: `tests/quality.test.mjs` (16 unit tests: 60/120 Hz, overload, cap, vsync, unstable, hitches, stalls, <4 fps device, pauses, recovery, unaffordable recovery with back-off, dead band, one-rung ladder, determinism); `gfx-fallback.mjs` section C on the real renderer (ladder, revert on constant 40 ms, exactly one drawing-buffer reallocation per change, step-wise recovery to the ceiling, no geometry/texture growth, ceilings from `?dpr=1.25&halo=0`, `?adapt=0`, `setQuality` stops adaptation); `browser.mjs` section 15 (slow SwiftShader steps down and keeps the step). No second render loop is created (one loop/one canvas asserted throughout).
Known costs: up to three short quality dips (~6 s each) on a 30 Hz-capped phone; a device both capped and genuinely over budget cannot be told apart and stays at full quality (conservative by design); a downgrade that helps by < 6 % is reverted.

## Gate 4 — diagnostics audit → **kept** (`diag.js`, `?debug=1`)
| Requirement | Evidence |
|---|---|
| Disabled by default | Section 18: no panel, `diag.js` not even requested, `__zuma.diag === null` without `?debug=1` |
| Only useful, non-sensitive data | Report = device/browser identifiers, GL renderer string, frame stats, quality state, battery %, game state, error text. **Fixed this phase**: `page` was the full URL (query, fragment, host); now path + whitelisted flags (`aa dpr halo env adapt marks debug`); site address removed from captured errors; `privacy` field states what is inside. Test feeds `?secret=…&token=…#frag` and asserts none appear. The GL renderer string and user agent still identify the device model — they are the point of the report; Copy/Save are manual, nothing is uploaded. |
| No network / storage | Static test: no `fetch/XHR/sendBeacon/WebSocket/localStorage/sessionStorage/indexedDB/cookie` in the module; runtime test: no request leaves the origin |
| Saved progress not touched | Save string byte-identical before/after a diagnostics session including Reset; debug unlocking of the level grid is display-only (existing check) |
| No second loop | no `requestAnimationFrame` in module (static) + one loop/one canvas across pause, restart, rotation |
| Pause/restart/rotation/offline | paused frames not counted; panel stays inside the viewport after rotation; `?debug=1` boots offline from the precache (`diag.js` and `quality.js` now in the SW core list) |

## Gate 5 — final regression on the Phase 4 tree (all exit 0; logs `final-*.log`)
| Command | Before (Phase 3) | After (Phase 4) |
|---|---|---|
| `npm test` | 41/41 | **63/63** (+6 marks, +16 quality) |
| `node tests/browser.mjs` (stub) | 114/114 | **132/132** |
| `REAL=1 node tests/browser.mjs` | 125/125 | **144/144** (includes the randomized state-transition fuzz, unchanged) |
| `node tests/gfx-fallback.mjs` | 20/20 | **27/27** |
| `node tests/marks.mjs` | — | **all 72 checks pass** |
| `node tests/bench.mjs 2` | NEW env 272.5 ms (38–42 % of OLD) | NEW env 243.9 ms (38 %); +7 draw calls (276 → 283) and +38 triangles in the bench scene (the symbols). SwiftShader, relative only; run-to-run noise is larger than the difference |
| `node tests/balance.mjs 12` | — | **byte-identical table to Phase 3** (diff empty) |
| `node tests/balance-ci.mjs 150 400` | — | **JSON identical to Phase 3**; level table integrity true |

Two stale expectations were changed because the thing they measured changed, not to get green: (1) texture plateau bound 6 → 12 (6 mark textures, plateau still flat across repeated cycles); (2) the context-restore reflection check and the colour-separation check read the marble's centre pixel, which now holds the dark symbol, so those two tests switch symbols off while measuring (symbols have their own tests). Both negative controls still fail when they should (mean ΔE 16.1 vs limit 6).

## Not verified / still open
Everything above ran on software WebGL in headless Chromium and on synthetic input. Not verified: real phone frame rates, heat, battery, whether the symbols help (or bother) anyone with colour-vision deficiency, the real behaviour of the adaptive policy on a 30 Hz-capped phone, touch feel, audio. Phase 3's five release blockers are unchanged except that blocker 4 (adaptive quality never recovers / over-reacts on a 30 fps cap) is addressed in logic and synthetic tests but still needs DEVICE-TEST test 11; test 13 (symbols) is new. Verdict: **still not shown release-ready; no physical-device data.**

Stopped for commander approval.
