# 3D Zuma V2 — Android device test (STATUS: NOT YET PERFORMED — no physical-device results exist)

This is a procedure for a person holding a real Android phone. Nothing in this file is a measured result. Every number the automated suite produced (frame times, GPU counts) came from headless Chromium with *software* WebGL on a server and says nothing about phones.
Time needed: about 90 minutes for everything (the core session is 10 minutes). Do tests 1–5 first; they decide whether the rest is worth running.

What you can and cannot measure on a phone:

| Measured by the game's built-in panel (`?debug=1`) | Observed by you |
|---|---|
| Frame times and fps while a level is running, quality changes, input-to-frame delay for shots, JS heap (Chrome), GPU object counts, errors and console lines, battery % | Temperature, sound, how the touch feels, colour legibility, whether anything looks wrong |

The input-to-frame number is the delay between lifting your finger and the next frame the game draws. It does **not** include touch-panel sampling or display latency, so it is a lower bound, not "touch latency".

---
## 0. Prepare (once)
1. Get the project folder onto a computer (unzip `3d-zuma-v2-phase2…zip` or the later candidate). `vendor/three.module.js` (real Three.js r160, 1.2 MB) is already inside; check with `grep -c "REVISION = '160'" vendor/three.module.js` (prints 1). You do not need `fetch-three.sh` unless that file is missing.
2. Put the phone and the computer on the same Wi-Fi.
3. Decide how to serve it. Offline/installable-app tests need a *secure context* (HTTPS or `localhost`); everything else works over plain `http://`.

| Option | Command / action | Works for | Needs |
|---|---|---|---|
| **A. LAN http** (quickest) | In the project folder run `python3 -m http.server 8080 --bind 0.0.0.0` (Windows: `py -m http.server 8080 --bind 0.0.0.0`). Find the computer's IP (`ip addr`, `ipconfig` or `ifconfig`, e.g. `192.168.1.23`). On the phone open `http://192.168.1.23:8080/zuma3d-android.html`. | Tests 1–7, 9–11 | Same Wi-Fi; firewall must allow port 8080 |
| **B. USB + localhost** | Phone: Developer options → USB debugging on. Computer: Chrome → `chrome://inspect/#devices` → *Port forwarding* → add `8080` → `localhost:8080`. Phone Chrome then opens `http://localhost:8080/zuma3d-android.html`. | Everything incl. offline (test 8) and console | USB cable, Chrome on the computer |
| **C. HTTPS URL you control** | A staging site, or a tunnel to the local server (for example `cloudflared tunnel --url http://localhost:8080`). Open the https URL on the phone. | Everything incl. offline (test 8) | Your own hosting/tunnel. Tunnel URLs are public to anyone who has the link; stop the tunnel afterwards |

4. Open the game URL on the phone **once** and check that the menu appears. If you see an error screen instead, see test 9.
5. Record the device (fill the table in "Report" at the end): **Model**, **Android version** (Settings → About phone), **Chrome version** (Chrome → ⋮ → Settings → About Chrome, or `chrome://version`), RAM/chipset if known, battery %, power-saver **off** (except test 11), brightness 50%, screen timeout long, rotation lock **off**, ambient temperature (room / outdoors). The viewport and device pixel ratio are recorded for you in the saved report (`device.viewport`, `device.devicePixelRatio`).
6. Close other apps. Let the phone rest 5 minutes before the 10-minute session so heat starts from a similar place each run.

## 1. Turn on the on-screen diagnostics
Add `?debug=1` to the address, for example `http://192.168.1.23:8080/zuma3d-android.html?debug=1`. (Other options go after it with `&`, see test 10.)
A small dark panel appears under the top bar:
```
58 fps  p95 19ms  max 41ms (5s)      last 5 seconds of play
t 3:12  play frames 11520  >33ms 1.2%  time on page, frames counted, share slower than 30 fps
dpr cap 1.5  halo on  540x960         current quality and canvas size
gpu geo 36 tex 4 prog 15              GPU object counts (should stop growing)
heap 38.2MB  input>frame 11ms (p95 17)
errors 0
```
Buttons: **Copy** (report to clipboard; on plain-http it may say "copy blocked"), **Save** (downloads `zuma-report-<time>.json` into Downloads — use this one if Copy is blocked), **Reset** (clears the frame statistics; the 30-second snapshots keep running), **×** (hides the text).
Only frames while a level is actually being played count; menus, pause and background time are excluded. The panel also records a snapshot every 30 seconds (fps, p95, heap, battery %, quality, GPU counts) so the saved file contains a time series for the whole session. Console errors/warnings, uncaught exceptions, the game's own `[zuma] …` messages, visibility changes, rotations, offline/online switches and WebGL context loss are logged with timestamps.
`?debug=1` also opens all 10 levels in the level grid for that page load only; your real saved progress is not changed.

