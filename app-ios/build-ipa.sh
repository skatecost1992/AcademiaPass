#!/usr/bin/env bash
# Compila la app iOS de AcademiaPass en un Mac y deja el .ipa en ../resources/iosapk/
#
# Uso:
#   ./build-ipa.sh TEAM_ID              # TEAM_ID: Xcode > Settings > Accounts > tu equipo (10 caracteres)
#   METHOD=release-testing ./build-ipa.sh TEAM_ID   # Ad Hoc (requiere Apple Developer de pago)
#   METHOD=app-store-connect ./build-ipa.sh TEAM_ID # para subir a TestFlight / App Store
#
# METHOD por defecto: "debugging" (instalable en los iPhone registrados en tu cuenta).
# En Xcode anterior a 15.3 usa METHOD=development.
set -euo pipefail

TEAM_ID="${1:-${TEAM_ID:-}}"
METHOD="${METHOD:-debugging}"
if [[ -z "$TEAM_ID" ]]; then
  echo "Falta el TEAM_ID. Uso: ./build-ipa.sh TEAM_ID" >&2
  exit 1
fi

cd "$(dirname "$0")"
PROJECT_DIR="$(pwd)"
OUT_DIR="$(cd .. && pwd)/resources/iosapk"
BUILD_DIR="$PROJECT_DIR/build"          # temporal, dentro del proyecto; se borra al terminar
VERSION="$(node -p "require('./app.json').expo.version")"
SCHEME="AcademiaPass"

trap 'rm -rf "$BUILD_DIR"' EXIT

# 1) Dependencias y proyecto Xcode (se generan solo si faltan)
[[ -d node_modules ]] || npm install --legacy-peer-deps
[[ -d ios ]] || npx expo prebuild --platform ios

# 2) Archivar
xcodebuild archive \
  -workspace "ios/$SCHEME.xcworkspace" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath "$BUILD_DIR/$SCHEME.xcarchive" \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$TEAM_ID" CODE_SIGN_STYLE=Automatic

# 3) Exportar el .ipa
cat > "$BUILD_DIR/ExportOptions.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>$METHOD</string>
  <key>teamID</key><string>$TEAM_ID</string>
  <key>signingStyle</key><string>automatic</string>
  <key>compileBitcode</key><false/>
</dict>
</plist>
EOF

xcodebuild -exportArchive \
  -archivePath "$BUILD_DIR/$SCHEME.xcarchive" \
  -exportOptionsPlist "$BUILD_DIR/ExportOptions.plist" \
  -exportPath "$BUILD_DIR/export" \
  -allowProvisioningUpdates

mkdir -p "$OUT_DIR"
cp "$BUILD_DIR/export/"*.ipa "$OUT_DIR/AcademiaPass-$VERSION.ipa"
echo "IPA listo: $OUT_DIR/AcademiaPass-$VERSION.ipa"
