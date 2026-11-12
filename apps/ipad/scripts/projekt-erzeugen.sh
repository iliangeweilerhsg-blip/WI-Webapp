#!/usr/bin/env bash
# Erzeugt apps/ipad/StudienGehirn.xcodeproj aus project.yml (XcodeGen).
# Aufruf: bash apps/ipad/scripts/projekt-erzeugen.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# TunnelShared kommt per Symlink aus dem Mac-Helfer (UX-12 PR 4, project.yml). Er muss genau dorthin zeigen und darf
# nichts von außerhalb des Repos in die App holen (Gegen-Review PR #276). Ohne Symlinks ausgecheckt
# (git config core.symlinks false) ist er nur eine Textdatei: dann klar abbrechen statt still ohne Quellen zu bauen.
tunnel_link="TunnelShared"
tunnel_target="../mac-tunnel/Sources/TunnelShared"
if [ ! -L "$tunnel_link" ] || [ "$(readlink "$tunnel_link")" != "$tunnel_target" ] || [ ! -d "$tunnel_target" ]; then
  echo "apps/ipad/$tunnel_link muss ein Symlink auf $tunnel_target sein (git config core.symlinks true, neu auschecken)." >&2
  exit 1
fi
if [ -n "$(find "$tunnel_target" -type l)" ]; then
  echo "In apps/mac-tunnel/Sources/TunnelShared liegen Symlinks. Erlaubt sind nur echte Dateien." >&2
  exit 1
fi

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
