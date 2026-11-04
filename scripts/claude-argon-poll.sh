#!/usr/bin/env bash
# Wartet, bis Argon etwas auf GitHub pusht (neuer oder geänderter Branch argon/*), und beendet sich dann.
# Für Claude: läuft als Hintergrundbefehl in der Claude-Session. Endet das Skript, wird Claude geweckt,
# prüft Argons PR und startet das Skript danach mit dem neuen Stand erneut.
#
# Aufruf:  bash scripts/claude-argon-poll.sh [intervall_s=300] [max_laufzeit_s=6900]
# Ausgabe: "ARGON-AENDERUNG" + geänderte Refs, oder "KEINE-AENDERUNG" nach Ablauf der Laufzeit.
# Kosten:  nur `git ls-remote` alle paar Minuten, keine KI-Aufrufe, keine Token.
set -uo pipefail

interval="${1:-300}"
max_runtime="${2:-6900}"
repo_root="$(cd "$(dirname "$0")/.." && pwd)"

snapshot() {
  # Bei Netzfehlern bis zu 4 Versuche, damit ein kurzer Ausfall nicht als Änderung zählt.
  local out attempt
  for attempt in 1 2 3 4; do
    if out="$(git -C "$repo_root" ls-remote origin 'refs/heads/argon/*' 2>/dev/null)"; then
      printf '%s\n' "$out" | sort
      return 0
    fi
    sleep $((attempt * 5))
  done
  return 1
}

baseline="$(snapshot)" || { echo "FEHLER: GitHub nicht erreichbar"; exit 2; }
start=$(date +%s)

while (( $(date +%s) - start < max_runtime )); do
  sleep "$interval"
  current="$(snapshot)" || continue
  if [[ "$current" != "$baseline" ]]; then
    # Argon öffnet den PR meist kurz nach dem Push – kurz warten, damit er schon existiert.
    sleep 60
    echo "ARGON-AENDERUNG $(date -u +%H:%M:%SZ)"
    diff <(printf '%s\n' "$baseline") <(printf '%s\n' "$(snapshot || printf '%s' "$current")") | grep '^[<>]' || true
    exit 0
  fi
done
echo "KEINE-AENDERUNG $(date -u +%H:%M:%SZ)"
