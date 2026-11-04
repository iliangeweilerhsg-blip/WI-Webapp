#!/usr/bin/env bash
# Wartet, bis Argon etwas auf GitHub pusht (Branch argon/* neu, geändert oder gelöscht), und beendet
# sich dann. Für Claude: läuft als Hintergrundbefehl in der Claude-Session. Endet das Skript, wird
# Claude geweckt, prüft Argons PR und startet das Skript erneut.
#
# Aufruf:  bash scripts/claude-argon-poll.sh [intervall_s=300] [max_laufzeit_s=6600] [--neu]
# Ausgabe: "ARGON-AENDERUNG" + NEU/GEAENDERT/GELOESCHT je Branch, sonst "KEINE-AENDERUNG" bzw. "FEHLER".
# Kosten:  nur `git ls-remote` alle paar Minuten, keine KI-Aufrufe, keine Token.
#
# Der zuletzt gemeldete Stand liegt in <git-dir>/argon-poll.state. Ein Push zwischen zwei Läufen
# (z. B. während Claude reviewt) wird beim nächsten Start sofort gemeldet. `--neu` setzt den Stand zurück.
# Zeitbudget: Das Skript endet sicher vor 7200 s (Grenze für Hintergrundbefehle der Session).
set -uo pipefail
export GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=true SSH_ASKPASS=true GCM_INTERACTIVE=never
export GIT_SSH_COMMAND="ssh -o BatchMode=yes"
export LC_ALL=C # gleiche Sortierung für sort/join in jedem Lauf

t0=$(date +%s)
interval=300
max_runtime=6600
reset=0
positional=()
for arg in "$@"; do
  if [[ $arg == --neu ]]; then reset=1; else positional+=("$arg"); fi
done
[[ ${#positional[@]} -ge 1 ]] && interval="${positional[0]}"
[[ ${#positional[@]} -ge 2 ]] && max_runtime="${positional[1]}"
if ! [[ $interval =~ ^[1-9][0-9]*$ && $max_runtime =~ ^[1-9][0-9]*$ ]]; then
  echo "FEHLER: Intervall und Laufzeit müssen ganze Sekunden > 0 sein"
  exit 2
fi
deadline=$((t0 + max_runtime))

repo_root="$(CDPATH='' cd -- "$(dirname -- "$0")/.." >/dev/null && pwd)"
git_dir="$(git -C "$repo_root" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" ||
  { echo "FEHLER: kein Git-Repo in $repo_root"; exit 2; }
state_file="$git_dir/argon-poll.state"
failures=0
checks=0

# Ein Abfrageversuch mit Zeitgrenze; Ausgabe sortiert nach Branchname.
query() {
  local out
  out="$(timeout 20 git -C "$repo_root" -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=15 \
    ls-remote origin 'refs/heads/argon/*' </dev/null 2>/dev/null)" || return 1
  printf '%s\n' "$out" | { grep -E '^[0-9a-f]+[[:space:]]' || true; } | sort -k2
}

# Bis zu `tries` Versuche, damit ein kurzer Ausfall nicht als Änderung zählt.
snapshot() {
  local tries="${1:-4}" attempt
  for ((attempt = 1; attempt <= tries; attempt++)); do
    if query; then return 0; fi
    ((attempt < tries)) && sleep $((attempt * 5))
  done
  return 1
}

report() {
  local before="$1" after="$2"
  echo "ARGON-AENDERUNG $(date -u +%H:%M:%SZ)"
  join -1 2 -2 2 -a 1 -a 2 -e '-' -o '0,1.1,2.1' \
    <(printf '%s\n' "$before" | grep . | sort -k2) <(printf '%s\n' "$after" | grep . | sort -k2) |
    while read -r ref old new; do
      if [[ $old == - ]]; then
        echo "NEU        $ref ${new:0:9}"
      elif [[ $new == - ]]; then
        echo "GELOESCHT  $ref"
      elif [[ $old != "$new" ]]; then
        echo "GEAENDERT  $ref ${old:0:9} -> ${new:0:9}"
      fi
    done
  printf '%s\n' "$after" >"$state_file"
}

current="$(snapshot)" || { echo "FEHLER: GitHub nicht erreichbar $(date -u +%H:%M:%SZ)"; exit 2; }
if ((reset == 0)) && [[ -f $state_file ]]; then
  baseline="$(cat "$state_file")"
  if [[ "$current" != "$baseline" ]]; then
    report "$baseline" "$current" # Push seit dem letzten Lauf
    exit 0
  fi
else
  printf '%s\n' "$current" >"$state_file"
  baseline="$current"
fi

while :; do
  rest=$((deadline - $(date +%s)))
  ((rest <= 0)) && break
  sleep $((rest < interval ? rest : interval))
  checks=$((checks + 1))
  if ! current="$(snapshot 2)"; then
    failures=$((failures + 1))
    continue
  fi
  if [[ "$current" != "$baseline" ]]; then
    # Argon öffnet den PR meist kurz nach dem Push – kurz warten, damit er schon existiert.
    sleep 60
    after="$(query)" || after="$current"
    report "$baseline" "$after"
    exit 0
  fi
done
echo "KEINE-AENDERUNG $(date -u +%H:%M:%SZ) ($failures von $checks Abfragen gescheitert)"