## 2. Orientation and layout (repeatable, 5 minutes)
Start Campaign → level 1. Then do this exact sequence and note anything that fails:
1. Portrait: tap the pause button, resume. Confirm the whole track is visible between the top bar and the bottom controls, nothing overlaps (score, goal, lives, tray, power buttons, combo and danger text).
2. Rotate to landscape. Wait 2 seconds. Same checks. Tap near the track edge; the shot must go toward the point under your finger.
3. Rotate back. Repeat portrait ↔ landscape 5 times quickly, then once while a shot is in flight.
4. Repeat on the menu, pause, level-complete and game-over screens (use `?debug=1` level 10 and let it end, or finish level 1).
5. Settings → Android display size / font size at the largest setting: reopen the game and recheck.
6. Notch/cut-out phones: nothing hidden under the notch; gesture-bar swipes must not fire shots.
7. Marble legibility (fill in honestly, this is a human judgement): can you tell all 6 colours apart at arm's length, indoors and outdoors? The automated check only guarantees a 14 CSS-pixel minimum diameter (about 16–19 px in the tests) and a rendered colour difference ΔE ≥ 33; neither proves the marbles are comfortable on a 5-inch screen in sunlight. Write down which two colours you confuse, if any.
**Pass:** no overlap, no lost track, aim follows the finger, no stuck screen. **Fail:** anything hidden, a shot fired by a rotation or gesture, a blank canvas.

## 3. The repeatable 10-minute gameplay session
Use the same phone state each time (section 0, step 6). URL: `…zuma3d-android.html?debug=1`.
| Time | Do this |
|---|---|
| 0:00 | Note battery %. Tap **Reset** on the panel. Start Campaign → **level 10**, portrait. Play normally (shoot to match 3+; use power-ups). If you lose all lives choose **Play again**; that is the restart test |
| 0:00–4:00 | Portrait play on level 10 |
| 4:00 | Note battery % and how warm the phone feels (back of the phone, near the camera) |
| 4:00–6:00 | Rotate to landscape and keep playing |
| 6:00–7:30 | Pause and resume 3 times; press Home, wait 10 seconds, return; lock the screen 10 seconds, unlock |
| 7:30–9:30 | Go to the menu and start a level 5 times in a row (menu → level grid → any level) |
| 9:30 | Play on until 10:00 |
| 10:00 | Note battery % and warmth. Tap **Save** (and screenshot the panel). Do not reload the page before saving |
Record from the panel and the saved file: `frames.p50Ms`, `p95Ms`, `over33msPct`, `maxMs`, the quality at the end (`now.gpu.quality`), every `[zuma] quality lowered` line in `errors` (this is adaptive quality stepping down, with the time), heap and GPU counts at 1:00, 5:00 and 10:00 in `samples`.
Suggested pass guides (proposals, not validated limits — adjust after the first device): median ≥ 50 fps on a mid-range phone, ≥ 30 fps on an entry-level phone after quality has settled (it should settle within ~20 s); p95 ≤ 33 ms; frames > 33 ms under 5%; heap and GPU counts flat after the first minute (compare the 1:00 and 10:00 samples; geometries/textures/programs must not keep climbing, heap growth of a few MB is normal); no unexpected `errors` entries; no crash, blank screen or stuck state.

## 4. Touch response (10 shots)
1. On level 1 shoot 10 times at distinct points, noting for each: did the shot leave from where you aimed? Read `inputToFrameMs` in the saved report (n should be ≥ 10; look at mean, p95, max). Suggested guide: p95 ≤ 50 ms.
2. If you have a second phone/camera with slow-motion (120/240 fps), film your fingertip and the screen for 10 shots and count frames from finger-lift to the marble leaving the muzzle. Suggested guide: ≤ 100 ms end to end. Without a camera, write "not measured" — do not guess.
3. Behaviour checks: drag-aim follows the finger without lag; a tap on the swap tray swaps and does **not** fire; touching a power button never fires; sliding the finger off the screen edge or pulling the notification shade does not fire; a two-finger touch does not fire twice; the diagnostic panel buttons never fire.

## 5. Heat and battery
Use the 10-minute session; note battery % and temperature at 0, 5 and 10 minutes. Android web pages cannot read temperature. Use an IR thermometer on the back cover, or the battery temperature if your phone shows it (Settings → Battery, a vendor "device care" app, or a battery app); otherwise write a qualitative note (cool / warm / hot / uncomfortable). If fps (`samples[].fps`) falls over the session while the phone warms, that is thermal throttling: report it with the curve. Optional 15-minute endless run: Menu → Endless.

