#!/usr/bin/env bash
# Builds the zip uploaded to the Chrome Web Store.
#
# The file list is an explicit allowlist, not an exclude list. A zip built by
# excluding things is one .gitignore mistake away from shipping the test suite,
# the store artwork, or a stray .env to every user who installs the extension.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./manifest.json').version")"
OUT="dist/safe-auto-refresh-${VERSION}.zip"

FILES=(
  manifest.json
  background.js
  popup.html
  popup.css
  popup.js
  shared/constants.js
  icons/icon-16.png
  icons/icon-32.png
  icons/icon-48.png
  icons/icon-128.png
)

for f in "${FILES[@]}"; do
  [ -f "$f" ] || { echo "missing: $f" >&2; exit 1; }
done

# Manifest version must match package.json, or the store listing and the repo
# tag drift apart silently.
PKG_VERSION="$(node -p "require('./package.json').version")"
if [ "$VERSION" != "$PKG_VERSION" ]; then
  echo "version mismatch: manifest.json=$VERSION package.json=$PKG_VERSION" >&2
  exit 1
fi

rm -rf dist
mkdir -p dist
zip -q -X "$OUT" "${FILES[@]}"

echo "$OUT"
# -Z1 lists bare entry names and is portable across BSD and GNU zip.
unzip -Z1 "$OUT" | sed 's/^/  /'
echo
echo "total: $(du -h "$OUT" | cut -f1)"
