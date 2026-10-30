#!/bin/sh
# The iPhone Shortcut (shortcut/source.ts). `build` writes the unsigned property list to .shortcut-build/; `sign` (macOS only)
# also converts and signs it into public/shortcuts/an-freundebuch.shortcut, which iOS imports, and only then records the source's
# hash next to it. Commit public/shortcuts/ after signing.
set -e
cd "$(dirname "$0")/.."

UPDATE_SHORTCUT=1 npx vitest run shortcut/source.test.ts --silent >/dev/null
[ "$1" = "sign" ] || exit 0

if [ "$(uname)" != "Darwin" ] || ! command -v shortcuts >/dev/null; then
  echo "Signing needs a Mac with the shortcuts command (macOS 12 or later)." >&2
  exit 1
fi
plutil -convert binary1 -o .shortcut-build/an-freundebuch.unsigned.shortcut .shortcut-build/an-freundebuch.plist
shortcuts sign --mode anyone --input .shortcut-build/an-freundebuch.unsigned.shortcut --output public/shortcuts/an-freundebuch.shortcut
SIGNED_SHORTCUT=1 npx vitest run shortcut/source.test.ts --silent >/dev/null
echo "Signed: public/shortcuts/an-freundebuch.shortcut. Commit public/shortcuts/."
