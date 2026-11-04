#!/usr/bin/env bash
# Wartet, bis in der Argon-Queue Arbeit liegt, und beendet sich dann.
# Argon startet das Skript in Antigravity als Hintergrund-Task. Endet es,
# weckt Antigravity Argon automatisch auf, und Argon arbeitet die Queue ab.
#
# Aufruf: bash scripts/argon-watch.sh [intervall-sekunden]   (Standard: 300)
# Exit 0 = Arbeit da, Exit 2 = GitHub-Login-Problem, Exit 3 = Höchstdauer erreicht
set -u
INTERVAL="${1:-300}"
MAX_HOURS="${ARGON_WATCH_MAX_HOURS:-12}"
cd "$(dirname "$0")/.." || exit 1
start=$(date +%s)

while true; do
  if ! n=$(gh issue list --state open --limit 100 \
        --search "label:agent:argon -label:status:blockiert -label:status:in-arbeit" \
        --json number --jq length 2>/dev/null); then
    echo "FEHLER: gh-Abfrage fehlgeschlagen (Login abgelaufen? -> gh auth status)"
    exit 2
  fi
  if [ "$n" -gt 0 ]; then
    echo "ARBEIT: $n Issue(s) in der Argon-Queue"
    exit 0
  fi
  if [ $(( $(date +%s) - start )) -ge $(( MAX_HOURS * 3600 )) ]; then
    echo "ENDE: ${MAX_HOURS} Stunden ohne neue Arbeit"
    exit 3
  fi
  sleep "$INTERVAL"
done
