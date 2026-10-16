# Validation Gate Report (real-renderer gate)

**Verdict: PARTIAL.** The real Three.js r160 renderer runs and passes the automated suite in headless Chromium with *software* WebGL (SwiftShader). No physical device, no GPU, no human players, no real CDN, no audible-audio check.

## 1. Commands executed
```
git clone --depth 1 --branch r160 https://github.com/mrdoob/three.js.git   # npm, unpkg, jsdelivr, pip were unreachable (org egress policy); github.com git worked
sh fetch-three.sh            # re-run in the package: unpkg failed -> script's new github-tag fallback succeeded, verified REVISION '160'
node /home/claude/v/gate1.mjs                       # static check: imports, manifest, sw file list, html refs, doc file references
npm test                                            # 35/35
node tests/browser.mjs                              # stub engine: 85/85
REAL=1 node tests/browser.mjs                       # real three.module.js r160: 87/87
node tests/balance.mjs 12 ; node tests/sensitivity.mjs 16 7,8,10
(ad-hoc scripts: WebGL probe, fps probe, mid-game screenshots, 6-minute sustained endless run)
```
Chromium 141 (`--use-angle=swiftshader --use-gl=angle --enable-unsafe-swiftshader`), Playwright from /opt/npm-tools, Node 22.

## 2. Three.js version and source
`vendor/three.module.js`, `REVISION = '160'`, 1,272,972 bytes, taken from the official GitHub tag r160 (commit d04539a7…), served locally. Not verified identical to the unpkg npm artifact (unpkg unreachable). The CDN fallback path was only exercised with the CDN **simulated** (route to the local file).

## 3. Real-renderer results
WebGL2 context on SwiftShader; scene initialises; screenshots confirm track, edge rails, gate posts, frog, skull, marble chain, aim guide, HUD, particles/rings. Verified automatically against the real engine: boot with one canvas and one render loop, no console/page errors or failed requests, touch aim+fire (exactly one shot), pointercancel does not shoot, swap, pause/resume, bot playthrough to level-complete, game over, restart, endless auto-wave, settings persistence, blocked storage, engine-load failure -> error screen.
GPU objects (renderer.info): after a restart 0 growth in geometries+textures and programs; after 15 rapid restarts -4 geometries, 0 programs. Sustained endless run (~3 sim-minutes, 6 chunks): JS heap 7.7 -> 9.0 MB (flat after warm-up), geometries 36, textures 2, programs 12 constant; game logic ~1 ms CPU per simulated second.
Software rendering ran at only ~4 fps (390x844, DPR1) and ~1.5 fps at 1280x720 — **this says nothing about real mobile GPUs**; frame rate on devices is unmeasured.

## 4. Responsive and input
Viewports 360x640, 390x844, 412x915, 640x360, 844x390, 915x412 and 960x540 (Chromium touch *emulation*, not a physical Android device): HUD inside viewport, touch targets >= 44 px, no horizontal overflow, top/bottom bars do not overlap, and the whole track footprint lies between the HUD bars (new test, real pixels). Audio: no AudioContext before a gesture; after a real (CDP) touch the context exists and is `running`; shooting creates oscillator/noise voices. Actual sound output is **not** verified (no audio device).
Not tested: physical Android devices, real multi-touch, gesture interruptions by the OS (calls, app switch) beyond pointercancel/visibilitychange logic.