## 6. Memory and resources
From the 10-minute file: heap and GPU counts at 1:00 / 5:00 / 10:00 (`samples[].heapMB`, `samples[].gpu`). Extra stress: restart a level 20 times (menu → level) and Save a second report; compare to the first. Expect geometries/textures/programs unchanged after the first minute. With a PC (option B) you may also take Chrome DevTools → Memory heap snapshots at start, after 20 restarts and after 10 minutes. Any steady growth is a defect.

## 7. Audio
Ringer/media volume up. Sound starts only after the first touch (expected). Check: shot, match, combo, bomb, life lost, level complete are audible and not clipped; Settings → Sound off mutes everything; volume slider works. Press Home and return, lock/unlock, take a phone call or play another app's audio: afterwards the game must either keep working or stay quiet — no errors, no loud glitches. Bluetooth headset: connect during play and check sound moves. Note any latency between a shot and its sound.

## 8. Offline reload (needs option B or C)
1. Online: open the URL (without `?debug=1` is fine), wait 15 seconds, reload once.
2. Enable airplane mode, force-stop Chrome (Settings → Apps → Chrome → Force stop), reopen the same URL. **Expected:** menu appears, a level plays.
3. Clear site data for the origin, stay offline, open the URL. **Expected:** the "Could not start" error screen with a Reload button (never a blank screen).
4. Go online and tap Reload. **Expected:** the game starts.
Only the vendored engine file (`vendor/three.module.js`) is cached for offline use. The CDN fallback is not.

