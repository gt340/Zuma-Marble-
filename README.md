# 3D Zuma — rebuilt

A marble-shooter (Zuma-style) in Three.js: arc-length chain physics, authentic matching and cascades, 10 campaign levels + endless mode, power-ups, PWA shell.

## Run
```sh
sh fetch-three.sh          # optional: re-fetch/verify Three.js r160 (a verified copy is already committed in vendor/)
python3 -m http.server 8080  # any static server; service workers need http(s), not file://
# open http://localhost:8080/zuma3d-android.html
```
Three.js r160 is committed in `vendor/` (MIT, see `THIRD-PARTY-NOTICES.md`) and is what the game loads; the unpkg copy is only a fallback if that file cannot be fetched.

## Test
```sh
npm test                   # 63 headless tests: core rules (spec items 1-16), determinism, view framing, marble-mark drawing, adaptive-quality policy
node tests/browser.mjs     # Playwright/Chromium UI test using a Three.js STUB (fast, not real rendering)
REAL=1 node tests/browser.mjs   # same suite against the REAL vendor/three.module.js (software or hardware WebGL); uses the committed vendor copy
node tests/balance.mjs 12  # simulated-player balance table (12 seeded runs per level and profile)
node tests/sensitivity.mjs # which level parameter drives late-level difficulty
node tests/gfx-fallback.mjs   # Phase 3: URL-override fuzz, lowest-quality play, adaptive-quality wiring (ladder, revert, recovery, ceilings), WebGL context loss/restore (real r160 only)
node tests/balance-ci.mjs 150 400   # Phase 3: win rates with Wilson 95% intervals, paired before/after sign tests, contamination checks (SIMULATED players)
node tests/tune.mjs 24 7,8,9,10   # paired-seed before/after comparison of level tuning
node tests/bench.mjs 2     # render micro-benchmark (relative costs of dpr / MSAA / glow / reflection map)
node tests/marks.mjs       # Phase 4: real-pixel visibility + luminance-only identifiability of the marble symbols under simulated CVD, 6 viewports (real r160 only)
node tests/aimguide.mjs    # aim-guide accuracy: predicted vs actual insertion slot (static vs motion-lead)
node tests/calibrate.mjs   # simulated-player difficulty calibration
node audit/experiments.mjs audit/original/zuma3d-android.html   # reproduces the audit of the original game
```
Without `REAL=1` the browser test replaces Three.js with `tests/fixtures/three-stub.js` (UI/input/loop only). With `REAL=1` it drives the real renderer; the offline checks in section 13 run only in that mode.

## Accessibility and adaptive quality (Phase 4)
- **Marble symbols** (Settings → Marble symbols, default on; `?marks=0` for one visit): red +, green triangle, blue two bars, yellow ×, purple dot, orange ring, drawn as dark decals on the marble face and in the tray. Colours, collision, spacing and matching rules are unchanged; symbols are display-only.
- **Adaptive quality** (`quality.js`): steps down only after sustained overload, reverts steps that did not help (e.g. a 30 fps cap), recovers gradually after sustained headroom; `?dpr=` / `?halo=0` are ceilings, `?adapt=0` disables it. Limitation: a stable 30 Hz cap and a GPU that needs 25–33 ms per frame look the same from frame intervals alone, so the policy tests the effect of a step instead of guessing the cause. See PHASE4-REPORT.md.

## Controls
Drag/move to aim, release/click to shoot (or ←/→ to aim and Enter/↑ to fire), tap the marble tray or Space to swap, keys 1-4 for bomb/rainbow/slow/reverse, P/Esc to pause.

## Layout
`core.js` pure gameplay · `view.js` camera fit/aim maths · `render.js` Three.js scene · `main.js` UI/loop · `audio.js` · `storage.js` · `sw.js` · `AUDIT.md` Phase-1 audit · `REPORT.md` build report · `VALIDATION.md` real-renderer gate · `RELEASE-AUDIT.md` final readiness audit · `DEVICE-TEST.md` physical-device protocol (not yet run) · `PHASE2-REPORT.md` mobile optimisation report.
Graphics URL overrides for device A/B tests: `?aa=0 ?dpr=1.5 ?halo=0 ?env=0 ?adapt=0`. `?debug=1` shows an on-device diagnostics panel (`diag.js`: frame times, input-to-frame delay, quality, GPU counts, errors, 30-second snapshots, Save/Copy JSON report) and opens all levels in the grid for that page load; it is off unless requested. See `DEVICE-TEST.md`.
