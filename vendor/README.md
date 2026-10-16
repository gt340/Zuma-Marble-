# vendor/

`three.module.js` is Three.js **r160**, committed unmodified so the game starts without any CDN.

- Source: official tag `r160` of https://github.com/mrdoob/three.js (commit `d04539a76736ff500cae883d6a38b3dd8643c548`), file `build/three.module.js`
- SHA-256: `76dea8151bc9352aef3528b4262e249b2604f62543828328db978d060d61a495` (1,272,972 bytes)
- License: MIT, © 2010-2023 three.js authors. Full text in `LICENSE-three.txt`; the SPDX/licence header is kept at the top of the file.
- `main.js` loads `./vendor/three.module.js` first; the unpkg CDN (same r160) is only a fallback if this file cannot be fetched.
- To re-verify: `sh fetch-three.sh` fetches r160 and checks the revision; compare the hash above.
