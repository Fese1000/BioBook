#!/bin/bash
# Baut Laborbuch.app (Swift-Hülle + Web-Oberfläche) und packt sie als DMG.
# Aufruf: ./make-app.sh [arm64|x86_64|all] [--no-dmg]   (Standard: Architektur dieses Macs)
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
VERSION="$(cat "$SRC/VERSION")"
DIST="$SRC/dist"; mkdir -p "$DIST"
DMG=1; [ "${2:-}" = "--no-dmg" ] && DMG=0

build() {  # $1 = arm64|x86_64
  local arch="$1" label; [ "$arch" = arm64 ] && label=AppleSilicon || label=Intel
  local stage="$SRC/build/$label" app="$SRC/build/$label/Laborbuch.app"
  rm -rf "$stage"; mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
  cp -R "$SRC/web" "$app/Contents/Resources/"
  cp "$SRC/app/AppIcon.icns" "$app/Contents/Resources/"
  swiftc -O -target "$arch-apple-macos13" "$SRC"/app/*.swift -o "$app/Contents/MacOS/Laborbuch"
  cat > "$app/Contents/Info.plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Laborbuch</string>
<key>CFBundleDisplayName</key><string>Laborbuch</string>
<key>CFBundleIdentifier</key><string>de.felix.laborbuch</string>
<key>CFBundleExecutable</key><string>Laborbuch</string>
<key>CFBundleIconFile</key><string>AppIcon</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>$VERSION</string>
<key>CFBundleShortVersionString</key><string>$VERSION</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PL
  codesign --force --deep --sign "${CODESIGN_ID:--}" "$app"
  if [ $DMG = 1 ]; then
    ln -s /Applications "$stage/Programme"
    rm -f "$DIST/Laborbuch-$label.dmg"
    hdiutil create -quiet -volname Laborbuch -srcfolder "$stage" -ov -format UDZO "$DIST/Laborbuch-$label.dmg"
    echo "Fertig: $DIST/Laborbuch-$label.dmg"
  else
    echo "Fertig: $app"
  fi
}

case "${1:-$(uname -m)}" in
  arm64)  build arm64 ;;
  x86_64) build x86_64 ;;
  all)    build arm64; build x86_64 ;;
  *) echo "Aufruf: $0 [arm64|x86_64|all] [--no-dmg]"; exit 1 ;;
esac
