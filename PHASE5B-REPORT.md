# Phase 5B — deployment readiness (nothing pushed, nothing deployed)

Base: commit `9d4e4f48b4b5a3c34a45e42d0ed4ff8e5f52e13e` (Phase 4, unchanged, still the parent) and `3d-zuma-v2-phase4-candidate.zip` (sha256 `4423190d…bef0d0`, unchanged).
Functional commit: `aece4c81d89083005a28c41538d839ea23723a3c` (all tests below ran on a clean clone of exactly this commit). The commit after it adds only this report, the evidence logs, `tests/deploy-static.mjs`, a `test:deploy` script line and README wording.
Labels: **MEASURED** = command output in `tests/evidence-phase5b/`. Everything runs on software WebGL in headless Chromium; **no physical device, no real Vercel deployment.**

## Blocker 1 — Vercel root
`vercel.json` (5 lines): one rewrite `/` → `/zuma3d-android.html`. A rewrite keeps the URL at `/`, so relative module/asset URLs, the manifest (`start_url ./zuma3d-android.html`) and the service worker (scope `/`) resolve from the site root; it is not a redirect, so no loop is possible. No `index.html` was added, and there is no catch-all, so a missing file still returns 404.

## Blocker 2 — Three.js
`vendor/three.module.js` is now tracked (1,272,972 bytes, sha256 `76dea815…d61a495`). **Verified byte-identical** (`cmp`) to `build/three.module.js` of the official `r160` tag of github.com/mrdoob/three.js (commit `d04539a76736ff500cae883d6a38b3dd8643c548`) cloned during this phase. It is also the file every earlier test used. npm/unpkg were unreachable from this workspace, so the comparison is against the GitHub tag. License MIT, © 2010-2023 three.js authors: header kept in the file, full text in `vendor/LICENSE-three.txt`, `THIRD-PARTY-NOTICES.md`, provenance in `vendor/README.md`. `.gitignore` lost only the `vendor/three.module.js` line (`node_modules/` and `tests/screenshots/` remain ignored). `main.js` still lists the CDN as a fallback, but normal startup uses `./vendor/`.

## Test results — clean clone of `aece4c81` (MEASURED)
| Command | Result |
|---|---|
| `npm test` | 63/63 pass, exit 0 |
| `node tests/browser.mjs` (stub) | 132/132, exit 0 |
| `REAL=1 node tests/browser.mjs` (real Three.js r160) | 144/144, exit 0 |
| `node tests/gfx-fallback.mjs` | 27/27, exit 0 |
| `node tests/marks.mjs` | 72 checks pass, exit 0 |
| `node tests/balance.mjs 12` | table identical to Phase 3/4 |
| `node tests/balance-ci.mjs 150 400` | JSON byte-identical to Phase 4 |
| `node tests/deploy-static.mjs <git archive of the commit>` | 28/28, exit 0 |

## Production-like static deployment test (EMULATION)
`tests/deploy-static.mjs` serves a `git archive` export (so ignored/untracked files cannot hide gaps) with a small Node server that applies the real `vercel.json` (filesystem first, then rewrites). It is **not Vercel**: it cannot show Vercel's headers, caching, compression or routing quirks. It checks: `/` → 200 same bytes as the game page without redirect; `/zuma3d-android.html` → 200; all page-referenced assets plus the modules, `sw.js`, manifest, icons and Three.js → 200 with JavaScript MIME; unknown path → 404; with **every off-origin request blocked and counted**, the root URL (portrait 390×844) and the game URL (landscape 844×390) start with the real r160 `WebGLRenderer` from `/vendor/`, zero requests to unpkg or elsewhere, no console errors or failed requests, diagnostics off by default, level 1 starts and keeps rendering with symbols on, layout fits with no horizontal scroll, the service worker registers with scope `/`, precaches Three.js, and an offline reload of `/` boots from its cache. Negative control: with the vendor file removed the CDN is attempted and the game cannot start. The test does not simulate shooting (covered by the browser suites).

## Diff review, `9d4e4f4..aece4c8`
6 files: `.gitignore` (−1 line), `vercel.json`, `vendor/three.module.js` (new, upstream file), `vendor/LICENSE-three.txt`, `vendor/README.md`, `THIRD-PARTY-NOTICES.md`. `core.js`, `view.js`, `audio.js`, `render.js`, `main.js`, `sw.js`, all level/balance data, and all payment-related code (there is none) are untouched; balance outputs are identical. No credentials, env files or personal data added (pattern grep over the non-vendor diff: none).

## Remaining blockers / not verified
- GitHub push and Vercel deployment: not done by instruction; the shell is still not authenticated to GitHub and there is no Vercel access. The real deployed URL has never been tested.
- Vercel will also serve `tests/`, `audit/` and the reports from the repo (harmless but public); a `.vercelignore` is optional and was not added.
- Physical Android testing, real GPU performance, heat, battery, audio behaviour, human/colour-vision accessibility testing: **unverified**. No device validation is claimed.
- Rollback: parent commit `9d4e4f48…`, bundle `zuma-phase4-release.PRESERVED-9d4e4f4.bundle`, ZIP above.
