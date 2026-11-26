#!/usr/bin/env bash
# Legt alle Labels für die Agenten-Zusammenarbeit an (idempotent).
# Aufruf im Repo-Root: bash scripts/setup-labels.sh
set -euo pipefail

create() { gh label create "$1" --color "$2" --description "$3" --force; }

create "agent:argon"        "4285F4" "Offene Aufgabe für Argon (Gemini 4 Argon in Antigravity)"
create "agent:claude"       "D97757" "Offene Aufgabe für Claude (Lead)"
create "status:in-arbeit"   "FBCA04" "Ein Agent arbeitet gerade daran – nicht parallel anfassen"
create "status:nacharbeit"  "E99695" "Review-Feedback liegt vor, Agent soll nacharbeiten"
create "status:review"      "0E8A16" "PR wartet auf Review durch Claude"
create "status:freigegeben" "1D76DB" "Von Claude freigegeben – Owner kann mergen"
create "status:blockiert"   "B60205" "Rückfrage an den Owner nötig (Frage steht im Issue)"
create "modell:flash"       "C5DEF5" "Einfache Aufgabe – Flash-Modell reicht"
create "argon:limit"        "5319E7" "Argons Kontingent aufgebraucht – Claude übernimmt"
create "entscheidung"     "FEF2C0" "Frage an den Owner (Übersicht in docs/UEBERSICHT.md)"
create "dringend"         "B60205" "Entscheidung ist eilig (zusammen mit entscheidung)"
create "schnittstelle"    "5319E7" "Betrifft gemeinsame Verträge oder andere Bereiche – Architekt entscheidet"
create "idee"             "C2E0C6" "Einfall, noch nicht entschieden (Liste in docs/IDEEN.md)"
for b in vorlesung wissen lernen organisation plattform gestaltung; do
  create "bereich:$b"     "BFD4F2" "Gehört zum Bereich $b (docs/bereiche/$b/STAND.md)"
done

echo "Labels angelegt."
