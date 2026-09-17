#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
BUILD_DIR="${NOVA_BUILD_DIR:-.build}"
mkdir -p "$BUILD_DIR/cache"
xcrun swiftc -swift-version 5 -module-cache-path "$BUILD_DIR/cache" Sources/ParcelCore.swift Tests/CoreTests.swift -o "$BUILD_DIR/core-tests"
"$BUILD_DIR/core-tests"
node Tests/bridge.test.cjs
