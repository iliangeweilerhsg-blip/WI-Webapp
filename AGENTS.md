# AGENTS.md – Gemeinsame Regeln für alle KI-Agenten

Dieses Repository wird von mehreren KI-Agenten gemeinsam mit dem Menschen (Repo-Owner) entwickelt.
Diese Datei gilt für **alle** Agenten. `CLAUDE.md` und `GEMINI.md` ergänzen nur rollenspezifische Punkte.

## Rollen

| Rolle | Wer | Wo / wie | Verantwortung |
|---|---|---|---|
| **Owner** | Mensch | GitHub | Ziele setzen, Entscheidungen, **Merges nach `main`** |
| **Lead** | Claude | Claude Code (Claude-Abo, Cloud-Sessions) | Architektur, Aufgaben zerlegen und verteilen, Reviews, Integration, CI |
| **Spezialist** | Argon (Gemini 4 Argon) | Google Antigravity (Gemini-Abo, auf dem Rechner des Owners) | Bearbeitet die Issue-Queue mit Label `agent:argon` |
| **Worker** | Claude-Subagents | vom Lead gestartet, eigene Worktrees/Branches | Parallele Feature-Arbeit |

Claude und Argon können sich nicht direkt aufrufen. **GitHub ist die einzige Schnittstelle:**
Aufgaben sind Issues, Ergebnisse sind Pull Requests, Feedback sind Kommentare.
Details: [`docs/KOLLABORATION.md`](docs/KOLLABORATION.md).

## Labels

Anlegen mit `bash scripts/setup-labels.sh`.

| Label | Wo | Bedeutung | Setzt |
|---|---|---|---|
| `agent:argon` / `agent:claude` | Issue | Offene Aufgabe für diesen Agenten | Claude |
| `status:in-arbeit` | Issue | Ein Agent arbeitet gerade daran – nicht parallel anfassen | bearbeitender Agent |
| `status:nacharbeit` | Issue | Review-Feedback liegt vor, bitte nacharbeiten (zusammen mit `agent:…`) | Claude |
| `status:blockiert` | Issue | Rückfrage an den Owner (Frage steht im Issue) | Agent; Owner entfernt es nach der Antwort |
| `status:review` | PR | Wartet auf Review durch Claude | PR-Autor |
| `status:freigegeben` | PR | Claude hat freigegeben und merged
| `modell:flash` | Issue | Einfache Aufgabe, Flash-Modell reicht | Claude |
| `argon:limit` | Issue | Argons Kontingent war aufgebraucht – Claude übernimmt | Argon oder Owner |

**Gleiches GitHub-Konto:** Beide Agenten schreiben über den Account des Owners. Darum beginnt jeder Kommentar
mit `**[Claude]**` / `**[Claude-Review]**` bzw. `**[Argon]**`. Freigaben laufen über das Label `status:freigegeben`,
nicht über GitHub-Approvals (eigene PRs kann man auf GitHub nicht approven).

## Grundregeln

1. **Kein Agent pusht direkt auf `main`.** Jede Änderung kommt per Pull Request; gemergt wird nur von Claude (nach den Merge-Regeln in CLAUDE.md). Argon merged nie. Der Owner kann per Label status:halt ein Veto einlegen.
2. **Ein Task = ein Branch = ein PR.** Branch-Namen:
   - `claude/<kurzbeschreibung>` – Lead
   - `argon/issue-<nr>` – Argon
   - `feat/<kurzbeschreibung>` – Worker-Subagents
3. **Nur im eigenen Scope arbeiten.** Jeder Task nennt die Dateien/Ordner, die er ändern darf („Scope“). Dateien außerhalb nicht anfassen – stattdessen im PR unter „Offene Punkte“ notieren.
4. **Schnittstellen zuerst.** Gemeinsam genutzte Typen, API-Verträge und Datenmodelle legt der Lead fest, bevor parallel gearbeitet wird. Agenten ändern diese Verträge nicht eigenmächtig.
5. **Status pflegen.** Beim Start `status:in-arbeit` setzen, beim Abschluss wieder entfernen. Hängt `status:in-arbeit` ohne Aktivität fest (abgebrochene Session), entfernt der Owner oder Claude es.
6. **Kleine PRs.** Lieber mehrere kleine als einen großen.
7. **Akzeptanzkriterien erfüllen.** Ein PR ist erst fertig, wenn alle Kriterien aus dem Issue erfüllt sind und die Checks (Build, Lint, Tests – sobald vorhanden) grün sind.
8. **Keine Secrets** in Code, Commits, Issues oder PR-Texten.
9. **Keine neuen Abhängigkeiten** ohne Begründung im PR.
10. **Ehrlich berichten.** Was nicht getestet wurde oder nicht funktioniert, steht im PR – nichts schönreden.
11. **Bei Unklarheit nicht raten:** Frage ins Issue schreiben, `status:blockiert` setzen, mit dem nächsten Task weitermachen.
12. **Abhängigkeiten:** Ein Issue mit „Abhängig von #X“ erst bearbeiten, wenn der PR zu #X gemergt ist.
13. **Übernahme bei Argon-Limit:** Siehe `docs/KOLLABORATION.md`, Abschnitt „Fallback“. Claude arbeitet dann auf Argons Branch weiter. Die Arbeit geht nie verloren, weil Argon Zwischenstände pusht.

## PR-Beschreibung (Pflichtinhalt)

- **Was** wurde geändert und **warum** (Bezug: `Closes #<issue>`)
- **Wie getestet**
- **Offene Punkte / Risiken**
- Bei UI-Änderungen: Screenshot
- Letzte Zeile: `Erstellt von: Claude` bzw. `Erstellt von: Argon` (damit Reviews klar zugeordnet sind)

## Projekt-Konventionen

> Wird ergänzt, sobald der Tech-Stack feststeht (Sprache, Framework, Ordnerstruktur, Befehle für Build/Test/Lint).
