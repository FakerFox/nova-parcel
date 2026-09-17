#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
BUILD_DIR="${NOVA_BUILD_DIR:-.build}"
APP_DIR="${NOVA_APP_DIR:-dist/Nova Parcel.app}"
mkdir -p "$BUILD_DIR/cache" "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"
xcrun swiftc -swift-version 5 -O -module-cache-path "$BUILD_DIR/cache" -target arm64-apple-macosx14.0 \
  Sources/ParcelCore.swift Sources/AuthSession.swift Sources/ParcelStore.swift Sources/Views.swift Sources/main.swift \
  -framework AppKit -framework SwiftUI -framework WebKit -framework UserNotifications -framework ServiceManagement \
  -o "$APP_DIR/Contents/MacOS/NovaParcel"
cp Resources/Bridge.js "$APP_DIR/Contents/Resources/Bridge.js"
cp Resources/Info.plist "$APP_DIR/Contents/Info.plist"
if [ -f Resources/AppIcon.icns ]; then cp Resources/AppIcon.icns "$APP_DIR/Contents/Resources/"; fi
codesign --force --sign - "$APP_DIR"
codesign --verify --strict "$APP_DIR"
echo "Built: $APP_DIR"
