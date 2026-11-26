# Arbeitsstruktur: Bereiche, Rollen und gemeinsames Gedächtnis

> **Status: Entwurf zur Freigabe durch den Owner.** Bis zur Freigabe gelten weiter `CLAUDE.md`, `AGENTS.md` und `docs/KOLLABORATION.md`. Nach der Freigabe ersetzt dieses Dokument dort die Abschnitte zu Lead, Tagesrhythmus und Ruhemodus. Was weiter gilt, steht in Abschnitt 10.

## 1. Warum umbauen

Bisher lief fast alles in **einer** Lead-Session: Gespräche mit dem Owner, Meldungen der Subagents und ein stündlicher Takt. Das hatte drei Folgen:

- **Teuer.** Ein langer Verlauf wird bei jeder Antwort mitgeschleppt. Der Takt meldete tagelang „nichts zu tun“ und kostete trotzdem.
- **Unübersichtlich.** Agent-Meldungen landen mitten im Gespräch, für Konzeptarbeit ist kein Platz.
- **Vergesslich.** Lange Verläufe werden zusammengefasst, dabei gehen Details verloren („context rot“).

Die neue Struktur folgt drei Vorbildern:
- **Softwareteams:** Schnitt nach Fachgebiet, ein Besitzer pro Schnittstelle, wenig gleichzeitig.
- **Agent-Workflows:** Orchestrator mit Workern in getrenntem Kontext.
- **Anthropics Empfehlungen:**
  - Kontext klein halten.
  - Erst die Spec schreiben, dann in einer frischen Session bauen.
  - Austausch über Dateien statt über Nachrichten.
  - Jede Aufgabe mit einem Check abschließen, der eindeutig bestanden oder nicht bestanden meldet.

## 2. Grundsätze (und warum)

| # | Grundsatz | Warum |
|---|---|---|
| G1 | **Ein Ort für jede Wahrheit:** Repo und GitHub, nie nur der Chat | Jede Session liest dieselben Dateien. Alles ist versioniert und übersteht jeden Neustart |
| G2 | **Ein Besitzer pro Schnittstelle** | Ändern zwei dieselbe Stelle gleichzeitig, entstehen Brüche (Conways Gesetz) |
| G3 | **Wenig gleichzeitig, dafür fertig** | Der Engpass ist die Aufmerksamkeit des Owners. Mehr Parallelität erzeugt nur eine längere Warteschlange |
| G4 | **Eindeutiger Check** (Tests, CI, Review) | KI arbeitet am besten, wenn sie selbst prüfen kann, ob etwas stimmt |
| G5 | **Kleiner, frischer Kontext pro Aufgabe** | Qualität sinkt mit der Länge des Kontexts, Kosten steigen |
| G6 | **Denken und Bauen trennen** | Konzeptarbeit braucht Ruhe, Bauen erzeugt Lärm |

## 3. Rollen

```
            Owner
              │
      Architekt (Vertretung)            Pfleger (Gedächtnis)
              │
   ┌──────────┼──────────┐
 Lead A     Lead B     (ruhende Bereiche)
 Gespräch    Gespräch
 Bau         Bau
   │           │
 Worker, Reviewer (Subagents)
```

| Rolle | Wo | Aufgabe | Modell | Warum so |
|---|---|---|---|---|
| **Owner** | überall | Ziele, Prioritäten, Entscheidungen über Produkt, Kosten und Datenschutz | – | Wertungen gehören dem Menschen |
| **Architekt (Vertretung des Owners)** | eigene Session, **nur bei Bedarf** | Gesprächspartner des Owners für alles Übergreifende: Richtung, Prioritäten, neue Ideen, Änderungen an der Spezifikation. Er besitzt `docs/spezifikation/`, `VERTRAEGE.md`, Schemas, Migrationen sowie die Merge- und Sicherheitsregeln. Er löst Konflikte zwischen Bereichen, bündelt die Fragen an den Owner und sortiert die Ideenliste | Opus | Ein Besitzer für alles Gemeinsame (G2). Läuft nicht dauernd, weil Koordination teuer ist |
| **Bereichs-Lead, Gespräch** | eine Session pro Bereich und Thema | Bespricht Ideen mit dem Owner und schreibt die Spec. Startet **keine** Worker | Fable oder Opus | Ruhiger Raum für Konzepte (G6) |
| **Bereichs-Lead, Bau** | **frische** Session pro Spec | Zerlegt in Aufgaben, startet Worker, lässt prüfen, merged, pflegt `STAND.md` | Opus | Sauberer, kleiner Kontext (G5) |
| **Worker** | Subagent im eigenen Worktree | Setzt **eine** Aufgabe um, mit Tests | Sonnet | Günstig ausführen, wo Tests die Fehler finden |
| **Reviewer** | frischer Subagent | Unabhängiges Review nach Risikostufe (KOLLABORATION §4a) | Opus, bei Doku Sonnet | Gegenblick ohne Vorprägung |
| **Pfleger** | geplante Aufgabe, täglich | Verdichtet die Stand-Dateien und schreibt `UEBERSICHT.md`. Meldet Widersprüche und Leichen. Ändert **keinen Code** und entscheidet nichts | Sonnet | Hält das Gedächtnis aktuell (G1). Er trägt keine Nachrichten weiter, weil das Stille Post wäre |

