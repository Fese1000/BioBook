#!/bin/bash
# Erzeugt build/mock/index.html: die echte Oberfläche mit nachgebauter Brücke, zum Testen im Browser.
set -e
SRC="$(cd "$(dirname "$0")/.." && pwd)"; OUT="$SRC/build/mock"
rm -rf "$OUT"; mkdir -p "$OUT"; cp -R "$SRC/web/." "$OUT/"; cp "$SRC/tests/mock-bridge.js" "$OUT/"
sed -i '' 's#<script src="vendor/tiptap.js">#<script src="mock-bridge.js"></script><script src="vendor/tiptap.js">#' "$OUT/index.html"
echo "$OUT/index.html"
