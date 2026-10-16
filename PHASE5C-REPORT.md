# Phase 5C — final release attempt: STOPPED at the GitHub gate (nothing pushed, nothing deployed)

Preserved unchanged: commit `9d4e4f48b4b5a3c34a45e42d0ed4ff8e5f52e13e`, commit `aece4c81d89083005a28c41538d839ea23723a3c` (both are ancestors of the branch head; tag `rollback/phase4-9d4e4f4`), `zuma-phase4-release.bundle` and `zuma-phase4-release.PRESERVED-9d4e4f4.bundle`, `zuma-phase5b-release.bundle`, the Phase 4 ZIP.
Cleanup commit: `61a3e7a1eface93d503cb1db8723ad4d8512d1f0` (`.vercelignore` + deploy-test update). The commit after it adds only this report and `tests/evidence-phase5c/`.

## .vercelignore
Excludes only: `/tests/`, `/audit/`, the internal reports and `README.md`, `/fetch-three.sh`, `*.zip`, `*.bundle`, `*.sha256`, `/node_modules/`. Deliberately NOT excluded: `zuma3d-android.html`, all runtime JS, `sw.js`, `manifest.json`, icons, `vendor/three.module.js`, `vendor/LICENSE-three.txt`, `THIRD-PARTY-NOTICES.md` (MIT notice stays with the deployed library), `vercel.json`, `package.json`.
`tests/deploy-static.mjs` now builds the deployment set with these rules (supported syntax: `/path`, `/dir/`, `*.ext`) and checks: all 18 required files present, all 14 files the service worker precaches present, tests/audit/reports/README/dev script absent, no archives. Result on the committed tree: 21 files, 1.51 MiB deployed, 13 entries excluded. Mutation control: adding `/sw.js` and `/vendor/three.module.js` to the ignore file makes the test fail. Limitation: the matcher is the test's own subset implementation, not Vercel's.

## Tests on a clean clone of `61a3e7a1` (MEASURED, software WebGL)
`npm test` 63/63 · stub browser 132/132 · real Three.js browser 144/144 · graphics fallback 27/27 · deploy-static (emulated Vercel static serving, ignore rules applied, off-origin requests blocked) 31/31. All exit 0.
Not rerun in 5C: `marks.mjs` (72) and balance/balance-ci — no runtime, gameplay or balance file changed since `aece4c81` (diff: `.vercelignore`, reports, README, package.json script line, tests only), and those suites passed on `aece4c81` (see `tests/evidence-phase5b/`).

## GitHub — BLOCKED (precise)
- Target `gt340/Zuma-Marble-`: public, still empty (no branches), so nothing can be overwritten.
- Shell push: `git push --dry-run` → proxy 403 "gt340/Zuma-Marble- is not in this session's authorized repository set, so the proxy will not inject a credential". The `GH_TOKEN` in the environment is invalid.
- Approved integration: `add_repo(gt340/Zuma-Marble-, push)` → "link your GitHub account to let Claude access repositories". This needs the account owner to link GitHub to Claude; it cannot be done from inside the session.
- The GitHub connector (authenticated as `gt340`) can only create commits from text, so it would produce different SHAs, cannot carry the PNG icons, and cannot satisfy "remote SHA equals reviewed local commit". Not used.
No credential was requested, printed or stored.

## Vercel — BLOCKED
No Vercel CLI, token, or deploy-capable connector in this session (checked again). No Preview or Production deployment exists; no deployed URL was tested; the production project/branch target is unconfirmed, and production is not attempted.

## Unverified
Real Vercel behaviour (headers, caching, compression), the deployed Preview, physical Android performance, battery, heat, audio, human and colour-vision accessibility testing. No device validation is claimed.

## To finish
Link the GitHub account to Claude (or push the bundle from your machine: `git fetch zuma-phase5c-release.bundle release/phase4-v2.0.5:release/phase4-v2.0.5 && git push origin release/phase4-v2.0.5`), then import the repo into Vercel (Preview first), and tell me the production project and branch.