**Begriffe:**
- **Feature:** das, was der Owner als Nutzer merkt. Dazu gehört genau eine Spec.
- **Aufgabe:** das Stück, das eine Session ohne Zusammenfassung fertig bekommt. Sie hat ein Ziel, einen Check und etwa einen PR.
- Ein Feature hat meist mehrere Aufgaben. Beispiel Strichformat v2: Vertrag, Core, Web, iPad.

## 4. Bereiche

Geschnitten nach **Fachgebiet**, nicht nach Technik. *Warum:* Fast jedes Feature berührt iPad, Core und Web. Ein Schnitt nach Technik würde jedes Feature auf drei Leads verteilen.

| Bereich | Inhalt | Grobe Code-Orte (Orientierung, keine harte Grenze) |
|---|---|---|
| **vorlesung** | Aufnahme, Transkription, Folien in der Vorlesung, iPad-Notizen und Tinte | `apps/ipad/`, `apps/web/src/app/session`, `…/dokument`, `apps/web/src/components/ink`, Core `sessions`, `recordings`, `transcript`, `notebooks`, `pages`, `photos`, `material` |
| **wissen** | Suche ⌘K, Konzepte, Inbox, Zusammenfassungen, Rückblick | `…/inbox`, `…/rueckblick`, `components/search`, Core `search`, `concepts`, `inbox`, `summary`, `costs`, Worker-Jobs dazu |
| **lernen** | Karten und Wiederholung | `…/lernen`, Core `cards`, `review` |
| **organisation** | Moodle, Abgaben, Fristen, Kalender, Planer | `…/abgabe`, `…/kalender`, `…/planer`, Core `moodle`, `calendar`, `organisation` |
| **plattform** | `sg`-Start, Sync Mac und iPad, Kopplung, Backup, Papierkorb, Sicherheit, CI, Mac-Helfer | `apps/mac-tunnel/`, `infra/`, `scripts/`, Core `devices`, `backups`, `trash`, `system`, `settings` |
| **gestaltung** | Designsprache für das ganze Projekt: Aussehen (Farben, Schrift, Abstände, Bausteine), Bedienung und Wirkung (Abläufe, Tonfall, User-Experience), Einheitlichkeit zwischen Web, Mac und iPad, UX-Durchläufe | `packages/ui-tokens/`, gemeinsame UI-Bausteine, `docs/ux/` (u. a. `MARKENKERN.md`, `DESIGN-FAHRPLAN.md`, `DESIGN-ENTSCHEIDUNGEN.md`) |

### Sonderrolle gestaltung

Gestaltung ist ein **Querschnittsbereich.** Er liefert die Designsprache und Bausteine, die anderen Bereiche bauen ihre Bildschirme damit selbst. *Warum:* Würde gestaltung jede Oberfläche selbst bauen, bräuchte jedes Feature zwei Bereiche. In Softwareteams heißt dieses Muster „Design-System-Team“ oder „Enabling Team“.

- **Zuerst die Designsprache, unabhängig vom Rest.** Sie kann entstehen, ohne dass andere Bereiche warten.
- **Früh an einer echten Ansicht erproben,** z. B. an der Vorlesungsansicht. Dann anpassen und erst danach ausrollen. *Warum:* Eine Designsprache, die lange nur auf dem Papier entsteht, passt später oft nicht zu den echten Abläufen. Kurze Rückmeldung schlägt den großen Wurf (G4).
- **In jeder Spec** gibt es ein Feld „Gestaltung“. Bei größeren Oberflächen holt der Lead dort einen kurzen Gestaltungs-Check ein.
- **Für die Grenze „höchstens zwei aktiv“** zählt gestaltung nur, wenn sie an eigenen Specs arbeitet, nicht für kurze Checks.

