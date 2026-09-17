#!/usr/bin/env bash
set -e

# =============================================================================
# Build Clodds Native macOS App Bundle (Clodds.app)
# =============================================================================

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

echo "🦀 [1/4] Generating macOS Retina AppIcon..."
ICONSET_DIR="desktop/macos/AppIcon.iconset"
rm -rf "$ICONSET_DIR"
mkdir -p "$ICONSET_DIR"

LOGO_PNG="public/webchat/logo.png"
if [ -f "$LOGO_PNG" ]; then
    sips -s format png -z 16 16     "$LOGO_PNG" --out "$ICONSET_DIR/icon_16x16.png" > /dev/null 2>&1
    sips -s format png -z 32 32     "$LOGO_PNG" --out "$ICONSET_DIR/icon_16x16@2x.png" > /dev/null 2>&1
    sips -s format png -z 32 32     "$LOGO_PNG" --out "$ICONSET_DIR/icon_32x32.png" > /dev/null 2>&1
    sips -s format png -z 64 64     "$LOGO_PNG" --out "$ICONSET_DIR/icon_32x32@2x.png" > /dev/null 2>&1
    sips -s format png -z 128 128   "$LOGO_PNG" --out "$ICONSET_DIR/icon_128x128.png" > /dev/null 2>&1
    sips -s format png -z 256 256   "$LOGO_PNG" --out "$ICONSET_DIR/icon_128x128@2x.png" > /dev/null 2>&1
    sips -s format png -z 256 256   "$LOGO_PNG" --out "$ICONSET_DIR/icon_256x256.png" > /dev/null 2>&1
    sips -s format png -z 512 512   "$LOGO_PNG" --out "$ICONSET_DIR/icon_256x256@2x.png" > /dev/null 2>&1
    sips -s format png -z 512 512   "$LOGO_PNG" --out "$ICONSET_DIR/icon_512x512.png" > /dev/null 2>&1
    sips -s format png -z 1024 1024 "$LOGO_PNG" --out "$ICONSET_DIR/icon_512x512@2x.png" > /dev/null 2>&1

    iconutil -c icns "$ICONSET_DIR" -o desktop/macos/AppIcon.icns
    rm -rf "$ICONSET_DIR"
fi

echo "📦 [2/4] Assembling Clodds.app bundle structure..."
APP_BUNDLE="Clodds.app"
rm -rf "$APP_BUNDLE"
mkdir -p "$APP_BUNDLE/Contents/MacOS"
mkdir -p "$APP_BUNDLE/Contents/Resources"

cp desktop/macos/Info.plist "$APP_BUNDLE/Contents/Info.plist"
# 写入项目路径：Clodds.app 移动到其他位置后，本机模式仍能找到项目
plutil -replace CloddsProjectDir -string "$PROJECT_DIR" "$APP_BUNDLE/Contents/Info.plist"
if [ -f desktop/macos/AppIcon.icns ]; then
    cp desktop/macos/AppIcon.icns "$APP_BUNDLE/Contents/Resources/AppIcon.icns"
fi
echo -n "APPL????" > "$APP_BUNDLE/Contents/PkgInfo"

echo "⚡ [3/4] Compiling Swift native binary..."
swiftc -O \
    -framework Cocoa \
    -framework WebKit \
    desktop/macos/main.swift \
    -o "$APP_BUNDLE/Contents/MacOS/Clodds"

chmod +x "$APP_BUNDLE/Contents/MacOS/Clodds"

echo "🔏 [4/4] Applying ad-hoc code signature..."
codesign --force --deep -s - "$APP_BUNDLE" 2>/dev/null || true

echo "✅ Clodds.app compiled successfully!"
echo "📍 Location: $PROJECT_DIR/Clodds.app"
echo "🚀 To launch: open Clodds.app  (or npm run gui)"