## 5. Gameplay balance (SIMULATED players, 12 seeded runs per level; not human playtesters)
Table after the speed retune (`tests/balance-results.json`; before: `tests/balance-before-speed-retune.json`).
| lvl | expert win | good win | casual win | casual lives lost | casual survive s | casual score | casual cascade share |
|---|---|---|---|---|---|---|---|
| 1 | 100% | 100% | 100% | 0.00 | 33 | 3250 | 13% |
| 2 | 100% | 100% | 100% | 0.33 | 45 | 3367 | 10% |
| 3 | 100% | 100% | 100% | 0.17 | 50 | 3531 | 9% |
| 4 | 100% | 100% | 100% | 0.92 | 69 | 3772 | 3% |
| 5 | 100% | 100% | 100% | 1.50 | 77 | 3629 | 6% |
| 6 | 100% | 100% | 92% | 2.00 | 86 | 3552 | 5% |
| 7 | 100% | 100% | 83% | 2.08 | 94 | 3610 | 5% |
| 8 | 100% | 100% | 33% | 2.67 | 99 | 2838 | 4% |
| 9 | 100% | 83% | 8% | 2.92 | 94 | 2270 | 5% |
| 10 | 100% | 17% | 0% | 3.00 | 90 | 1888 | 3% |
Cascades per run: expert 3-6, good 2-3, casual 1-2.6. Sharpest spikes: casual 83% -> 33% from L7 to L8; "good" 83% -> 17% from L9 to L10.
Investigation (`tests/sensitivity.mjs`, one parameter at a time): **belt speed is the dominant lever** (casual L8: 25% -> 44% at x0.9, 63% at x0.8; good L10: 6% -> 44% / 81%), surge strength and colour count are secondary, power-up frequency minor. Targeted fix, not a blanket nerf: L7-L10 speed 1.45/1.55/1.65/1.75 -> 1.40/1.45/1.50/1.55 and L9/L10 surge multiplier 1.9/2.0 -> 1.8/1.9. Expert still loses lives on L9-10 (0.5/run). Casual L8 moved 17% -> 33%, L9 0% -> 8%, good L9 50% -> 83%, good L10 8% -> 17%. The late game is still hard for the casual bot; whether that matches real casual players is unknown and needs human playtests. The bots are heuristics with no cascade lookahead; absolute numbers are indicative only.

## 6. Console and network errors
Real-engine run: zero page errors, zero console errors, zero failed or >=400 requests in all online tests. Only expected failures: offline stale-while-revalidate refetches (ignored in the offline test by design) and the deliberately induced engine-load failures. Chromium's own background connections to google domains were refused by the sandbox proxy (not the app).

## 7. Offline (three layers, separately)
- App shell: cached by the service worker (all 10 core files); loads offline — verified (stub and real).
- Engine: offline startup works **only if** `vendor/three.module.js` exists (`sh fetch-three.sh`) and the SW has installed — verified with the real file (offline boot, level starts).
- CDN fallback: simulated only. Real unpkg unreachable. On first visit the CDN module is fetched before the SW controls the page, so it is cached only from the second online visit; **not verified**. Without the vendor file and without network the game shows the explanatory error screen (verified).
Offline gameplay is therefore claimed only for the vendored-engine setup.

## 8. Defects found and fixed in this gate
1. Landscape camera framing ignored the HUD: track ran under the top bar and swap tray (visible only in real pixels). Fix: fit uses measured HUD edges (`hudSafe()` in main.js, `resize(w,h,safe)` in render.js), plus a real-pixel footprint test on 7 viewports.
2. Adaptive quality was diluted by paused frames (dt=0) and reacted after 150 frames; now counts only live frames, window 45.
3. Service worker was registered only after the engine loaded, so an engine failure left no cached shell; now registered first. SW VERSION bumped to 2.0.1.
4. `fetch-three.sh` had a single point of failure; added the GitHub-tag fallback and an r160 check.
5. Late-level difficulty spike: targeted speed/surge retune (section 5).
6. Test fixes (not product bugs): GPU-object counting now uses live counts (stub) / renderer.info (real); shot-rate test uses game time; resize test waits for the reframe; offline requestfailed noise filtered.
Earlier-visible limitation, not fixed: "GO!" and combo banners can overlap each other briefly; portrait marbles remain small.

## 9. Not verified
Physical Android/iOS devices, real GPU frame rate and thermals, audible audio and iOS audio unlock, real CDN fetch/caching, human playtesting, PWA install flow, npm-vs-GitHub r160 byte equality. Nothing was deployed or pushed.