**Gemeinsam und im Besitz des Architekten:**
- `docs/spezifikation/`: die Wahrheit darüber, wie das Produkt sein soll (siehe Abschnitt 6a)
- `docs/VERTRAEGE.md`
- `packages/schemas/` und `packages/shared/`
- Migrationen
- `package.json` und Lockfile
- CI
- `CLAUDE.md`, `AGENTS.md`

**Höchstens zwei Bereiche gleichzeitig aktiv** (G3). Die übrigen ruhen mit gepflegter Stand-Datei. Welche aktiv sind, legt der Owner fest und es steht in `UEBERSICHT.md`.

## 5. Gemeinsames Gedächtnis im Repo

```
docs/
  UEBERSICHT.md                 1 Seite, schreibt der Pfleger
  IDEEN.md                      Eingang für Einfälle (Abschnitt 6b)
  spezifikation/                wie das Produkt sein soll, Besitz: Architekt
  VERTRAEGE.md                  Besitz: Architekt
  bereiche/<bereich>/
    STAND.md                    höchstens 1 Seite, schreibt der Bau-Lead
    ENTSCHEIDUNGEN.md           kurze Einträge, schreiben Gesprächs- und Bau-Lead
    specs/<feature>.md          Ergebnis des Gesprächs
```

- **Jede Session startet mit:** `UEBERSICHT.md`, dem eigenen `STAND.md` und den betroffenen Abschnitten aus `VERTRAEGE.md`. Ganze Dokumente lädt sie nicht. *Warum:* G5.
- **Öffentliches Repo:** keine Geheimnisse, keine Vorlesungsinhalte, keine persönlichen Daten. Persönliches bleibt im Chat.

### Vorlage `STAND.md`

```markdown
# Stand: <bereich>   (zuletzt: <Datum>, <wer>)

## Läuft
- <Feature/Aufgabe> – PR #… / Issue #… – <ein Satz zum Stand>

## Fertig seit letzter Übersicht
- <was> (#PR)

## Wartet auf den Owner
- <Frage> → Issue #… (Empfehlung: …)

## Schnittstellen, die andere Bereiche betreffen
- <Änderung> → Issue #… (Label `schnittstelle`)

## Als Nächstes
1. …
```

### Vorlage `ENTSCHEIDUNGEN.md` (nach dem Muster „Architecture Decision Record“)

```markdown
## <Datum> – <Titel>
- **Entscheidung:** …
- **Warum:** …
- **Verworfen:** … (weil …)
- **Quelle:** Issue/PR #…, entschieden von <Owner|Architekt|Lead>
```

*Warum:* Später weiß man noch, **warum** etwas so ist, und muss die Frage nicht neu diskutieren.

### Vorlage Spec `specs/<feature>.md`

```markdown
# <Feature>
- **Ziel (Nutzersicht):** …
- **Nicht Teil davon:** …
- **Ablauf/Verhalten:** …
- **Gestaltung:** genutzte Bausteine und Regeln der Designsprache, ggf. Gestaltungs-Check (ja/nein, Ergebnis)
- **Schnittstellen:** neue/geänderte Verträge (§…) → Architekt
- **Aufgaben:** 1. … 2. … (je ein PR, je ein Check)
- **Akzeptanzkriterien:** prüfbar, eindeutig bestanden oder nicht bestanden
- **Offene Fragen:** …
- **Freigabe Owner:** <Datum> / offen
```

## 6. Zusammenarbeit

1. **Austausch nur über GitHub und Dateien.** Braucht ein Bereich etwas vom anderen oder ändert er eine gemeinsame Schnittstelle, legt er ein Issue mit Label `schnittstelle` an. Der Architekt entscheidet. Nachrichten zwischen Sessions sind nur kurze Hinweise wie „siehe #123“. *Warum:* Das ist nachvollziehbar und übersteht Neustarts. Kein Stille-Post-Effekt.
2. **Neue Labels:** `bereich:<name>` an jedem Issue und PR, dazu `schnittstelle`. *Warum:* Der Pfleger und jeder Lead finden ihren Teil mit einer Abfrage.
3. **Branches:** `feat/<bereich>-<kurz>` für Worker, `claude/<bereich>-<kurz>` für Leads. *Warum:* Man sieht sofort, wem ein Branch gehört.
4. **Fertig heißt:**
   - Akzeptanzkriterien der Spec sind erfüllt.
   - Die CI ist grün.
   - Es gab ein unabhängiges Review nach Stufe A oder B.
   - `STAND.md` ist aktualisiert.
   - Gemergt wird nach den bestehenden Merge-Regeln (`CLAUDE.md`).

## 6a. Grundsätzliche Änderungen am Produkt

Die **Spezifikation** (`docs/spezifikation/`) ist die eine Wahrheit darüber, wie das Produkt sein soll (G1).

