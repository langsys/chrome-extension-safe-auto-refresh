#!/usr/bin/env bash
# Rasterises assets/icon.svg into the PNG sizes the manifest references.
# Needs librsvg: brew install librsvg

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

command -v rsvg-convert >/dev/null 2>&1 || {
  echo "rsvg-convert not found (brew install librsvg)" >&2
  exit 1
}

mkdir -p icons
for size in 16 32 48 128; do
  rsvg-convert -w "$size" -h "$size" assets/icon.svg -o "icons/icon-${size}.png"
  echo "  icons/icon-${size}.png"
done
