# Erfahrungslog Argon × Claude

Claude trägt nach jedem Review eines Argon-PRs eine Zeile ein. Zeigt sich ein Muster, wird die Stärken-Matrix in `KOLLABORATION.md` angepasst.

| Datum | Issue/PR | Typ | Modell | Ergebnis | Lernpunkt |
|---|---|---|---|---|---|
| 2026-11-04 | #1 / PR #4 | Onboarding (Prozess-Test) | Gemini 4 Argon (Medium) | Sehr gut: Ablauf korrekt (Labels, Branch, PR), Scope genau eingehalten, Out-of-Scope-Punkt nur gemeldet statt geändert. Eigene Umgebung präzise dokumentiert. 3 kleine Nacharbeiten (Präzision, keine Fehler im Ablauf) | Argon hält sich gut an Scope und Prozess, gibt verwertbare Verbesserungsvorschläge. Rückweg über `status:nacharbeit` wird mit dieser Runde getestet |
| 2026-11-04 | #8 / PR #9 | Spezifikations-Audit (langer Kontext, ~200 KB) | Gemini 4 Argon (Medium) | Gut: 18 Befunde mit Fundstellen, Einstufung und Lösungsvorschlägen, Top-10-Tabelle. Stichproben korrekt. 2 Befunde beruhten auf einer Fehllesart der Pseudo-SQL-Notation (fehlendes `NOT NULL` = nullable). Ohne Nacharbeit gemergt | Langer Kontext ist Argons Stärke. Notationskonventionen künftig im Issue nennen. Prozessfehler bei Claude: PR lag 2 h unbemerkt, weil der Check in laufende Arbeit fiel → Check jetzt stündlich und mit Vorrang |
