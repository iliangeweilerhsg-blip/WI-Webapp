#!/usr/bin/env bash
# Erzeugt apps/ipad/StudienGehirn.xcodeproj aus project.yml (XcodeGen).
# Aufruf: bash apps/ipad/scripts/projekt-erzeugen.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v xcodegen >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    echo "XcodeGen fehlt, installiere es mit Homebrew …"
    HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 brew install xcodegen
  else
    echo "XcodeGen fehlt. Installiere zuerst Homebrew (https://brew.sh), dann: brew install xcodegen" >&2
    exit 1
  fi
fi

xcodegen generate --spec project.yml
echo "Fertig. Öffnen mit: open apps/ipad/StudienGehirn.xcodeproj"