1. Der Owner bespricht die Änderung mit dem **Architekten** und trägt sie nicht selbst ein.
2. Der Architekt trägt sie in die Spezifikation ein. Er prüft dabei die Folgen: betroffene Verträge, laufende Specs und Bereiche.
3. Er hält die Entscheidung mit Grund fest, in `ENTSCHEIDUNGEN.md` des betroffenen Bereichs oder als geschlossenes `entscheidung`-Issue.
4. Betroffene Bereiche bekommen einen Hinweis in ihrer `STAND.md`.

*Warum:* Eine Änderung an der Produktidee hat oft Folgen an Stellen, die man nicht im Kopf hat. Wer sie einträgt, sollte das Ganze kennen. Eine Entscheidung, die nur im Chat fällt, kennt der nächste Chat nicht.

## 6b. Einfälle und Ideen

Einfälle kommen ständig, gerade beim Gestalten. **Festhalten und Entscheiden sind getrennt.** *Warum:* Löst jede Idee sofort Arbeit aus, wird nichts fertig (G3). Festhalten ohne Aufwand macht den Kopf frei, und nichts geht verloren.

1. **Festhalten, sofort:** In jeder Session genügt „Idee: …“. Die Session trägt sie in `docs/IDEEN.md` ein und arbeitet normal weiter. Ein Eintrag hat Datum, Bereich und einen Satz zum Nutzen.
2. **Sortieren, wöchentlich:** In der Wochenrunde geht der Architekt die neuen Ideen mit dem Owner durch. Jede wird **verworfen**, **geparkt** oder als **nächstes Thema** einem Bereich gegeben.
3. **Umsetzen**, erst wenn sie dran ist: Das Gespräch des Bereichs macht daraus eine Spec, dann folgt der normale Ablauf.

Ideen zu Aussehen oder Bedienung allgemein gehören **gestaltung**, Ideen zu einem Feature dem **Fachbereich**. `IDEEN.md` ist öffentlich, Persönliches gehört nicht hinein.

Vorlage für einen Eintrag:

```markdown
- <Datum> · <bereich> · <Idee in einem Satz> – Nutzen: … – Status: neu | geparkt | verworfen | → Spec <link>
```

## 7. Entscheidungsrechte

| Entscheidet | Was |
|---|---|
| **Bereichs-Lead allein** | Umsetzung, Aufteilung in Aufgaben, Tests, interne Struktur im eigenen Bereich, kleine UX-Texte |
| **Architekt** | Verträge, Schemas, Migrationen, Konflikte zwischen Bereichen, Review-Stufe im Zweifel, neue Abhängigkeiten |
| **Owner** | Produktverhalten, das du merkst, Prioritäten und welche Bereiche aktiv sind, Kosten (KI-Budget, Abos), Datenschutz und was ins öffentliche Repo darf, Freigabe jeder Spec, Grundzüge der Designsprache (Wirkung, Markenkern) |

*Warum:* Heute wartet vieles auf den Owner. Mit klaren Rechten kommen nur noch echte Fragen bei ihm an.

**Gespräch mit der Vertretung:** Der Owner kann mit dem Architekten jederzeit über alles Übergreifende reden und mit ihm entscheiden. Was dort entschieden wird, hält der Architekt **sofort** schriftlich fest (Abschnitt 6a). Im Rahmen der Tabelle darf er auch selbst entscheiden. Was dem Owner gehört, legt er mit Empfehlung vor.

**Fragen an den Owner** laufen weiter als Issue mit Label `entscheidung`. Neu ist:
- **Nicht mehr einzeln:** Der Architekt sammelt die Fragen und legt sie **einmal pro Woche** gebündelt vor, jede mit Empfehlung.
- **Dringendes** (`dringend`) geht sofort an den Owner.

*Warum:* Zehn Minuten Entscheidungen auf einmal statt verstreut über Tage.

## 8. Rhythmus: Ereignisse statt Takt

- **Kein Stundentakt.** Arbeit startet, wenn der Owner ein Gespräch führt oder ein Ereignis eintritt: CI fertig, Review da, Merge. PR-Abos laufen wie bisher und enden nach dem Merge.
- **Pfleger:** einmal täglich, frische Session, günstiges Modell. Ohne Änderungen seit dem letzten Lauf beendet er sich sofort.
- **Wochenrunde, jeden Mittwoch:** Mittwochs wird das Wochenlimit des Owners zurückgesetzt, also sind Credits sicher verfügbar. Arbeitsintensives wie neue Bau-Sessions plant man darum eher an den Wochenanfang ab Mittwoch. Der Architekt schreibt eine Seite für den Owner mit vier Teilen: was fertig ist, was hakt, welche Entscheidungen anstehen und welche neuen Ideen sortiert werden müssen.

