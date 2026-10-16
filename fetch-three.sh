#!/bin/sh
# Fetches Three.js r160 (the build the game was written against) into vendor/ so the game works offline.
# 1) unpkg CDN; 2) fallback: the official GitHub tag r160 (for networks where only github.com is reachable).
set -e
cd "$(dirname "$0")"
mkdir -p vendor
if ! curl -fL --max-time 60 -o vendor/three.module.js https://unpkg.com/three@0.160.0/build/three.module.js 2>/dev/null; then
  echo "unpkg unreachable, trying github.com tag r160 ..."
  tmp="$(mktemp -d)"
  git clone -q --depth 1 --branch r160 https://github.com/mrdoob/three.js.git "$tmp/three"
  cp "$tmp/three/build/three.module.js" vendor/three.module.js
  rm -rf "$tmp"
fi
grep -q "REVISION = '160'" vendor/three.module.js || { echo "ERROR: vendor/three.module.js is not r160"; rm -f vendor/three.module.js; exit 1; }
echo "Saved vendor/three.module.js ($(wc -c < vendor/three.module.js) bytes, r160). Reload the game once while online so the service worker caches it."
