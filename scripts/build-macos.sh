#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/AI CFO.app"
RES="$APP/Contents/Resources"
MAC="$APP/Contents/MacOS"

rm -rf "$APP"
mkdir -p "$MAC" "$RES"

cp "$ROOT/macos/Info.plist" "$APP/Contents/Info.plist"
cp -R "$ROOT/dist" "$RES/dist"
cp "$ROOT/scripts/scan_usage.py" "$RES/scan_usage.py"

swiftc -O \
  "$ROOT/macos/App.swift" \
  -framework Cocoa \
  -framework WebKit \
  -o "$MAC/AICfo"

echo "Built $APP"
echo "Open with: open \"$APP\""
