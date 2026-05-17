#!/bin/bash
# Build GXW app icon from SVG source.
#
# Produces:
#   assets/icon.png   — 1024x1024 PNG for runtime dock icon (app.dock.setIcon)
#   assets/icon.icns  — multi-resolution macOS icon for the packaged .app bundle
#
# Requires:
#   rsvg-convert (brew install librsvg)
#   iconutil     (built into macOS)
#
# Usage: bash scripts/build-icon.sh

set -e

cd "$(dirname "$0")/.."

if ! command -v rsvg-convert >/dev/null 2>&1; then
    echo "Error: rsvg-convert not found." >&2
    echo "Install with: brew install librsvg" >&2
    exit 1
fi

SVG="assets/icon.svg"
ICONSET="assets/icon.iconset"
ICNS="assets/icon.icns"
PNG="assets/icon.png"

if [ ! -f "$SVG" ]; then
    echo "Error: $SVG not found." >&2
    exit 1
fi

# Runtime PNG for app.dock.setIcon.
rsvg-convert -w 1024 -h 1024 "$SVG" -o "$PNG"
echo "Wrote $PNG"

# Iconset for ICNS packaging.
rm -rf "$ICONSET"
mkdir -p "$ICONSET"

render() {
    local name="$1"
    local px="$2"
    rsvg-convert -w "$px" -h "$px" "$SVG" -o "$ICONSET/icon_${name}.png"
}

render "16x16"      16
render "16x16@2x"   32
render "32x32"      32
render "32x32@2x"   64
render "128x128"    128
render "128x128@2x" 256
render "256x256"    256
render "256x256@2x" 512
render "512x512"    512
render "512x512@2x" 1024

iconutil -c icns "$ICONSET" -o "$ICNS"
rm -rf "$ICONSET"

echo "Wrote $ICNS"
echo "Done."