## 9. Recovery from engine-load failure
Make a copy of the project folder, delete `vendor/three.module.js` from the **copy**, and serve the copy (option A). Open it on the phone.
- With internet: the game falls back to the CDN copy of r160 and should simply play (record whether it did; this CDN path has never been verified from a real network).
- To see the failure screen: use a Wi-Fi network with no internet access (or unplug the router's uplink) and open the copy. **Expected:** "Could not start …" with Reload. Restore internet, tap Reload: the game must start without clearing anything.
Also note what happens if you start the page with the server stopped (browser error page is expected and not a game bug).

## 10. Graphics A/B (same phone, same level)
Overrides, combined with `&`: `?aa=0` (no antialiasing), `?dpr=1.25` (pixel-ratio cap, accepted range 0.5–3), `?halo=0` (no glow pass), `?env=0` (no reflection map), `?adapt=0` (adaptive quality off). Invalid values are ignored. The lowest-quality setting is `?aa=0&dpr=0.5&halo=0&env=0&adapt=0` (very blurry; see the note below).
Procedure (`debug=1` always on): level 10, portrait, tap **Reset**, play 2 minutes, **Save**. Run in this order and repeat the first line at the end to detect heat drift:
1. `?debug=1` (default, adaptive on)
2. `?debug=1&adapt=0&dpr=1.75`
3. `?debug=1&adapt=0&dpr=1.25`
4. `?debug=1&adapt=0&aa=0`
5. `?debug=1&adapt=0&halo=0`
6. `?debug=1&adapt=0&env=0`
7. `?debug=1&adapt=0&aa=0&dpr=0.75&halo=0&env=0` (playable-minimum check; also judge legibility and aim accuracy)
8. `?debug=1` again
Record p50, p95, over33msPct, plus your judgement of looks (blurry? flicker? reflections?). In the desktop software-GL benchmark pixel count dominated, MSAA cost about 13% and glow about 1%; this table tells whether the same holds on a real GPU. Also read the first report's `now.gpu.envBuildMs` (one-off reflection-map build time on your GPU).
Adaptive quality (setting 1, Phase 4 policy in `quality.js`): two consecutive slow 2-second windows (trimmed mean > 28 ms) step quality down one rung (lower resolution cap … finally 0.75x with no glow); the step must cut the frame time by at least 6 % or it is **reverted** (the limit is then not rendering cost, e.g. a 30 fps cap) and further downgrades are locked out with back-off (stops for the session after 3 fruitless tries); after 10 s under 20 ms it restores quality one rung at a time and reverts at once if that was not affordable. `?dpr=` / `?halo=0` act as ceilings; `?adapt=0` turns it off. The console shows `[zuma] quality down|up|revert` with the reason; the panel's report has `quality.level/levels/reverts/capSuspected`. All of this is verified only with synthetic and software-GL frame times — see test 11.
Note: values below `dpr=0.75` can be blurry; on a 3× screen `dpr=0.5` renders marbles at about 8 canvas pixels.

## 11. Battery saver / 30 Hz test
Turn on Battery saver (some phones cap the browser to 30 fps) or pick a 30 Hz display mode, then play 3 minutes of level 10 with `?debug=1`. Expected from the Phase 4 policy: at most a few brief quality dips followed by a revert (`[zuma] quality revert … did not help`) and the game staying at full quality with `capSuspected: true`; after 3 fruitless probes no more dips. If quality instead stays lowered, record fps, p95 and the `[zuma] quality …` lines: that means the cap and a real GPU limit could not be told apart on your phone (known limitation, see PHASE4-REPORT.md). Then repeat with the charger connected and battery saver off for comparison. Also check the reverse: on a phone that really struggles at 60 Hz, quality should drop within about 10 s and, once the load is lighter, return step by step. This is an unverified expectation, not a result.

## 13. Marble symbols (needs the person who benefits, or a grayscale test)
Every marble colour has a dark symbol on it (red +, green triangle, blue two bars, yellow ×, purple dot, orange ring); the tray marbles show the same. Settings → "Marble symbols" turns them off; `?marks=0` turns them off for one visit without changing the saved setting.
1. Play level 3 for 3 minutes in portrait and landscape. Can you tell every symbol apart at arm's length without thinking about colour? Which two are confused first (+ vs ×, dot vs ring)? Record it.
2. Turn on Android Settings → Accessibility → Color correction (deuteranomaly / protanomaly) or Color inversion/Grayscale, and repeat. If you have red-green colour-vision deficiency, the person with it is the only valid judge: ask them whether the symbols make matching easier, harder or no different, and whether the symbols get in the way.
3. Do the symbols hide anything you need (the bomb/rainbow icons, the aim guide)? Token marbles show their icon instead of a symbol by design.
Everything measured so far was simulated colour vision on software-rendered frames (`tests/marks.mjs`); this test is the real one.

## 12. Background survival (GPU memory reclaim)
Android may reclaim GPU memory while the game is in the background. During a level: Home, open the camera or a video app for 2 minutes, then return. Record what you see: game continues / "Graphics interrupted" screen that becomes the pause screen when the browser restores graphics (tap Resume) / "Graphics interrupted" that never goes away (report this!). The saved report's `events` contains `webgl context lost` and `context restored` with timestamps. After recovery the marbles must still have their six colours and shiny highlights.

## Reporting a failure (what to send)
1. Tap **Save** in the panel *immediately* (before reloading) and keep the `zuma-report-….json`.
2. Screenshot: power + volume-down (include the panel). Screen recording if it only happens in motion (Quick settings → Screen record).
3. Write: the exact URL, the test number and step, what you expected, what happened, whether it repeats (every time / sometimes / once), and the device table.
4. Console logs without a PC: they are inside the saved report (`errors`). With a PC (option B): `chrome://inspect` → Inspect → Console tab → right-click → Save as… and attach it.
5. Optional (PC + USB debugging): `adb logcat -d -s chromium:* > logcat.txt` right after the failure.
6. Do **not** include personal data from other apps in screenshots.

## Suggested release blockers (proposals for the commander; not yet adopted)
Crash, blank canvas or a stuck error screen in tests 2, 3, 8, 9 or 12; shots that cannot be aimed or fire by accident (test 4); median fps < 30 after quality settles on a phone that is meant to be supported; steadily climbing heap/GPU counts (test 6); offline reload failing with the vendored engine (test 8); no sound after the first touch (test 7); two confusable marble colours reported by more than one tester (test 2).

## Result table (fill in; attach the files)
| Item | Device | Result | Evidence file |
|---|---|---|---|
| Layout portrait/landscape (test 2) | | | |
| 10-min session fps p50 / p95 / >33ms% (test 3) | | | |
| Quality at end / steps lowered | | | |
| Input-to-frame mean / p95 (test 4) | | | |
| Heat 0 / 5 / 10 min, battery drop (test 5) | | | |
| Heap + GPU counts 1 / 5 / 10 min (test 6) | | | |
| Audio (test 7) | | | |
| Offline reload (test 8) | | | |
| Engine-load failure recovery (test 9) | | | |
| Graphics A/B table (test 10) | | | |
| Battery-saver behaviour (test 11) | | | |
| Background survival (test 12) | | | |
| Marble colour legibility notes (test 2.7) | | | |

Device record: Model ______  Android ______  Chrome ______  RAM/SoC ______  Screen/DPR (from report) ______  Option A/B/C ______  Date ______  Tester ______  Power saver ______  Brightness ______  Battery start/end ______
