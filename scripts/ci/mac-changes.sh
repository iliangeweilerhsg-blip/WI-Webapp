#!/usr/bin/env bash
# Entscheidet auf Linux, welche macOS-Jobs der CI laufen müssen (spart macOS-Runner).
# Ausgabe: ipad=true|false, spike_p2p=true|false, mac_tunnel=true|false (in $GITHUB_OUTPUT, sonst stdout).
# Im PR ist HEAD der Merge-Commit, HEAD^1 der Stand von main: Der Unterschied ist genau der PR.
# Auf main (push), bei anderen Ereignissen oder wenn sich der Diff nicht bestimmen lässt, laufen immer alle Jobs.
# Änderungen am Workflow oder an scripts/ci/ lassen ebenfalls alle Jobs laufen.
set -u -o pipefail

out="${GITHUB_OUTPUT:-/dev/stdout}"
common='\.github/workflows/ci\.yml$|scripts/ci/'
pat_ipad="^(apps/ipad/|packages/schemas/swift-support/|packages/schemas/generated/swift/|apps/mac-tunnel/Sources/TunnelShared/|${common})"
pat_spike="^(spikes/s6-p2p/|${common})"
pat_tunnel="^(apps/mac-tunnel/|${common})"

emit() {
  echo "ipad=$1" >> "$out"
  echo "spike_p2p=$2" >> "$out"
  echo "mac_tunnel=$3" >> "$out"
}

if [ "${GITHUB_EVENT_NAME:-pull_request}" != "pull_request" ]; then
  echo "Kein Pull Request: alle macOS-Jobs laufen."
  emit true true true
  exit 0
fi
# HEAD muss der Merge-Commit des PR sein (zwei Eltern), sonst zeigte HEAD^1..HEAD nur den letzten Commit.
# -z: Pfade mit Umlauten o. Ä. kommen sonst in Anführungszeichen ("apps/ipad/…") und träfen kein Muster.
if ! git rev-parse -q --verify 'HEAD^2' >/dev/null \
  || ! files="$(git diff -z --name-only HEAD^1 HEAD 2>/dev/null | tr '\0' '\n')"; then
  echo "Diff nicht bestimmbar: alle macOS-Jobs laufen."
  emit true true true
  exit 0
fi

check() { if grep -qE "$1" <<<"$files"; then echo true; else echo false; fi; }
i="$(check "$pat_ipad")"
s="$(check "$pat_spike")"
t="$(check "$pat_tunnel")"
echo "iPad-App: $i, Spike S6: $s, Mac-Helfer: $t"
emit "$i" "$s" "$t"
