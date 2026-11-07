#!/bin/bash
# Baut BioBook.app (Swift-Hülle + Web-Oberfläche) und packt sie als DMG.
# Aufruf: ./make-app.sh [arm64|x86_64|all] [--no-dmg]   (Standard: Architektur dieses Macs)
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
VERSION="$(cat "$SRC/VERSION")"
DIST="$SRC/dist"; mkdir -p "$DIST"
DMG=1; [ "${2:-}" = "--no-dmg" ] && DMG=0

build() {  # $1 = arm64|x86_64
  local arch="$1" label; [ "$arch" = arm64 ] && label=AppleSilicon || label=Intel
  local stage="$SRC/build/$label" app="$SRC/build/$label/BioBook.app"
  rm -rf "$stage"; mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
  cp -R "$SRC/web" "$app/Contents/Resources/"
  cp "$SRC/app/AppIcon.icns" "$SRC/app/BioBook.sdef" "$app/Contents/Resources/"
  mkdir -p "$app/Contents/Resources/de.lproj"   # Titel des Dienste-Menüeintrags auf Deutsch
  printf '"New BioBook entry" = "Neuer BioBook-Eintrag";\n' > "$app/Contents/Resources/de.lproj/InfoPlist.strings"
  cp -R "$SRC/app/Erweiterungen" "$app/Contents/Resources/"
  swiftc -O -target "$arch-apple-macos13" "$SRC"/app/*.swift -o "$app/Contents/MacOS/BioBook"
  cat > "$app/Contents/Info.plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>BioBook</string>
<key>CFBundleDisplayName</key><string>BioBook</string>
<key>CFBundleIdentifier</key><string>de.felix.biobook</string>
<key>CFBundleExecutable</key><string>BioBook</string>
<key>CFBundleIconFile</key><string>AppIcon</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleDevelopmentRegion</key><string>en</string>
<key>CFBundleLocalizations</key><array><string>en</string><string>de</string></array>
<key>CFBundleVersion</key><string>$VERSION</string>
<key>CFBundleShortVersionString</key><string>$VERSION</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>UTExportedTypeDeclarations</key><array><dict>
  <key>UTTypeIdentifier</key><string>de.felix.biobook.book</string>
  <key>UTTypeDescription</key><string>BioBook</string>
  <key>UTTypeConformsTo</key><array><string>com.apple.package</string><string>public.composite-content</string></array>
  <key>UTTypeIconFile</key><string>AppIcon</string>
  <key>UTTypeTagSpecification</key><dict><key>public.filename-extension</key><array><string>biobook</string><string>laborbuch</string></array></dict>
</dict></array>
<key>CFBundleURLTypes</key><array><dict>
  <key>CFBundleURLName</key><string>de.felix.biobook.link</string>
  <key>CFBundleURLSchemes</key><array><string>biobook</string><string>laborbuch</string></array>
</dict></array>
<key>NSAppleScriptEnabled</key><true/>
<key>OSAScriptingDefinition</key><string>BioBook.sdef</string>
<key>NSServices</key><array><dict>
  <key>NSMenuItem</key><dict><key>default</key><string>New BioBook entry</string></dict>
  <key>NSMessage</key><string>newEntryFromService</string>
  <key>NSPortName</key><string>BioBook</string>
  <key>NSSendTypes</key><array><string>public.utf8-plain-text</string><string>NSStringPboardType</string></array>
</dict></array>
<key>NSCameraUsageDescription</key><string>Zum Scannen von Etiketten (QR-Codes) mit der Kamera.</string>
<key>CFBundleDocumentTypes</key><array><dict>
  <key>CFBundleTypeName</key><string>BioBook</string>
  <key>CFBundleTypeRole</key><string>Editor</string>
  <key>LSHandlerRank</key><string>Owner</string>
  <key>LSTypeIsPackage</key><true/>
  <key>LSItemContentTypes</key><array><string>de.felix.biobook.book</string></array>
</dict></array>
</dict></plist>
PL
  codesign --force --deep --sign "${CODESIGN_ID:--}" "$app"
  if [ $DMG = 1 ]; then
    ln -s /Applications "$stage/Applications"
    rm -f "$DIST/BioBook-$label.dmg"
    hdiutil create -quiet -volname BioBook -srcfolder "$stage" -ov -format UDZO "$DIST/BioBook-$label.dmg"
    echo "Fertig: $DIST/BioBook-$label.dmg"
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
