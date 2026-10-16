# Final release-readiness audit

**Verdict: PARTIAL** — suitable for physical-device testing; not release-validated. All automated evidence passes; there is no physical-device, real-GPU, human-playtest, real-CDN or audible-audio evidence.

## 1. Artifact integrity
`3d-zuma-v2.zip` verified with `unzip -tq` (exit 0), extracted into an empty directory and run from there (see commands/exit codes in the report). Contains the runnable game, vendored `three.module.js` (REVISION '160', checked by `fetch-three.sh` and noted in VALIDATION.md), tests, fixtures, balance data, real-renderer screenshots (`tests/screenshots/real/`) and result files (`tests/browser-results-real.json`, `-stub.json`, `tests/balance-results.json`, `tests/aimguide-results.txt`). Static check: all imports, manifest icons/start_url, service-worker file list, HTML references and file names mentioned in README/REPORT resolve.

## 2. Gameplay defects reviewed
| Issue | Verdict | Evidence | Action |
|---|---|---|---|
| GO banner / combo overlap | CONFIRMED (landscape: banner overlapped combo and danger label; portrait: combo overlapped danger label) | new layout test on 7 viewports failed 7/7 before | Fixed: stacked positions (combo 70 px, danger 118 px, banner >= 170 px below the safe top). Test passes 7/7. |
| Small marbles in portrait | CONFIRMED as a design limit, not a bug | measured 15.8-18.1 px diameter = 4.4% of width in portrait (width-bound spiral) | Not changed (enlarging would crop the track or change path geometry). Floor-guard test (>= 12 px). Needs device legibility judgement. |
| Levels 8-10 difficulty | Re-measured; retuned in previous gate | `tests/balance-results.json`: expert 100% all levels; good 100% to L8, 83% L9, 17% L10; casual 33% L8, 8% L9, 0% L10 (simulated bots only) | No further change; human playtests required. |
| Aim guide ignored chain motion | CONFIRMED: guide named the wrong insertion slot in 27-89% of sampled shots (worst during the fast opening roll-in) | `tests/aimguide.mjs`: static 11-73% exact; with lead 98-100% (n = 18-112 clean samples per level) | Fixed: `predict()` now leads moving marbles (fixed-point on flight time, same velocity model as the simulation via shared `_segmentVel`). Bots keep static prediction so balance data is byte-identical (verified). 3 regression tests added. Limit: exact only while the chain is not re-indexed by matches during flight; shots into a chain that is mid-roll-back are not covered by the sample. |
| Restart/pause/game-over/level-transition races | NOT confirmed | Code review (all UI delays are session-token guarded; pause blocked in complete/over) + 450-operation randomized fuzz in the browser, covering intro, playing, paused, complete, game-over and the complete/over screens: no inconsistent screens, invariants hold, one loop/canvas, no errors | No fix needed; fuzz kept as regression test. Real-renderer fuzz runs 160 ops (software WebGL is slow). |

## 3. Mobile performance readiness
MEASURED (desktop, real renderer, SwiftShader): level 10, 390x844, DPR 1.75 -> 65 draw calls, ~30k triangles with 26 marbles, 36 geometries, 4 textures, 12 shader programs; heap flat (7.7 -> 9.0 MB) and GPU objects constant over ~3 simulated minutes; adaptive quality dropped the halo pass and the resolution cap within 9 s on the slow software renderer; game logic ~1 ms CPU per simulated second.
CHANGED (precaution, effect on devices unmeasured): marble sphere 22x16 -> 18x12 segments (marbles are ~16-35 px on screen); adaptive quality now skips resolution steps that would not change the real pixel ratio (DPR-1 screens previously wasted three steps), and ignores paused frames.
ESTIMATES (not measured on any phone): worst-case chain of 180 marbles ~ 180 x (432 + 192 halo) triangles ~ 110k plus ~30k scene; likely bottlenecks on entry-level Android are fill-rate (4x MSAA is enabled and cannot be changed at runtime; DPR up to 1.75), ACES tone mapping + fog + additive halo overdraw, and PMREM generation at start-up. Mitigations present: DPR cap, adaptive downgrade, instancing, pooled effects. Not present: runtime MSAA toggle, a user-selectable quality setting.
Reproducible device procedure: `DEVICE-TEST.md` (FPS, touch latency, heat, memory, audio, orientation, sustained play, offline). No results exist yet.

## 4. Delivery and offline
- Local engine: `vendor/three.module.js` included; `fetch-three.sh` tries unpkg then the GitHub tag and rejects anything that is not REVISION '160'.
- After the first successful online load of the vendored setup: the service worker (v2.0.2) has cached the shell (10 files) and the engine; reloading and starting a level offline were verified (real engine, Chromium offline emulation, same origin on localhost).
- Without the vendored file and without network: the shell loads from cache and shows the explanatory error screen (verified). The service worker is registered before the engine loads, so the shell is cached even if the engine failed.
- Real CDN fallback: NOT verified (unpkg unreachable here); only a simulated CDN response was tested. A CDN-loaded engine is cached only from the second online visit.
- Not verified: behaviour on a real phone, Chrome's storage eviction under pressure, install-to-home-screen flow, `https` origin differences.

## 5. Remaining risks
No physical-device FPS/thermal/memory/touch data; marble legibility on small screens; late-level difficulty unvalidated by humans; MSAA fill-rate cost on weak GPUs; audio output unverified; CDN path unverified; npm-vs-GitHub r160 byte equality unverified.
