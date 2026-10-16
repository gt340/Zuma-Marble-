# Commander Report — 3D Zuma rebuild (see VALIDATION.md for the later real-renderer gate; counts below are from the first build)

## 1. Root causes (full evidence in AUDIT.md, reproducible via `audit/`)
The original positioned marbles by independent array-index timers/`setTimeout` and per-marble offsets rather than a single arc-length model, so spacing, gap-closing, insertion side, roll-back and life-loss each had separate ad-hoc code paths that raced one another (duplicate life loss, stale indices after async removals, restart not cancelling timers). Details and per-issue corrections are in AUDIT.md.

## 2. Features delivered
Arc-length chain with constant spacing, gap closing, roll-back on matching joins, cascades with combo scoring; swept-circle insertion; trajectory guide; swap; bomb / rainbow / slow / reverse (charges earned from embedded tokens); danger warning and controlled life-loss/devour/respawn; 10 campaign levels + endless waves; menu, level select, how-to, settings, pause/resume, game-over and level-complete stats; persisted progress/settings; instanced rendering with effects, camera framing for portrait and landscape; synthesized audio.

## 3. Files
`core.js view.js render.js main.js audio.js storage.js sw.js manifest.json zuma3d-android.html fetch-three.sh package.json` · docs `README.md AUDIT.md REPORT.md` · `tests/` · `audit/`.

## 4. Architecture changes
Pure deterministic `core.js` (seeded RNG, fixed 1/120 s step, no timers) separated from rendering (`render.js`), camera maths (`view.js`) and UI (`main.js`). Events drain from core to FX/sound. One rAF loop; explicit state machine; dispose-on-restart.

## 5. Tests and exact results
- `npm test`: **35/35 pass** (core rules for spec items 1–16, determinism, no-tunnel at several step sizes, bots completing L1–2, camera fit over 9 viewports × 5 paths).
- `node tests/browser.mjs`: **64/64 pass** in headless Chromium **with a Three.js stub** (boot, one canvas/loop, 5 layouts incl. 360×640, touch targets ≥44 px, resize, touch aim/shoot and rate limit, pause, bot playthrough to level complete, game over, restart without live GPU-object growth, 15 rapid restarts, endless, settings persistence, blocked storage, service-worker offline of the shell, Three.js load failure → error screen). Bugs found and fixed by this run: boot crash when storage access throws; HUD overflow at 360 px; tray/power button sizing.
- Difficulty calibration (simulated players, 6 seeds): expert wins all 10 levels; "human" profile wins L1–6, 50% L7, 17% L8, 0% L9–10; "slow" wins L1–5.
- NOT RUN: any test against real Three.js/WebGL; any physical-device test; any human playtest; Lighthouse/PWA install audit.

## 6. Known defects and unverified behaviour
- **The 3D scene has never been rendered with real Three.js here** (npm/CDN blocked in this sandbox). `render.js` is written against the r160 API and exercised only against a strict stub. Expect possible visual issues on first real run.
- Offline play is verified for the app shell only; the real Three.js file (via `fetch-three.sh`) or CDN fallback is untested.
- Aim guide ignores chain motion during flight (exact for a static chain only).
- Difficulty tuned by bots only; L8–10 may be too hard for casual players.
- Portrait camera is far (marbles small on phones).
- Audio is untested on real devices (iOS unlock not verified).

## 7. Mobile performance
Not measured on a device. Design choices: InstancedMesh (cap 180), pooled particles/projectiles, adaptive DPR cap and halo toggle. Treat as unverified.

## 8. Run/test instructions
See README.md.

## 9. Commit / deploy
See the final message for the verified repo URL and commit. Nothing is deployed to production.
