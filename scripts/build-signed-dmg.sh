#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# OrangeGel — macOS Apple Developer Signed & Notarized DMG Builder
# ==============================================================================
# Builds the Angular production bundle + Tauri v2 macOS .app and .dmg with
# Apple Hardened Runtime + Entitlements.plist, signs with Developer ID
# Application certificate, optionally notarizes + staples via xcrun notarytool,
# and verifies the bundle via codesign and spctl.
# ==============================================================================

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENTITLEMENTS_PATH="$ROOT_DIR/src-tauri/Entitlements.plist"
MASTER_ICON="$ROOT_DIR/assets/brand/orangegel-icon-1024.png"
DMG_BG="$ROOT_DIR/assets/brand/dmg-background.png"

echo "==> [1/5] Preparing OrangeGel macOS icons & DMG assets..."
if [[ -f "$DMG_BG" ]]; then
  cp "$DMG_BG" "$ROOT_DIR/src-tauri/icons/dmg-background.png"
fi

if [[ -f "$MASTER_ICON" ]] && command -v npx >/dev/null 2>&1; then
  npx tauri icon "$MASTER_ICON" || true
fi

echo "==> [2/5] Discovering Apple Developer ID Application signing identity..."
if [[ -z "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  DETECTED_ID="$(security find-identity -v -p codesigning 2>/dev/null | grep 'Developer ID Application:' | head -n 1 | sed -E 's/.*"([^"]+)".*/\1/' || true)"
  if [[ -n "$DETECTED_ID" ]]; then
    export APPLE_SIGNING_IDENTITY="$DETECTED_ID"
    echo "    Found Developer ID Application certificate: $APPLE_SIGNING_IDENTITY"
  else
    echo "    No 'Developer ID Application' certificate found in Keychain; using ad-hoc signing (-)."
    export APPLE_SIGNING_IDENTITY="-"
  fi
else
  echo "    Using explicit APPLE_SIGNING_IDENTITY: $APPLE_SIGNING_IDENTITY"
fi

echo "==> [3/5] Building OrangeGel Tauri v2 .app and .dmg bundles..."
npx tauri build --bundles app,dmg

BUNDLE_DIR="$ROOT_DIR/src-tauri/target/release/bundle"
APP_BUNDLE="$(find "$BUNDLE_DIR/macos" -maxdepth 1 -name "*.app" | head -n 1)"
DMG_BUNDLE="$(find "$BUNDLE_DIR/dmg" -maxdepth 1 -name "*.dmg" | head -n 1)"

if [[ -z "$APP_BUNDLE" || ! -d "$APP_BUNDLE" ]]; then
  echo "ERROR: Built .app bundle not found under $BUNDLE_DIR/macos" >&2
  exit 1
fi

echo "==> [4/5] Applying Hardened Runtime signature & Entitlements..."
codesign --force --deep --options runtime \
  --entitlements "$ENTITLEMENTS_PATH" \
  --sign "$APPLE_SIGNING_IDENTITY" \
  "$APP_BUNDLE"

echo "    Verifying .app code signature..."
codesign --verify --deep --strict --verbose=2 "$APP_BUNDLE"

if [[ "$APPLE_SIGNING_IDENTITY" != "-" ]]; then
  spctl -a -t exec -vv "$APP_BUNDLE" || true
fi

if [[ -n "$DMG_BUNDLE" && -f "$DMG_BUNDLE" ]]; then
  codesign --force --sign "$APPLE_SIGNING_IDENTITY" "$DMG_BUNDLE"
  codesign --verify --verbose=2 "$DMG_BUNDLE"
fi

echo "==> [5/5] Checking optional Apple Notary Service credentials..."
if [[ "$APPLE_SIGNING_IDENTITY" != "-" && -n "$DMG_BUNDLE" ]]; then
  if [[ -n "${APPLE_API_KEY:-}" && -n "${APPLE_API_ISSUER:-}" && -n "${APPLE_API_KEY_PATH:-}" ]]; then
    echo "    Submitting $DMG_BUNDLE to Apple Notary Service (API Key)..."
    xcrun notarytool submit "$DMG_BUNDLE" \
      --key "$APPLE_API_KEY_PATH" \
      --key-id "$APPLE_API_KEY" \
      --issuer "$APPLE_API_ISSUER" \
      --wait
    xcrun stapler staple "$DMG_BUNDLE"
  elif [[ -n "${APPLE_ID:-}" && -n "${APPLE_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" ]]; then
    echo "    Submitting $DMG_BUNDLE to Apple Notary Service (Apple ID)..."
    xcrun notarytool submit "$DMG_BUNDLE" \
      --apple-id "$APPLE_ID" \
      --password "$APPLE_PASSWORD" \
      --team-id "$APPLE_TEAM_ID" \
      --wait
    xcrun stapler staple "$DMG_BUNDLE"
  else
    echo "    Skipping notarization (set APPLE_ID/APPLE_PASSWORD/APPLE_TEAM_ID or APPLE_API_KEY/APPLE_API_ISSUER/APPLE_API_KEY_PATH to notarize)."
  fi
fi

echo "==> Build complete!"
echo "    App Bundle: $APP_BUNDLE"
echo "    DMG Bundle: ${DMG_BUNDLE:-N/A}"