*Warum:* Der Takt hat Stunden ohne Arbeit bezahlt. Ereignisse kosten nur, wenn etwas zu tun ist.

## 9. Typischer Ablauf

1. Der Owner öffnet die Session „vorlesung – Gespräch“ und bespricht eine Idee.
2. Der Lead schreibt `docs/bereiche/vorlesung/specs/<feature>.md`, der Owner gibt sie frei.
3. Eine frische Session „vorlesung – Bau“ liest die Spec. Worker setzen um, ein Reviewer prüft, CI läuft, dann wird gemergt.
4. Berührt der Bau einen Vertrag, entsteht ein Issue `schnittstelle`, der Architekt prüft es, und die Übersicht zeigt es allen.
5. Der Bau-Lead aktualisiert `STAND.md`. Der Pfleger verdichtet nachts `UEBERSICHT.md`.
6. Ist die Spec erledigt, endet die Bau-Session. Das nächste Feature beginnt wieder mit einem Gespräch.

## 10. Was weiter gilt

Unverändert gelten:
- Merge-Regeln und Review-Pflicht (`CLAUDE.md`)
- Review-Stufen A und B, Nachrunden-Regeln und Cache-Regel (`KOLLABORATION.md` §4a)
- Modell-Routing (§4)
- höchstens 4 Agents gleichzeitig **pro Session**
- Kommentar-Präfixe `**[Claude]**` und `**[Claude-Review]**`
- keine Secrets

**Ersetzt werden:**
- „Lead-Session“ und „Autonom weiterarbeiten“ (§4a)
- Ruhemodus mit ⚙-Zeilen
- Tagesrhythmus (§6)

#188 bleibt bis zur Einführung von `UEBERSICHT.md` die Übersicht.

## 11. Einführung als Pilot

1. **Freigabe** dieses Entwurfs durch den Owner, mit Änderungen.
2. **Architekt legt an:**
   - `docs/bereiche/` mit den Vorlagen
   - `STAND.md` für alle sechs Bereiche aus dem heutigen Stand (offene Issues und PRs)
   - `UEBERSICHT.md` und `IDEEN.md`
   - `docs/bereiche/START.md` mit fertigen Startnachrichten für jede Rolle zum Einfügen in einen neuen Chat
   - die Labels
   - den Pfleger-Auftrag als geplante Aufgabe
3. **Pilot mit zwei Bereichen, ein bis zwei Wochen: lernen und wissen** (Owner, 26.11.). *Warum:* Fast alle Funktionen der App hängen zumindest zum Teil daran. Hier unterscheidet sich das Projekt von anderen Lern-Apps.
   - **Erster Schritt: Leitbild-Gespräch.** Der Owner beschreibt dem Architekten seine Vision für Lernen und Wissen. Der Architekt schreibt sie als Leitbild in die Spezifikation, in `01-PRODUKT.md` und `06-LERNMODELL-PLANER.md`, und der Owner gibt sie frei. *Warum:* Laut Owner ist die Vision bisher nicht durchgedrungen. Steht der Kern nicht schriftlich fest, baut jede Session eine gewöhnliche Lern-App.
   - Erst danach entstehen die Specs der beiden Bereiche.
   - Die ruhenden Bereiche bleiben in ihrem Stand. Fertiges wird trotzdem abgeschlossen, z. B. der Merge von #388, sobald der Mac auf main ist. Das erledigt der Architekt als Einzelpunkt.
   - Damit ist #328 („Lernen oder Phase 2 fertig?“) in Richtung Lernen beantwortet.
4. **Rückblick** mit dem Owner: Was hat geholfen, was hakt? Danach passen wir die Struktur an und machen sie zur Regel.

## 12. Offene Fragen an den Owner

Geklärt: sechs Bereiche, gestaltung ist dabei (Owner, 26.11.). Grundsätzliche Änderungen laufen über die Spezifikation und den Architekten.

Offen, jeweils mit Vorschlag:
1. ~~Pilot-Bereiche~~: lernen und wissen (Owner, 26.11.).
2. ~~Tag der Wochenrunde~~: **Mittwoch** (Owner, 26.11.). Dann wird das Wochenlimit zurückgesetzt, und es sind sicher Credits da. Am Sonntag kann das Limit schon aufgebraucht sein.
3. Wer startet die Sessions? *Vorschlag:* der Owner selbst in claude.ai/code, mit den Startnachrichten aus `START.md`. Er behält so die Kontrolle, und keine Session läuft ohne Anlass.
