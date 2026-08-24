#!/bin/bash
# Generate app icons for all platforms from a square source PNG.
#
# macOS does not automatically add optical padding to images passed to
# app.dock.setIcon(). Keep the artwork inside an 80.5% rounded tile so the Dock
# icon matches the visual size of system apps instead of appearing full-bleed.
#
# Usage: ./generate-icons.sh [source.png]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE="${1:-$SCRIPT_DIR/source.png}"

if [ ! -f "$SOURCE" ]; then
    echo "Error: Source file '$SOURCE' not found"
    echo "Usage: ./generate-icons.sh [source.png]"
    exit 1
fi

if command -v magick >/dev/null 2>&1; then
    IMAGEMAGICK="magick"
elif command -v convert >/dev/null 2>&1; then
    IMAGEMAGICK="convert"
else
    echo "Error: ImageMagick is required to create the transparent macOS safe area."
    echo "Install it with: brew install imagemagick"
    exit 1
fi

TMP_DIR="$(mktemp -d /tmp/boai-icons.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

MASTER_SIZE=1024
TILE_SIZE=824
CORNER_RADIUS=180
MACOS_MASTER="$TMP_DIR/macos-master.png"
ICONSET="$TMP_DIR/icon.iconset"

echo "Generating icons from: $SOURCE"

# Build the padded master in separate steps. Keeping this deterministic avoids
# AI-generated checkerboards and guarantees a real alpha channel outside the
# rounded tile.
"$IMAGEMAGICK" "$SOURCE" -resize "${TILE_SIZE}x${TILE_SIZE}!" -alpha set "$TMP_DIR/tile.png"
"$IMAGEMAGICK" -size "${TILE_SIZE}x${TILE_SIZE}" xc:none \
    -fill white \
    -draw "roundrectangle 0,0 $((TILE_SIZE - 1)),$((TILE_SIZE - 1)) ${CORNER_RADIUS},${CORNER_RADIUS}" \
    "$TMP_DIR/mask.png"
"$IMAGEMAGICK" "$TMP_DIR/tile.png" "$TMP_DIR/mask.png" \
    -compose DstIn -composite "$TMP_DIR/rounded-tile.png"
"$IMAGEMAGICK" "$TMP_DIR/rounded-tile.png" \
    -background none -gravity center -extent "${MASTER_SIZE}x${MASTER_SIZE}" \
    -define png:color-type=6 "$MACOS_MASTER"

mkdir -p "$ICONSET"

echo "Generating macOS iconset..."
sips -z 16 16 "$MACOS_MASTER" --out "$ICONSET/icon_16x16.png" >/dev/null
sips -z 32 32 "$MACOS_MASTER" --out "$ICONSET/icon_16x16@2x.png" >/dev/null
sips -z 32 32 "$MACOS_MASTER" --out "$ICONSET/icon_32x32.png" >/dev/null
sips -z 64 64 "$MACOS_MASTER" --out "$ICONSET/icon_32x32@2x.png" >/dev/null
sips -z 128 128 "$MACOS_MASTER" --out "$ICONSET/icon_128x128.png" >/dev/null
sips -z 256 256 "$MACOS_MASTER" --out "$ICONSET/icon_128x128@2x.png" >/dev/null
sips -z 256 256 "$MACOS_MASTER" --out "$ICONSET/icon_256x256.png" >/dev/null
sips -z 512 512 "$MACOS_MASTER" --out "$ICONSET/icon_256x256@2x.png" >/dev/null
sips -z 512 512 "$MACOS_MASTER" --out "$ICONSET/icon_512x512.png" >/dev/null
sips -z 1024 1024 "$MACOS_MASTER" --out "$ICONSET/icon_512x512@2x.png" >/dev/null

echo "Creating icon.icns..."
iconutil -c icns "$ICONSET" -o "$SCRIPT_DIR/icon.icns"

# Electron uses this PNG directly for the macOS Dock icon in development.
echo "Creating transparent icon.png..."
sips -z 512 512 "$MACOS_MASTER" --out "$SCRIPT_DIR/icon.png" >/dev/null

echo "Creating icon.ico..."
"$IMAGEMAGICK" "$MACOS_MASTER" \
    -define icon:auto-resize=256,128,64,48,32,24,16 \
    "$SCRIPT_DIR/icon.ico"

echo "Icons generated:"
file "$SCRIPT_DIR/icon.png" "$SCRIPT_DIR/icon.icns" "$SCRIPT_DIR/icon.ico"
