# Entscheidungsvorlagen für die offenen Befunde (W-01 bis W-08, K-01 bis K-03)

| | |
|---|---|
| **Bezug** | `docs/spezifikation/PRUEFBERICHT.md` (§2 und §3), Issue #29 |
| **Grundlage** | `docs/spezifikation/00-UEBERSICHT.md` bis `10-UMSETZUNG.md`, `docs/FEATURE-KATALOG.md`, `docs/referenz-analysen/*.md` (Stand nach Einarbeitung von `B-01` bis `B-07` in #21) |
| **Datum** | 04.11.2026 |
| **Autor** | Argon (`Gemini 4 Argon (Medium)`) |

---

## Übersichtstabelle

| Befund | Empfehlung (1 Zeile) | Owner-Frage ja/nein | Phase |
|---|---|---|---|
| **W-01** | **Option A:** Alle 5 `error_record.kind`-Reaktionen direkt in `04` (`F-LRN-06`) aus den bereits in `04`/`05`/`06` vorhandenen Mechanismen (Stufe-3-Karte, Feynman/Stufe-2-Karte, keine Zusatzaktion) ableiten und dem Owner zur Bestätigung vorlegen. | **ja** | Phase 3 |
| **W-02** | **Option A:** `concept` um `kind` + `block_hashes` und `marker` um `concept_id` + `explanation` ergänzen; Detektor-Ausschlussliste in `setting` (`exam_hint_exclusions`) ablegen. | **nein** | Phase 2 |
| **W-03** | **Option A:** `open`-Stufe (`2` vs. `3`) explizit durch `cards.generate` (`05 §P10`) vergeben lassen und in `F-LRN-04` / `06 §2.1` regeln, dass fehlende Vorstufen-Karten weder Stufe 3 in der Lernsitzung noch den `0,30`-Mastery-Deckel dauerhaft blockieren. | **nein** | Phase 3 |
| **W-04** | **Option A:** Job-Payloads (`slide_deck_id`, `exercise_sheet_id`) vereinheitlichen, fehlende Jobs/Endpunkte (`sheet.match_solution`, `module.parse_description`, `cards.from_selection`, `cards.occlusion_suggest`, `mock_exam.generate`) in `08` ergänzen und für `< 3 s` / SSE einen lokalen Worker-HTTP-Endpunkt (`127.0.0.1`) vorsehen. | **nein** | Phase 2 / 3 |
| **W-05** | **Option A:** In `06 §2.3` den konstanten Startwert `1,0` durch `importance_base(K)` ersetzen und die LLM-Stufen `1 | 2 | 3` aus `05 §P7a` in `05 §P8` auf `0,8 | 1,0 | 1,3` abbilden. | **nein** | Phase 2 / 3 |
| **W-06** | **Option A:** In `03 §3` die Tabelle `module` um `settings jsonb default '{}'` (`layout`, `ink_mode`) erweitern, statt lose Schlüssel in `setting` zu streuen. | **nein** | Phase 1 |
| **W-07** | **Option A:** In `03 §3` die Tabelle `session` um `used_other_app bool NULL` erweitern und über `PATCH /sessions/{id}` aus dem Tagesabschluss (`F-PLN-07`) setzen. | **nein** | Phase 4 |
| **W-08** | **Option A:** In `06 §1` (Zeile `Bewertung`) und `04` (`F-INK-10` / `F-LRN-05`) explizit festlegen, dass die Zweifach-Auswahl („Nochmal" / „Gut") auf FSRS-Rating `1` (`Again`) bzw. `3` (`Good`) abgebildet wird. | **nein** | Phase 3 |
| **K-01** | **Option A:** In `02 §7` klarstellen, dass die Modell-Strings (`claude-haiku-5-5` usw.) symbolische Platzhalter sind und über `config/.env` bzw. `setting` konfiguriert werden. | **nein** | Phase 0 / 2 |
| **K-02** | **Option A:** In `00-UEBERSICHT.md` die Reihenfolge der Bereichskürzel (`SUC` vor `LRN, PLN, VID`) an die tatsächliche Kapitelreihenfolge in `04-FUNKTIONEN.md` angleichen. | **nein** | Kosmetisch |
| **K-03** | **Option A:** Tote Markdown-Links auf `STUDIENALLTAG.md`, `LERNMODELL.md` und `KONZEPT.md` in `docs/FEATURE-KATALOG.md` und `docs/referenz-analysen/` auf die existierenden Kapitel in `docs/spezifikation/` umbiegen. | **nein** | Kosmetisch |

---

## 1. Wichtige Befunde (`W-01` bis `W-08`)

---

### W-01 · Fehlende Datei `docs/LERNMODELL.md` hinterlässt Lücke bei Fehleranalyse-Reaktionen (`F-LRN-06`)

#### 1. Problem (in 2–3 Sätzen)
In `03-DATENMODELL.md` §9 (`error_record`, Z. 271) sind fünf Fehlertypen definiert: `verwechslung | voraussetzung_fehlt | verfahren | nur_auswendig | fluechtig`. `04-FUNKTIONEN.md` (`F-LRN-06`, Z. 643–646) verweist für die Systemreaktionen auf das nicht im Repository vorhandene Dokument `docs/LERNMODELL.md` §2.7 und führt beispielhaft nur zwei der fünf Typen (`verwechslung`, `voraussetzung_fehlt`) aus. Für `verfahren`, `nur_auswendig` und `fluechtig` fehlt damit eine verbindliche Festlegung in der Spezifikation.

#### 2. Optionen

- **Option A (Vollständige 5-Typen-Reaktionstabelle aus bestehenden Spezifikationsbausteinen ableiten):**
  - *Beschreibung:* In `04-FUNKTIONEN.md` (`F-LRN-06`) und `06-LERNMODELL-PLANER.md` (neuer Unterabschnitt `§2.7 Fehleranalyse-Reaktionen`) wird für alle fünf `error_record.kind`-Werte eine feste Reaktion definiert, die ausschließlich bereits spezifizierte Mechanismen nutzt:
    1. `verwechslung` → Kontrastkarte „A vs. B" (Stufe 4 `relation` oder `open`) als Inbox-Vorschlag `card_batch` erzeugen (`04 F-LRN-06` Z. 644).
    2. `voraussetzung_fehlt` → Karten des Voraussetzungs-Konzepts (`baut_auf`) in der nächsten Wiederholung vorziehen (`04 F-LRN-06` Z. 645).
    3. `verfahren` → Vorhandene Stufe-3-Karte (`calc` / `open` Anwendung) des Konzepts vorziehen bzw. – falls noch keine existiert – eine neue Stufe-3-Anwendungskarte als Inbox-Vorschlag erzeugen (passend zum `0,60`-Deckel in `06 §2.1` Z. 34).
    4. `nur_auswendig` → Für das Konzept eine Verständnis-/Erklär-Einheit vorschlagen (Stufe-2/3-`open`-Karte „Warum gilt …?" oder Feynman-Aufgabe `F-LRN-13`, passend zu `06 §2.1` Z. 33–34 „verhindert Scheinwissen").
    5. `fluechtig` → Nur normales FSRS-Review-Update der aktuellen Karte, **keine** Zusatzkarte und **kein** Eingriff in andere Konzepte (Flüchtigkeitsfehler soll keinen unnötigen Kartenberg erzeugen, `LP9`).
  - *Betroffene Stellen:* `04-FUNKTIONEN.md` (`F-LRN-06`, Z. 640–648), `06-LERNMODELL-PLANER.md` (§2, nach Z. 90), Tabellen `error_record`, `inbox_item(card_batch)`, Job `grade.analyze_error` (`05 §P16`, `08 §5`).
  - *Aufwand:* **S** (Spezifikation + Regelwerk im Core/Worker ohne neue Tabellen).
  - *Risiken:* Da `docs/LERNMODELL.md` §2.7 nicht vorliegt, könnte der Owner dort für `verfahren`, `nur_auswendig` oder `fluechtig` eine leicht andere Nuance vorgesehen haben (daher Owner-Frage).

- **Option B (Für `verfahren`, `nur_auswendig`, `fluechtig` vorerst gar keine automatische Folgeaktion außer Dokumentation im Vault):**
  - *Beschreibung:* Alle 5 Fehlertypen werden zwar in `error_record` gespeichert und füllen den Abschnitt `<!-- sg:auto:fehler -->` der Konzeptnotiz (`08 §8.2` Z. 286) sowie das Schwächen-Video `V2` (`05 §P15` Z. 169), lösen aber außer bei `verwechslung` und `voraussetzung_fehlt` keine unmittelbare Karten-/Warteschlangen-Aktion aus.
  - *Betroffene Stellen:* `04-FUNKTIONEN.md` (`F-LRN-06`, Z. 643–647).
  - *Aufwand:* **S**.
  - *Risiken:* Verschenkt den didaktischen Nutzen der Unterscheidung zwischen `verfahren`, `nur_auswendig` und `fluechtig` im Lernalltag (`LP6`).

#### 3. Empfehlung mit Begründung (inkl. Zitat aus `06-LERNMODELL-PLANER.md`)
**Empfehlung: Option A** (mit kurzer Bestätigung durch den Owner).
Option A schließt die Spezifikationslücke ohne neue Datenstrukturen und passt exakt zur Deckel-Logik in `06-LERNMODELL-PLANER.md` §2.1 (Z. 32–34):
> „**Deckel** (Lernstufen, verhindert Scheinwissen):
> - keine Karte der Stufe ≥ 2 je richtig beantwortet → max. 0,30
> - Konzeptart `verfahren` oder `modell` und keine Stufe-3-Karte je richtig → max. 0,60"

sowie zu den Eingaben des Schwächen-Videos in `05-KI-PIPELINE.md` §P15 (Z. 169):
> „- `error_record` des Konzepts (häufigste Fehlertypen, verwechselte Konzepte)"

#### 4. Konkreter Änderungstext (für Option A)

**Datei 1:** `docs/spezifikation/04-FUNKTIONEN.md` (Abschnitt `F-LRN-06 · Fehleranalyse`, Z. 640–648)

*Vorher:*
```markdown
### F-LRN-06 · Fehleranalyse
`P1` · Phase 3 · LP6

Bei „Nochmal" oder falscher Antwort bestimmt der Worker (offene/getippte Antwort) bzw. eine kurze Auswahl (Selbstbewertung, optional, 1 Tipp: „verwechselt · vergessen · nicht verstanden") den Fehlertyp. Reaktionen laut `docs/LERNMODELL.md` §2.7, z. B.:
- **Verwechslung:** Kontrastkarte „A vs. B" wird vorgeschlagen.
- **Voraussetzung fehlt:** Das Voraussetzungs-Konzept wird in der nächsten Wiederholung vorgezogen.

Fehler füllen den Abschnitt „Typische Fehler" der Konzeptnotiz.
```

*Nachher:*
```markdown
### F-LRN-06 · Fehleranalyse
`P1` · Phase 3 · LP6

Bei „Nochmal" oder falscher Antwort bestimmt der Worker (`grade.analyze_error` bei offener/getippter Antwort bzw. aus `solution.compare`) oder eine optionale Kurz-Auswahl bei Selbstbewertung (1 Tipp: „verwechselt · Voraussetzung unklar · Rechenweg/Verfahren · nur auswendig · Flüchtigkeitsfehler") den Fehlertyp (`error_record.kind`, Kap. 03 §9). Verbindliche Reaktionen (siehe auch Kap. 06 §2.7):
- **`verwechslung`:** Kontrastkarte „A vs. B" (`relation` oder `open`, mit `confused_with_concept_id`) wird als Inbox-Vorschlag (`card_batch`) erzeugt.
- **`voraussetzung_fehlt`:** Fällige oder neue Karten der Voraussetzungs-Konzepte (`baut_auf`) werden in der nächsten Wiederholung vorgezogen.
- **`verfahren`:** Eine Stufe-3-Anwendungskarte (`calc` oder `open`) des Konzepts wird in der nächsten Wiederholung vorgezogen; existiert noch keine Stufe-3-Karte, erzeugt `cards.generate` einen entsprechenden Vorschlag in der Inbox.
- **`nur_auswendig`:** Eine Verständnisfrage (`open`, Stufe 2–3: „Warum gilt …?") oder eine Feynman-Einheit (F-LRN-13) wird für die nächste Schwächen-Session vorgemerkt.
- **`fluechtig`:** Keine Zusatzkarte und keine Umplanung anderer Konzepte; es zählt nur das reguläre FSRS-Review der aktuellen Karte.

Alle Fehler (außer `fluechtig`) füllen den Abschnitt „Typische Fehler & Verwechslungen" (`<!-- sg:auto:fehler -->`) der Konzeptnotiz und dienen als Eingabe für V2-Schwächen-Videos (F-VID-03).
```

**Datei 2:** `docs/spezifikation/06-LERNMODELL-PLANER.md` (neuer Abschnitt `§2.7` nach Z. 90)

*Nachher (ergänzen nach §2.6, Z. 90):*
```markdown
### 2.7 Reaktionen auf Fehlertypen (`error_record.kind`)

| Fehlertyp (`03 §9`) | Auswirkung auf Wiederholung & Karten | Auswirkung auf Vault & Schwächen |
|---|---|---|
| `verwechslung` | Erzeugt Inbox-Vorschlag (`card_batch`) für eine Kontrastkarte zwischen `concept_id` und `confused_with_concept_id` | Eintrag unter `<!-- sg:auto:fehler -->` („Verwechselt mit [[X]] (n×)") |
| `voraussetzung_fehlt` | Erhöht einmalig die Priorität der Karten direkter Voraussetzungs-Konzepte (`baut_auf`) für die nächste Sitzung | Hinweis in Schwächen-Session (F-LRN-10 Schritt 1) |
| `verfahren` | Zieht Stufe-3-Karten (`calc`/`open`) des Konzepts vor bzw. stößt `cards.generate` für Stufe 3 an | Geht in V2-Schwächen-Video (05 §P15) ein |
| `nur_auswendig` | Schlägt in der nächsten Schwächen-Session eine Verständnisfrage (`open`) oder den Feynman-Modus (F-LRN-13) vor | Eintrag unter `<!-- sg:auto:fehler -->` |
| `fluechtig` | Nur reguläres FSRS-Update der Karte (keine neuen Karten, kein Vorziehen) | Kein Eintrag unter „Typische Fehler" |
```

#### 5. Fragen an den Owner
- **Frage zu W-01:** Da `docs/LERNMODELL.md` (§2.7) nicht im Repo liegt: Passen die oben für `verfahren`, `nur_auswendig` und `fluechtig` festgelegten Reaktionen zu deiner ursprünglichen Idee aus `LERNMODELL.md`, oder möchtest du die Datei `docs/LERNMODELL.md` noch nachliefern bzw. eine Reaktion anders regeln?

---

### W-02 · Fehlende Felder im Datenmodell (`03`) gegenüber Pipeline (`05`), Lernmodell (`06`) und Vault (`08`)

#### 1. Problem (in 2–3 Sätzen)
Fünf Datenfelder, die in der KI-Pipeline (`05`), im Lernmodell (`06`) und bei der Vault-Synchronisation (`08`) explizit verwendet werden, fehlen in den Tabellendefinitionen von `03-DATENMODELL.md`: `concept.kind` (`definition | verfahren | modell | satz | beispiel`), die Block-Hashes der `<!-- sg:auto:... -->`-Blöcke einer Konzeptnotiz, der Konzeptbezug `marker.concept_id` (für `Importance(K)` in `06 §2.3`), das Ergebnis von `explain.questions` zu ❓-Markern sowie der Speicherort der Ausschlussliste für `detect.exam_hints` (`F-NAC-07`).

#### 2. Optionen

- **Option A (Direkte Spalten an `concept` und `marker` + Ausschlussliste in `setting`):**
  - *Beschreibung:*
    1. In `03 §7` (`concept`): `kind text` (`definition | verfahren | modell | satz | beispiel`) und `block_hashes jsonb default '{}'` (Map `{ einsatz, fehler, zusammenhaenge, belege } -> sha256`) ergänzen.
    2. In `03 §5` (`marker`): `concept_id → concept NULL` und `explanation jsonb NULL` (`{ text_md, sources[] }`, geschrieben von `explain.questions`) ergänzen.
    3. In `03 §13` (`setting`) und `05 §P7b`: Verworfenen Klausurhinweisen aus `F-NAC-07` den Setting-Key `exam_hint_exclusions` (`string[]` verworfener Phrasen/Segmente) zuweisen.
  - *Betroffene Stellen:* `03-DATENMODELL.md` §5 (`marker`, Z. 145–150), §7 (`concept`, Z. 194–203), §13 (`setting`, Z. 361); `05-KI-PIPELINE.md` §P7b (Z. 118); `08-SCHNITTSTELLEN.md` §5 (`explain.questions`, Z. 183).
  - *Aufwand:* **S** (4 Spalten im DB-Schema und 1 dokumentierter `setting`-Key).
  - *Risiken:* Keine. Ein Marker bezieht sich im Regelfall auf genau ein primäres Konzept (`concept_id → concept NULL`).

- **Option B (Separate Verknüpfungs- und Hilfstabellen `marker_concept`, `concept_block_hash`, `exam_hint_exclusion`):**
  - *Beschreibung:* Statt Spalten an `concept` und `marker` sowie `setting` werden drei eigene Tabellen angelegt (`marker_concept(marker_id, concept_id)` für n:m-Bezüge, `concept_block_hash`, `exam_hint_exclusion`).
  - *Betroffene Stellen:* `03-DATENMODELL.md` §5, §7, §13 sowie zusätzliche Joins in Core/Worker.
  - *Aufwand:* **M** (3 zusätzliche Tabellen + Migrations- und Join-Aufwand).
  - *Risiken:* Unnötige Schema-Komplexität für 4 feste Markdown-Blöcke und eine kleine Ausschlussliste eines einzelnen Nutzers.

#### 3. Empfehlung mit Begründung
**Empfehlung: Option A.**
`03-DATENMODELL.md` §1 (Z. 14) sieht `jsonb` ausdrücklich *„für klar abgegrenzte, schemageprüfte Nutzlasten"* vor. `block_hashes jsonb` auf `concept` und `explanation jsonb NULL` auf `marker` halten das Schema kompakt, erfüllen alle Anforderungen aus `04 F-NAC-05`, `06 §2.1`, `06 §2.3` und `08 §8.3` und benötigen keine zusätzlichen Joins.

#### 4. Konkreter Änderungstext (für Option A)

**Datei 1:** `docs/spezifikation/03-DATENMODELL.md` (§5 `marker`, Z. 145–150, und §7 `concept`, Z. 194–203)

*Vorher (`03 §5`, Z. 145–150):*
```sql
marker(
  session_id → session, kind text,          -- frage | klausur | verknuepfung
  t_ms int8, page_id → page NULL, position jsonb NULL,   -- wo auf der Seite gestempelt
  source text,          -- ipad | mac | detektor
  note text NULL,
  resolved_at timestamptz NULL)              -- bei ❓: in der Nacharbeitung geklärt
```

*Nachher (`03 §5`):*
```sql
marker(
  session_id → session, kind text,          -- frage | klausur | verknuepfung
  t_ms int8, page_id → page NULL, position jsonb NULL,   -- wo auf der Seite gestempelt
  concept_id → concept NULL,                -- zugeordnetes Konzept (für Wichtigkeit 06 §2.3 & P7b)
  source text,          -- ipad | mac | detektor
  note text NULL,
  explanation jsonb NULL,                   -- KI-Erklärung + Belege zu ❓ aus explain.questions
  resolved_at timestamptz NULL)             -- bei ❓: in der Nacharbeitung geklärt
```

*Vorher (`03 §7`, Z. 194–203):*
```sql
concept(
  name text, aliases text[],                    -- inkl. englischer Begriff
  one_liner text,                               -- „In einem Satz"
  vault_path text,                              -- Konzepte/Normalisierung (Datenbanken).md
  status text,          -- vorschlag | aktiv | zusammengefuehrt
  merged_into → concept NULL,
  exam_relevant bool default false,
  importance_base real default 1.0,
  embedding vector(1024),
  content_hash text)    -- Hash der Markdown-Datei, erkennt Änderungen aus Obsidian
```

*Nachher (`03 §7`):*
```sql
concept(
  name text, aliases text[],                    -- inkl. englischer Begriff
  kind text,            -- definition | verfahren | modell | satz | beispiel
  one_liner text,                               -- „In einem Satz"
  vault_path text,                              -- Konzepte/Normalisierung (Datenbanken).md
  status text,          -- vorschlag | aktiv | zusammengefuehrt
  merged_into → concept NULL,
  exam_relevant bool default false,
  importance_base real default 1.0,
  embedding vector(1024),
  content_hash text,    -- Hash der gesamten Markdown-Datei, erkennt Änderungen aus Obsidian
  block_hashes jsonb)   -- Hashes je App-Block {einsatz, fehler, zusammenhaenge, belege} (Kap. 08 §8.3)
```

**Datei 2:** `docs/spezifikation/08-SCHNITTSTELLEN.md` (§5 `Job-Verträge`, Z. 183)

*Vorher:*
```markdown
| `explain.questions` | `{ session_id }` | Erklärungen zu ❓-Markern (für Nacharbeitung Schritt 1) |
```

*Nachher:*
```markdown
| `explain.questions` | `{ session_id }` | `marker.explanation` (Erklärungen + Belege zu ❓-Markern für Nacharbeitung Schritt 1) |
```

**Datei 3:** `docs/spezifikation/05-KI-PIPELINE.md` (§P7b `detect.exam_hints`, Z. 118)

*Vorher:*
```markdown
1. Regelbasierte Kandidaten im Transkript, Deutsch/Englisch, z. B.: *klausur, prüfung, kommt dran, sollten Sie können, wichtig für, merken Sie sich, typische Aufgabe, exam, will be tested, make sure you know*. Ausschlussliste aus verworfenen Treffern (F-NAC-07).
```

*Nachher:*
```markdown
1. Regelbasierte Kandidaten im Transkript, Deutsch/Englisch, z. B.: *klausur, prüfung, kommt dran, sollten Sie können, wichtig für, merken Sie sich, typische Aufgabe, exam, will be tested, make sure you know*. Ausschlussliste aus verworfenen Treffern (F-NAC-07, gespeichert unter `setting.key = 'exam_hint_exclusions'`).
```

#### 5. Fragen an den Owner
Keine.

---

### W-03 · Stufen-Zuordnung und Freischaltlogik bei Karten (`F-LRN-01`, `F-LRN-04`, `06 §2.1`)

#### 1. Problem (in 2–3 Sätzen)
In `04-FUNKTIONEN.md` (`F-LRN-01`, Z. 600) ist dem Kartentyp `open` die Spanne `Stufe 2–3` zugeordnet, während `03-DATENMODELL.md` §9 (`card.stage int`, Z. 249) pro Karte genau eine Ganzzahl `1..4` verlangt. Zudem schaltet `F-LRN-04` (Z. 630) Stufe 3 erst frei, *„wenn die Stufe-2-Karten des Konzepts einmal richtig waren"*, und `06 §2.1` (Z. 33–34) deckelt `Mastery(K, t)` bei `0,30` bzw. `0,60`, solange keine Stufe-≥-2- bzw. Stufe-3-Karte richtig beantwortet wurde – was zu einer Blockade führt, falls ein Konzept (z. B. durch manuelle Auswahl oder ausstehenden Inbox-Batch) nur Stufe-3-Karten, aber keine aktiven Stufe-2-Karten besitzt.

#### 2. Optionen

- **Option A (`open`-Stufe explizit bei Erzeugung auf `2` oder `3` setzen + Rückfallregel bei fehlenden Vorstufen-Karten):**
  - *Beschreibung:*
    1. In `04 F-LRN-01` (Z. 600) und `05 §P10` (Z. 141) wird klargestellt: `open`-Karten erhalten beim Anlegen explizit `stage = 2` (Verständnis-/Erklärfrage) **oder** `stage = 3` (Fall-/Anwendungsfrage).
    2. In `04 F-LRN-04` (Z. 630) gilt: Existieren für ein Konzept keine aktiven (nicht pausierten) Karten der Stufe 1–2, sind Karten der Stufe 3 sofort freigeschaltet (analog für Stufe 4, wenn Stufe 2 bzw. 3 erfüllt oder nicht vorhanden ist).
    3. Der Deckel in `06 §2.1` (Z. 33: *„keine Karte der Stufe ≥ 2 je richtig beantwortet → max. 0,30"*) nutzt bereits `Stufe ≥ 2` (eine richtige Stufe-3-Karte hebt also den `0,30`-Deckel bereits auf!). Für den zweiten Deckel (Z. 34: `verfahren` oder `modell` ohne richtige Stufe-3-Karte → `max. 0,60`) bleibt der Deckel bestehen, weil laut `05 §P10` (Z. 141) für `verfahren`/`modell` zwingend mindestens eine Stufe-3-Karte erzeugt wird; zusätzlich wird klargestellt, dass ein Konzept ohne aktive Stufe-3-Karte in der UI einen Hinweis „Stufe-3-Karte fehlt / in Inbox" anzeigt, statt still bei `0,60` zu klemmen.
  - *Betroffene Stellen:* `04-FUNKTIONEN.md` (`F-LRN-01` Z. 600, `F-LRN-04` Z. 630), `05-KI-PIPELINE.md` (§P10 Z. 141), `06-LERNMODELL-PLANER.md` (§2.1 Z. 32–36).
  - *Aufwand:* **S**.
  - *Risiken:* Keine.

- **Option B (Zwei getrennte `card.kind`-Werte `open_explain` für Stufe 2 und `open_apply` für Stufe 3):**
  - *Beschreibung:* `open` wird in zwei eigene Kartentypen aufgespalten, damit `kind → stage` eine 1:1-Funktion ist.
  - *Betroffene Stellen:* `03 §9` (`card.kind`), `04 F-LRN-01`, `06 §3.1`, `08 §6`, `packages/schemas`.
  - *Aufwand:* **M**.
  - *Risiken:* Unnötige Duplizierung im Schema, da Vorder- und Rückseitenformat (`08 §6` Z. 209–211) und KI-Bewertung (`grade.open`) für beide identisch sind und `card.stage` ohnehin als eigene Spalte existiert.

#### 3. Empfehlung mit Begründung (inkl. Zitat aus `06-LERNMODELL-PLANER.md`)
**Empfehlung: Option A.**
In `03-DATENMODELL.md` §9 (Z. 248–249) sind `kind` und `stage` bewusst getrennte Spalten (`kind text`, `stage int`). Und in `06-LERNMODELL-PLANER.md` §2.1 (Z. 25–35) rechnet das Lernmodell ausschließlich mit `stage_c` und den beiden Deckeln:
> „```
> Stufengewicht:  w(1)=1   w(2)=2   w(3)=3   w(4)=3
>
> Mastery(K, t) = Σ_c w(stage_c) · R_c(t) · a_c  /  Σ_c w(stage_c) · a_c
>                 über alle nicht pausierten Karten c von K
>                 a_c = 1 für Karten mit mind. einem Review, 0,5 für neue (R_c = 0)
> ```
>
> **Deckel** (Lernstufen, verhindert Scheinwissen):
> - keine Karte der Stufe ≥ 2 je richtig beantwortet → max. 0,30
> - Konzeptart `verfahren` oder `modell` und keine Stufe-3-Karte je richtig → max. 0,60"

Mit Option A passt die Stufenfreischaltung in `F-LRN-04` nahtlos zu dieser Formel, ohne dass ein Konzept ohne Stufe-2-Karten in einer Sackgasse landet.

#### 4. Konkreter Änderungstext (für Option A)

**Datei 1:** `docs/spezifikation/04-FUNKTIONEN.md` (`F-LRN-01` Z. 600 und `F-LRN-04` Z. 630)

*Vorher (`F-LRN-01`, Z. 600):*
```markdown
| `open` | 2–3 | offene Frage → Musterantwort + Bewertungskriterien | KI-Vorschlag, ich bestätige |
```

*Nachher (`F-LRN-01`, Z. 600):*
```markdown
| `open` | 2 oder 3 | offene Frage (Stufe 2: Erklären/Abrufen; Stufe 3: Fall-/Transferfrage) → Musterantwort + Bewertungskriterien | KI-Vorschlag, ich bestätige |
```

*Vorher (`F-LRN-04`, Z. 630):*
```markdown
- Stufen bauen aufeinander auf: zuerst Stufe 1–2. Stufe 3 wird freigeschaltet, wenn die Stufe-2-Karten des Konzepts einmal richtig waren.
```

*Nachher (`F-LRN-04`, Z. 630):*
```markdown
- Stufen bauen aufeinander auf: zuerst Stufe 1–2. Stufe 3 wird freigeschaltet, sobald alle aktiven Stufe-2-Karten des Konzepts mindestens einmal richtig waren (existieren keine aktiven Stufe-2-Karten, ist Stufe 3 sofort frei; Stufe 4 folgt analog nach Stufe 3 bzw. 2).
```

**Datei 2:** `docs/spezifikation/05-KI-PIPELINE.md` (§P10 `cards.generate`, Z. 141)

*Vorher:*
```markdown
  2. Verteilung: mind. 1 Karte Stufe 2. Bei Verfahren/Modellen mind. 1 Karte Stufe 3 (Anwendung, angelehnt an die Übungsaufgaben). Bei Konzepten mit `baut_auf`/`gegensatz`-Beziehungen 1 Karte Stufe 4.
```

*Nachher:*
```markdown
  2. Verteilung: Jede Karte erhält eine feste Ganzzahl `stage` (`1`..`4`). Mind. 1 Karte Stufe 2 (`basic`, `cloze` oder `open` mit `stage = 2`). Bei Verfahren/Modellen (`concept.kind in ('verfahren', 'modell')`) mind. 1 Karte Stufe 3 (`calc` oder `open` mit `stage = 3`, Anwendung angelehnt an die Übungsaufgaben). Bei Konzepten mit `baut_auf`/`gegensatz`-Beziehungen 1 Karte Stufe 4 (`relation`, `stage = 4`).
```

#### 5. Fragen an den Owner
Keine.

---

### W-04 · Widersprüchliche Job-Bezeichnungen und Payloads zwischen `02`, `05` und `08`

#### 1. Problem (in 2–3 Sätzen)
Zwischen `04-FUNKTIONEN.md`, `05-KI-PIPELINE.md` und `08-SCHNITTSTELLEN.md` (§1 & §5) gibt es drei Inkonsistenzen bei den Worker-Schnittstellen: Erstens heißen die ID-Felder in `08 §5` uneinheitlich (`{ slide_deck_id }` bei `pdf.ingest` vs. `{ deck_id }` / `{ sheet_id }` bei `embed.slides` / `sheet.split`). Zweitens fehlen für fünf Funktionen (`F-ORG-05` Musterlösung, `F-KAL-04` Modulbeschreibung, `F-LRN-07` / `F-INK-11` Auswahl→Karte, `F-LRN-08` Bildverdeckungs-Vorschlag, `F-LRN-11` Probeklausur-Aufgaben) die Job- bzw. REST-Einträge in `08`. Drittens sind `grade.open` (Timeout 3 s) und `rag.answer` (SSE-Streaming) in `08 §5` als Jobs gelistet, obwohl die PostgreSQL-Job-Tabelle (`02 §1–2`) keinen Token-Streaming-Kanal vom Worker zum Core bietet.

#### 2. Optionen

- **Option A (Einheitliche Payload-Felder + fehlende Endpunkte/Jobs ergänzen + interner Worker-HTTP-Endpunkt auf `127.0.0.1` für Sync/SSE):**
  - *Beschreibung:*
    1. In `08 §5` werden durchgehend `slide_deck_id` und `exercise_sheet_id` (sowie in `study_block.target` `exercise_sheet_id`) verwendet, passend zum bereits in Phase 0 (`T0-02` / `T0-08`) gebauten `PdfIngestPayload`.
    2. In `08 §1` und `08 §5` werden die fehlenden REST-Endpunkte (`POST /exercise-sheets/{id}/solution`, `POST /modules/{id}/parse-description`, `POST /slides/{id}/occlusion-suggestions`) und Job-/Task-Namen (`sheet.match_solution`, `module.parse_description`, `cards.from_selection`, `cards.occlusion_suggest`, `mock_exam.generate`) ergänzt.
    3. Für die latenzkritischen synchronen bzw. streamenden Aufrufe (`POST /grade/open` mit 3-s-Timeout, `POST /ask` mit SSE-Streaming, `POST /cards/from-selection`) stellt der Worker auf `127.0.0.1:<worker_port>` einen internen lokalen HTTP-Endpunkt für den Core bereit (alternativ ruft der Worker diese direkt ohne Umweg über die DB-Job-Schleife auf, schreibt aber weiterhin `cost_entry`).
  - *Betroffene Stellen:* `02-ARCHITEKTUR.md` §1 & §2 (Z. 22–26, 51–53), `08-SCHNITTSTELLEN.md` §1 (Z. 21, 23, 30) & §5 (Z. 166–195).
  - *Aufwand:* **S** in der Spezifikation; **M** bei Umsetzung in Phase 2/3.
  - *Risiken:* Ein lokaler HTTP-Port des Workers (`127.0.0.1`) muss von `pnpm sg start` verwaltet werden (nur Loopback).

- **Option B (Core ruft für synchrone/streamende KI-Aufgaben das Anthropic-SDK direkt aus Node.js auf; Hintergrund-Jobs bleiben in Python):**
  - *Beschreibung:* Statt eines internen HTTP-Kanals zwischen Core und Worker führt der Core die drei reinen Cloud-LLM-Aufrufe (`grade.open`, `rag.answer` nach pgvector-Abfrage in Postgres, `cards.from_selection`) direkt mit `@anthropic-ai/sdk` aus, während alle lokalen ML-/PDF-/Audio-/Batch-Jobs im Python-Worker bleiben.
  - *Betroffene Stellen:* `02-ARCHITEKTUR.md` §2 & §7, `08-SCHNITTSTELLEN.md` §5.
  - *Aufwand:* **S** (kein zweiter lokaler HTTP-Server im Worker nötig).
  - *Risiken:* Bei `rag.answer` braucht die Anfrage vorab das Query-Embedding aus `bge-m3` (1024-dim), das ohnehin im Python-Worker auf Metal/MPS läuft (`02 §7` Z. 143)! Daher müsste der Core für das Query-Embedding von `POST /ask` und `GET /search` trotzdem den Python-Worker synchron fragen. Deshalb ist Option A (kleiner interner Loopback-RPC-Endpunkt am Worker für `embed_query`, `grade.open`, `rag.answer`, `cards.from_selection`) architektonisch viel sauberer, weil `bge-m3` und das `LLM`-Protokoll an einer einzigen Stelle (im Python-Worker) bleiben!

#### 3. Empfehlung mit Begründung
**Empfehlung: Option A.**
Da für die Hybridsuche (`F-SUC-01`, `< 300 ms`) und für `rag.answer` (`F-SUC-02`) das Suchanfrage-Embedding zwingend mit demselben lokalen `BAAI/bge-m3`-Modell berechnet werden muss, das im Python-Worker im Speicher gehalten wird (`02 §7`), braucht der Core in Phase 2 ohnehin einen schnellen lokalen Synchron-Aufruf zum Worker auf `127.0.0.1`. Über denselben internen Loopback-Kanal laufen dann auch `grade.open` (< 3 s) und das SSE-Streaming von `rag.answer`, während die gesamte KI-Abstraktion (`02 §7`), Prompt-Versionierung (`05 §1`) und Kostenerfassung (`cost_entry`) zentral im Python-Worker verbleiben.

#### 4. Konkreter Änderungstext (für Option A)

**Datei 1:** `docs/spezifikation/02-ARCHITEKTUR.md` (§2 „Warum diese Aufteilung", Z. 53)

*Vorher:*
```markdown
- **Job-Warteschlange in PostgreSQL** (`SELECT … FOR UPDATE SKIP LOCKED` + `LISTEN/NOTIFY`): kein zusätzlicher Dienst wie Redis, transaktionssicher, gut für einen Nutzer.
```

*Nachher:*
```markdown
- **Job-Warteschlange in PostgreSQL** (`SELECT … FOR UPDATE SKIP LOCKED` + `LISTEN/NOTIFY`): kein zusätzlicher Dienst wie Redis, transaktionssicher, gut für einen Nutzer. Für latenzkritische Synchron-/Streaming-Aufrufe (Query-Embedding bei Suche, `grade.open` < 3 s, `rag.answer` per SSE, Direktentwurf bei `cards.from_selection`) bietet der Worker zusätzlich einen internen Loopback-HTTP-Endpunkt (`127.0.0.1`) für den Core an.
```

**Datei 2:** `docs/spezifikation/08-SCHNITTSTELLEN.md` (§1 Tabelle, Z. 21, 23, 30 sowie §5 Tabelle, Z. 168–194)

*Vorher (`08 §1`, Z. 21, 23, 30):*
```markdown
| Semester & Module | `GET/POST /semesters` · `GET/PATCH /semesters/{id}` · `GET/POST /modules` · `GET/PATCH/DELETE /modules/{id}` |
...
| Material | `POST /slide-decks` (multipart, `module_id`, `session_id?`) · `GET /slide-decks/{id}` · `GET /slides/{id}` · `GET /slides/{id}/image` · `POST /exercise-sheets` · `GET /tasks/{id}` · `PATCH /task-slide-links/{id}` |
...
| Lernen | `GET /review/queue?context=taeglich` · `POST /reviews` · `GET/POST/PATCH /cards` · `POST /cards/from-selection` · `POST /learn-sessions` · `PATCH /learn-sessions/{id}` · `POST /grade/open` · `GET /readiness?module_id` · `GET /mastery?concept_id` |
```

*Nachher (`08 §1`, Z. 21, 23, 30):*
```markdown
| Semester & Module | `GET/POST /semesters` · `GET/PATCH /semesters/{id}` · `GET/POST /modules` · `GET/PATCH/DELETE /modules/{id}` · `POST /modules/{id}/parse-description` |
...
| Material | `POST /slide-decks` (multipart, `module_id`, `session_id?`) · `GET /slide-decks/{id}` · `GET /slides/{id}` · `GET /slides/{id}/image` · `POST /exercise-sheets` · `POST /exercise-sheets/{id}/solution` (multipart) · `GET /tasks/{id}` · `PATCH /task-slide-links/{id}` |
...
| Lernen | `GET /review/queue?context=taeglich` · `POST /reviews` · `GET/POST/PATCH /cards` · `POST /cards/from-selection` · `POST /slides/{id}/occlusion-suggestions` · `POST /learn-sessions` · `PATCH /learn-sessions/{id}` · `POST /grade/open` · `GET /readiness?module_id` · `GET /mastery?concept_id` |
```

*Vorher (`08 §5`, Z. 168–171 und Z. 186–194):*
```markdown
| `pdf.ingest` | `{ slide_deck_id }` | `slide.*`, `slide_deck.ingest_state` |
| `embed.slides` / `embed.tasks` | `{ deck_id }` / `{ sheet_id }` | `slide.embedding` / `task.embedding` |
| `sheet.split` | `{ sheet_id }` | `task.*` |
| `match.tasks_slides` | `{ module_id, sheet_id? , deck_id? }` | `task_slide_link` |
...
| `past_exam.analyze` | `{ past_exam_id }` | `past_exam_question` |
| `grade.open` | `{ card_id, answer }` (synchron über Core, Timeout 3 s) | `{ rating_suggestion, missing_points, feedback }` |
| `grade.analyze_error` | `{ review_log_id }` | `error_record` |
| `feynman.evaluate` | `{ concept_id, text | audio_ref }` | Ergebnis + `inbox_item(card_batch)` |
| `solution.compare` | `{ task_id, page_id | text }` | Ergebnis + `error_record` |
| `search.index` | `{ source_kind, source_ids[] }` | `search_chunk` |
| `rag.answer` | `{ question, scope }` (Streaming über Core) | Antworttext mit Beleg-IDs |
```

*Nachher (`08 §5`, Z. 168–171 und Z. 186–194):*
```markdown
| `pdf.ingest` | `{ slide_deck_id }` | `slide.*`, `slide_deck.ingest_state` |
| `embed.slides` / `embed.tasks` | `{ slide_deck_id }` / `{ exercise_sheet_id }` | `slide.embedding` / `task.embedding` |
| `sheet.split` | `{ exercise_sheet_id }` | `task.*` |
| `sheet.match_solution` | `{ exercise_sheet_id }` | `task.solution_text` (F-ORG-05) |
| `match.tasks_slides` | `{ module_id, exercise_sheet_id?, slide_deck_id? }` | `task_slide_link` |
| `module.parse_description` | `{ module_id, file_path | text }` | `module.{ects, exam_type, description_md}`, Prüfungs-Vorschlag (F-KAL-04) |
...
| `past_exam.analyze` | `{ past_exam_id }` | `past_exam_question` |
| `mock_exam.generate` | `{ module_id, duration_minutes, scope? }` (synchron über Worker-Loopback) | Aufgabenliste für Probeklausur (F-LRN-11) |
| `cards.from_selection` | `{ source_kind, source_id, region?, text? }` (synchron über Worker-Loopback) | Kartenentwurf `{ kind, stage, front, back }` (F-LRN-07, F-INK-11) |
| `cards.occlusion_suggest` | `{ slide_id }` (synchron über Worker-Loopback) | Vorgeschlagene Masken `masks[]` aus `slide.text_blocks` (F-LRN-08) |
| `grade.open` | `{ card_id, answer }` (synchron über Worker-Loopback, Timeout 3 s) | `{ rating_suggestion, missing_points, feedback }` |
| `grade.analyze_error` | `{ review_log_id }` | `error_record` |
| `feynman.evaluate` | `{ concept_id, text | audio_ref }` | Ergebnis + `inbox_item(card_batch)` |
| `solution.compare` | `{ task_id, page_id | text }` | Ergebnis + `error_record` |
| `search.index` | `{ source_kind, source_ids[] }` | `search_chunk` |
| `rag.answer` | `{ question, scope }` (SSE-Streaming über Worker-Loopback) | Antworttext mit Beleg-IDs |
```

#### 5. Fragen an den Owner
Keine.

---

### W-05 · `concept.importance_base` in `03` vs. `Importance(K)`-Formel in `06` vs. `importance: 1-3` in `05`

#### 1. Problem (in 2–3 Sätzen)
In `05-KI-PIPELINE.md` §P7a (Z. 106) schätzt das LLM bei der Konzept-Extraktion `"importance": 1-3`, und `03-DATENMODELL.md` §7 (`concept`, Z. 201) speichert die Spalte `importance_base real default 1.0`. In `06-LERNMODELL-PLANER.md` §2.3 (Z. 50) beginnt die Formel für `Importance(K)` jedoch mit der festen Konstante `1,0 + …`, sodass `concept.importance_base` nirgends in die Berechnung einfließt und die Abbildung von `1 | 2 | 3` auf `importance_base` undefiniert ist.

#### 2. Optionen

- **Option A (`importance_base(K)` als Basiswert in `06 §2.3` einsetzen + feste Abbildung `1 → 0,8`, `2 → 1,0`, `3 → 1,3`):**
  - *Beschreibung:* In `06 §2.3` wird der erste Summand `1,0` durch `importance_base(K)` (Standard `1,0`) ersetzt. In `05 §P7a` / `§P8` wird die ganzzahlige LLM-Einschätzung `importance: 1 | 2 | 3` deterministisch auf `importance_base: 0,8 | 1,0 | 1,3` abgebildet (bei Zusammenführung zweier Konzepte gilt `max(importance_base)`).
  - *Betroffene Stellen:* `05-KI-PIPELINE.md` §P7a (Z. 106) & §P8 (Z. 126–128), `06-LERNMODELL-PLANER.md` §2.3 (Z. 50), Tabelle `concept.importance_base` (`03 §7`).
  - *Aufwand:* **S**.
  - *Risiken:* Keine; für `importance = 2` (Standardfall) bleibt der Zahlenwert `1,0` identisch zur bisherigen Formel.

- **Option B (`concept.importance_base` und `importance: 1-3` aus `03` und `05` streichen):**
  - *Beschreibung:* Die Wichtigkeit eines Konzepts bestimmt sich ausschließlich aus den objektiven Signalen in `06 §2.3` (`exam_relevant`, ⚠️-Marker, `PastExamShare`, abhängige Konzepte, offene ❓).
  - *Betroffene Stellen:* `03 §7` (Z. 201), `05 §P7a` (Z. 106).
  - *Aufwand:* **S**.
  - *Risiken:* Zu Beginn eines Semesters (ohne Altklausuren und mit wenigen Markern) hätten zentrale Grundlagenkonzepte und Randbeispiele exakt dieselbe Basis-Wichtigkeit `1,0`.

#### 3. Empfehlung mit Begründung
**Empfehlung: Option A.**
Sowohl das Datenmodell (`03 §7`) als auch das Extraktionsschema (`05 §P7a`) sehen `importance_base` bereits vor. Eine moderate Spreizung (`0,8 / 1,0 / 1,3`) differenziert schon nach der ersten Vorlesung Randbegriffe von Kernkonzepten, ohne die stärkeren Signale (`exam_relevant` `+1,0`, Altklausur-Anteil bis `+2,0`, ⚠️-Marker bis `+1,5`) zu überstimmen.

#### 4. Konkreter Änderungstext (für Option A)

**Datei 1:** `docs/spezifikation/06-LERNMODELL-PLANER.md` (§2.3 `Wichtigkeit`, Z. 49–56)

*Vorher:*
```
Importance(K) = 1,0
              + 1,0 · exam_relevant(K)
              + min(1,5 ; 0,5 · Anzahl ⚠️-Marker mit Bezug zu K)
              + 2,0 · PastExamShare(K)             (Punkteanteil in Altklausuren, 0..1, je Modul normiert)
              + 0,3 · ln(1 + Anzahl Konzepte, die auf K aufbauen)
              + min(0,9 ; 0,3 · Anzahl offener ❓ zu K)
```

*Nachher:*
```
Importance(K) = importance_base(K)                 (aus 05 §P7a: 1 → 0,8 · 2 → 1,0 · 3 → 1,3; Standard 1,0)
              + 1,0 · exam_relevant(K)
              + min(1,5 ; 0,5 · Anzahl ⚠️-Marker mit Bezug zu K)
              + 2,0 · PastExamShare(K)             (Punkteanteil in Altklausuren, 0..1, je Modul normiert)
              + 0,3 · ln(1 + Anzahl Konzepte, die auf K aufbauen)
              + min(0,9 ; 0,3 · Anzahl offener ❓ zu K)
```

**Datei 2:** `docs/spezifikation/05-KI-PIPELINE.md` (§P7a, Z. 106)

*Vorher:*
```json
      "importance": 1-3,
```

*Nachher:*
```json
      "importance": 1-3,             // wird in P8 auf concept.importance_base abgebildet: 1 → 0.8, 2 → 1.0, 3 → 1.3
```

#### 5. Fragen an den Owner
Keine.

---

### W-06 · `F-DSH-01` Spaltenbreiten und `F-INK-03` Schreibmodus „pro Modul gespeichert" ohne Feld im Datenmodell

#### 1. Problem (in 2–3 Sätzen)
Laut `04-FUNKTIONEN.md` werden sowohl die Layout-Vorlage und die gezogenen Spaltenbreiten im Live-Dashboard (`F-DSH-01`, Z. 189) als auch der bevorzugte Schreibmodus auf dem iPad (`F-INK-03`, Z. 288: „Freie Seite" vs. „Auf die Folie schreiben"; ebenso `F-EIN-01`, Z. 868) **pro Modul** gespeichert. In der Tabelle `module` (`03-DATENMODELL.md` §3, Z. 45–50) existiert dafür jedoch kein Feld.

#### 2. Optionen

- **Option A (Spalte `settings jsonb default '{}'` in der Tabelle `module`):**
  - *Beschreibung:* `module` (`03 §3`) erhält ein strukturiertes Feld `settings jsonb default '{}'` (optional validiert über `ModuleSettings` in `packages/schemas`: `{ dashboard_layout?, column_widths?, default_ink_mode?, target_retention? }`). Es wird direkt mit `GET /modules` ausgeliefert und über `PATCH /modules/{id}` aktualisiert.
  - *Betroffene Stellen:* `03-DATENMODELL.md` §3 (`module`, Z. 45–50), `04-FUNKTIONEN.md` (`F-DSH-01`, `F-INK-03`, `F-EIN-01`), `06-LERNMODELL-PLANER.md` §1 (Z. 11: Zielbehaltensquote „Pro Modul überschreibbar"), `packages/schemas/src/organisation.schema.json`, `services/core/src/db/schema/organisation.ts`.
  - *Aufwand:* **S** (1 Spalte + optionales Feld im Schema `Module` / `ModuleUpdate`).
  - *Risiken:* Da `module` bereits in Phase 0 (`T0-02`, `T0-04`, `T0-07`) angelegt wurde, erfordert dies zu Beginn von Phase 1 eine kleine Vorwärts-Migration (`ALTER TABLE module ADD COLUMN settings jsonb NOT NULL DEFAULT '{}'`).

- **Option B (Speicherung über strukturierte Schlüssel in der bestehenden Tabelle `setting`):**
  - *Beschreibung:* Modulspezifische Einstellungen werden ohne Schemaänderung an `module` in `setting(key, value)` (`03 §13`, Z. 361) unter Schlüsseln wie `module:<module_id>:settings` gespeichert und über `GET/PATCH /settings` gelesen/geschrieben.
  - *Betroffene Stellen:* `03-DATENMODELL.md` §13 (`setting`, Z. 361), `08-SCHNITTSTELLEN.md` §1 (`GET/PATCH /settings`).
  - *Aufwand:* **S** (keine DB-Migration an `module` nötig).
  - *Risiken:* iPad und Web-App müssen beim Öffnen eines Moduls zusätzlich `/settings` abfragen und verwaiste Schlüssel beim Löschen/Wiederherstellen eines Moduls beachten.

#### 3. Empfehlung mit Begründung
**Empfehlung: Option A (`module.settings jsonb default '{}'`).**
Neben Layout (`F-DSH-01`) und Schreibmodus (`F-INK-03`) ist laut `06 §1` (Z. 11) auch die Zielbehaltensquote (`0,90`) *„Pro Modul überschreibbar"*. Ein typisiertes `settings jsonb`-Feld direkt am `module`-Datensatz sorgt dafür, dass Web-App, Core und iPad alle Modul-Präferenzen sofort mit `GET /modules` erhalten und über `PATCH /modules/{id}` ändern können.

#### 4. Konkreter Änderungstext (für Option A)

**Datei:** `docs/spezifikation/03-DATENMODELL.md` (§3 `Organisation`, Z. 45–50)

*Vorher:*
```sql
module(              -- Lehrveranstaltung
  semester_id → semester, name text, short_name text,      -- „Datenbanksysteme", „DBS"
  color text,                                               -- Token aus der Palette, nicht frei
  ects numeric, exam_type text,                             -- schriftlich|mündlich|Projekt|…
  lecturer text, lang text,
  description_md text)                                      -- aus Modulbeschreibung (F-KAL-04)
```

*Nachher:*
```sql
module(              -- Lehrveranstaltung
  semester_id → semester, name text, short_name text,      -- „Datenbanksysteme", „DBS"
  color text,                                               -- Token aus der Palette, nicht frei
  ects numeric, exam_type text,                             -- schriftlich|mündlich|Projekt|…
  lecturer text, lang text,
  description_md text,                                      -- aus Modulbeschreibung (F-KAL-04)
  settings jsonb default '{}')                              -- Layout/Spaltenbreiten (F-DSH-01), Schreibmodus (F-INK-03), Zielbehaltensquote (06 §1)
```

#### 5. Fragen an den Owner
Keine.

---

### W-07 · `F-PLN-07` Selbstauskunft für Ziel Z1 hat keinen Speicherort

#### 1. Problem (in 2–3 Sätzen)
Zur Erfolgsmessung von Produktziel `Z1` (`01-PRODUKT.md` §4, Z. 40: *„Anteil Sessions ohne Wechsel in eine andere App (Selbstauskunft im Tagesabschluss) ≥ 90 %"* im Wochenrückblick) fragt der Tagesabschluss (`04-FUNKTIONEN.md` `F-PLN-07`, Z. 770) freiwillig: *„Heute in der Vorlesung eine andere App gebraucht? ja/nein"*. Im Datenmodell (`03-DATENMODELL.md` §3 `session`, Z. 65–76) fehlt jedoch ein Feld, um diese Antwort pro Session (bzw. pro Tag) zu persistieren, und in `08 §1` fehlt ein `PATCH /sessions/{id}`-Endpunkt.

#### 2. Optionen

- **Option A (`used_other_app bool NULL` direkt auf `session` + `PATCH /sessions/{id}`):**
  - *Beschreibung:* Die Tabelle `session` (`03 §3`) erhält das optionale Feld `used_other_app bool NULL` (`NULL` = nicht beantwortet, `false` = keine andere App gebraucht, `true` = andere App gebraucht). Im Tagesabschluss (`F-PLN-07`) setzt ein Tipp auf „Ja" / „Nein" dieses Feld für die heutigen Vorlesungs-Sessions über `PATCH /sessions/{id}`.
  - *Betroffene Stellen:* `03-DATENMODELL.md` §3 (`session`, Z. 65–76), `08-SCHNITTSTELLEN.md` §1 (Zeile `Sessions`, Z. 24).
  - *Aufwand:* **S**.
  - *Risiken:* Keine. Da `Z1` in `01 §4` explizit als *„Anteil Sessions ohne Wechsel in eine andere App"* definiert ist, gehört das Attribut fachlich genau an `session`.

- **Option B (Eigene Tabelle `daily_checkin(day date, used_other_app bool)`):**
  - *Beschreibung:* Speicherung pro Kalendertag statt pro Session.
  - *Betroffene Stellen:* `03-DATENMODELL.md` §11, `08-SCHNITTSTELLEN.md` §1.
  - *Aufwand:* **S–M** (neue Tabelle + eigener Endpunkt).
  - *Risiken:* Passt schlechter zur Definition von `Z1` (*„Anteil Sessions"*), wenn an einem Tag mehrere Vorlesungen stattfanden.

#### 3. Empfehlung mit Begründung
**Empfehlung: Option A.**
`Z1` misst laut `01-PRODUKT.md` §4 (Z. 40) den *„Anteil Sessions ohne Wechsel in eine andere App"*. Ein `used_other_app bool NULL`-Feld auf `session` (zusammen mit `PATCH /sessions/{id}`, das ohnehin für das nachträgliche Ändern von Titel, `slide_deck_id` oder `review_state` nützlich ist) bildet das ohne neue Tabelle ab.

#### 4. Konkreter Änderungstext (für Option A)

**Datei 1:** `docs/spezifikation/03-DATENMODELL.md` (§3 `session`, Z. 65–76)

*Vorher:*
```sql
session(              -- Durchführung eines Termins
  calendar_event_id → calendar_event NULL,   -- NULL = spontane Session
  module_id → module,
  slide_deck_id → slide_deck NULL,           -- NULL = folienloser Modus
  number int,                                -- VL-Nummer im Modul (VL 7)
  title text,
  state text,          -- siehe Zustandsautomat F-SES-01
  started_at timestamptz, ended_at timestamptz,
  stop_reason text,    -- manuell | kalenderende | stille | maximaldauer | absturz_wiederhergestellt
  started_from text,   -- mac | ipad
  processing jsonb,    -- Fortschritt der Pipeline-Schritte {step: status}
  review_state text)   -- offen | in_arbeit | erledigt   (Nacharbeitung, F-NAC-05)
```

*Nachher:*
```sql
session(              -- Durchführung eines Termins
  calendar_event_id → calendar_event NULL,   -- NULL = spontane Session
  module_id → module,
  slide_deck_id → slide_deck NULL,           -- NULL = folienloser Modus
  number int,                                -- VL-Nummer im Modul (VL 7)
  title text,
  state text,          -- siehe Zustandsautomat F-SES-01
  started_at timestamptz, ended_at timestamptz,
  stop_reason text,    -- manuell | kalenderende | stille | maximaldauer | absturz_wiederhergestellt
  started_from text,   -- mac | ipad
  processing jsonb,    -- Fortschritt der Pipeline-Schritte {step: status}
  review_state text,   -- offen | in_arbeit | erledigt   (Nacharbeitung, F-NAC-05)
  used_other_app bool NULL) -- freiwillige Selbstauskunft aus F-PLN-07 für Ziel Z1 (NULL = unbeantwortet)
```

**Datei 2:** `docs/spezifikation/08-SCHNITTSTELLEN.md` (§1 Tabelle, Zeile `Sessions`, Z. 24)

*Vorher:*
```markdown
| Sessions | `GET /sessions?module_id&state` · `POST /sessions` (spontan) · `POST /sessions/{id}/start` · `/pause` · `/resume` · `/stop` · `GET /sessions/{id}/timeline` (Segmente, Marker, Striche-Dichte) · `POST /sessions/{id}/import-media` |
```

*Nachher:*
```markdown
| Sessions | `GET /sessions?module_id&state` · `POST /sessions` (spontan) · `GET/PATCH /sessions/{id}` · `POST /sessions/{id}/start` · `/pause` · `/resume` · `/stop` · `GET /sessions/{id}/timeline` (Segmente, Marker, Striche-Dichte) · `POST /sessions/{id}/import-media` |
```

#### 5. Fragen an den Owner
Keine.

---

### W-08 · Abdeckband-Bewertung: „Nochmal/Gut" (`F-INK-10`) vs. 4-stufiges FSRS (`06 §1`)

#### 1. Problem (in 2–3 Sätzen)
Beim direkten Aufdecken eines Abdeckbands im Notizbuch (`04-FUNKTIONEN.md` `F-INK-10`, Z. 329) sowie beim einhändigen Wischen auf dem iPad (`04 F-LRN-05`, Z. 636; `07-UX.md` §4.4, Z. 186) stehen dem Nutzer nur zwei Bewertungsoptionen zur Verfügung: **„Nochmal"** und **„Gut"**. In `06-LERNMODELL-PLANER.md` §1 (Z. 16) ist die Abbildung auf die vier FSRS-Stufen (`1 Nochmal · 2 Schwer · 3 Gut · 4 Leicht`) zwar für automatisch bewertete Kartentypen definiert, für die Zweifach-Auswahl (Abdeckband im Notizbuch & Wisch-Geste auf dem iPad) fehlt jedoch die explizite Zuordnung `Nochmal → 1`, `Gut → 3`.

#### 2. Optionen

- **Option A (Zweifach-Auswahl bildet deterministisch auf FSRS `1` = Nochmal und `3` = Gut ab; in der regulären Wiederholung stehen weiterhin optional alle 4 Stufen bereit):**
  - *Beschreibung:* In `06-LERNMODELL-PLANER.md` §1 (Z. 16) wird verbindlich ergänzt, dass jede Zweifach-Selbstbewertung (Direktabfrage am Abdeckband im Notizbuch laut `F-INK-10` sowie Wisch-Geste links/rechts auf dem iPad laut `F-LRN-05` / `07 §4.4`) `Nochmal → 1` und `Gut → 3` setzt (ohne automatische Hochstufung auf `4` durch Antwortzeit, da bei Selbstbewertung im Notizbuch keine normierte Lesezeit vorliegt). In der regulären Wiederholungsansicht (`F-LRN-09`, `07 §3.8` / `§4.4`) können wie bei allen anderen Selbstbewertungs-Karten wahlweise auch die 4 Tasten/Buttons `1`–`4` genutzt werden.
  - *Betroffene Stellen:* `06-LERNMODELL-PLANER.md` §1 (Z. 16), `04-FUNKTIONEN.md` (`F-INK-10` Z. 329, `F-LRN-05` Z. 636).
  - *Aufwand:* **S** (1 Satz in `06 §1`).
  - *Risiken:* Keine. In FSRS ist Rating `3` (`Good`) genau die neutrale Standard-Bestätigung, auf die auch `ts-fsrs` bei binären („Pass/Fail"-)Interfaces abbildet.

- **Option B (Auch direkt am Abdeckband auf der Notizseite immer 4 Buttons `1`–`4` einblenden):**
  - *Beschreibung:* `F-INK-10` wird von „Nochmal/Gut" auf ein 4-Button-Popover geändert.
  - *Betroffene Stellen:* `04-FUNKTIONEN.md` (`F-INK-10`, Z. 329), `docs/referenz-analysen/goodnotes.md` (Z. 8).
  - *Aufwand:* **S**.
  - *Risiken:* Macht das schnelle Aufdecken direkt im Notizbuch kleinteiliger und widerspricht der bewussten Festlegung in `docs/referenz-analysen/goodnotes.md` (Z. 8: *„Ich bewerte nach dem Aufdecken mit Nochmal/Gut"*).

#### 3. Empfehlung mit Begründung (inkl. Zitat aus `06-LERNMODELL-PLANER.md`)
**Empfehlung: Option A.**
In `06-LERNMODELL-PLANER.md` §1 (Z. 16) heißt es bereits:
> „| Bewertung | 1 Nochmal · 2 Schwer · 3 Gut · 4 Leicht. Bei automatisch bewerteten Typen: richtig → 3, fast richtig → 2, falsch → 1. Schnell und richtig (< 40 % der eigenen Median-Zeit) → 4. |"

sowie für die Readiness-Prognose in `06-LERNMODELL-PLANER.md` §2.5 (Z. 81):
> „`R_plan(d) = p · R_nach_Gut(d) + (1 − p) · R_nach_Nochmal(d)`"

Das Lernmodell behandelt `3 (Gut)` und `1 (Nochmal)` also ohnehin als das primäre Bewertungspaar. Option A hält das schnelle 2-Knopf-/Wisch-UI aus `F-INK-10` und `07 §4.4` exakt mit `06 §1` konsistent.

#### 4. Konkreter Änderungstext (für Option A)

**Datei:** `docs/spezifikation/06-LERNMODELL-PLANER.md` (§1 `FSRS-Einbindung`, Z. 16)

*Vorher:*
```markdown
| Bewertung | 1 Nochmal · 2 Schwer · 3 Gut · 4 Leicht. Bei automatisch bewerteten Typen: richtig → 3, fast richtig → 2, falsch → 1. Schnell und richtig (< 40 % der eigenen Median-Zeit) → 4. |
```

*Nachher:*
```markdown
| Bewertung | 1 Nochmal · 2 Schwer · 3 Gut · 4 Leicht. Bei Zweifach-Auswahl (Wisch auf dem iPad laut F-LRN-05, Direktabfrage am Abdeckband laut F-INK-10): Nochmal → 1, Gut → 3. Bei automatisch bewerteten Typen: richtig → 3, fast richtig → 2, falsch → 1; schnell und richtig (< 40 % der eigenen Median-Zeit) → 4. |
```

#### 5. Fragen an den Owner
Keine.

---

## 2. Kosmetische Befunde (`K-01` bis `K-03`)

---

### K-01 · Modellnamen in `02-ARCHITEKTUR.md` §7

#### 1. Problem (in 2–3 Sätzen)
In `02-ARCHITEKTUR.md` §7 (Z. 144) sind als Modellbezeichnungen für die drei Stufen `fast`, `standard` und `deep` die Strings `claude-haiku-5-5`, `claude-sonnet-5-5` und `claude-opus-5-5` eingetragen. Da sich reale Modell-IDs der Anthropic-API ändern können, sollte im Text klargestellt sein, dass es sich um symbolische Beispiel-IDs handelt, deren konkrete API-Strings in `config/.env` bzw. `setting` konfiguriert werden.

#### 2. Optionen

- **Option A (Hinweis „symbolische Beispiel-IDs, über `config/.env` / Einstellungen änderbar" in `02 §7` ergänzen):**
  - *Betroffene Stellen:* `02-ARCHITEKTUR.md` §7 (Z. 144).
  - *Aufwand:* **S**.
  - *Risiken:* Keine (im Worker `services/worker` aus `T0-05` sind die Stufen ohnehin bereits über Konfigurationskonstanten gekapselt).
- **Option B (Unverändert lassen):**
  - *Betroffene Stellen:* Keine.
  - *Aufwand:* **S**.
  - *Risiken:* Entwickler oder Subagents könnten die Beispiel-Strings wörtlich in API-Aufrufe hartcodieren.

#### 3. Empfehlung mit Begründung
**Empfehlung: Option A.** Ein kurzer Klammerzusatz in `02 §7` verhindert, dass ein Agent die Platzhalter-Strings als feste Konstanten in Prompts oder Tests hartcodiert.

#### 4. Konkreter Änderungstext (für Option A)

**Datei:** `docs/spezifikation/02-ARCHITEKTUR.md` (§7 Tabelle, Z. 144)

*Vorher:*
```markdown
| LLM | – (Cloud nötig) | Claude API. Stufen: `fast` = `claude-haiku-5-5`, `standard` = `claude-sonnet-5-5`, `deep` = `claude-opus-5-5`. Zuordnung in den Einstellungen änderbar. |
```

*Nachher:*
```markdown
| LLM | – (Cloud nötig) | Claude API. Stufen (Beispiel-IDs, konkrete Modell-Strings über `config/.env` und Einstellungen änderbar): `fast` = `claude-haiku-5-5`, `standard` = `claude-sonnet-5-5`, `deep` = `claude-opus-5-5`. |
```

#### 5. Fragen an den Owner
Keine.

---

### K-02 · `00-UEBERSICHT.md` Reihenfolge der Bereichskürzel vs. `04-FUNKTIONEN.md`

#### 1. Problem (in 2–3 Sätzen)
In `00-UEBERSICHT.md` (Abschnitt „Bereichskürzel der Funktions-IDs", Z. 62–67) stehen die Kürzel in der Reihenfolge `BIB, LRN, PLN, VID, SUC`. In `04-FUNKTIONEN.md` (Inhaltszeile Z. 5 und tatsächliche Abschnittsreihenfolge) steht `SUC` jedoch direkt nach `BIB` (`BIB, SUC, LRN, PLN, VID`).

#### 2. Optionen

- **Option A (Zeile `SUC` in `00-UEBERSICHT.md` hinter `BIB` ziehen):**
  - *Betroffene Stellen:* `00-UEBERSICHT.md` (Z. 62–67).
  - *Aufwand:* **S** (1 Zeile verschieben).
  - *Risiken:* Keine.
- **Option B (Reihenfolge in `04-FUNKTIONEN.md` umstellen):**
  - *Betroffene Stellen:* `04-FUNKTIONEN.md` (Z. 5 und Z. 567–587).
  - *Aufwand:* **S**.
  - *Risiken:* Verschiebt Zeilennummern in `04-FUNKTIONEN.md`.

#### 3. Empfehlung mit Begründung
**Empfehlung: Option A.** Das Verschieben einer einzigen Tabellenzeile in `00-UEBERSICHT.md` gleicht beide Dokumente an, ohne Zeilennummern in `04-FUNKTIONEN.md` zu verändern.

#### 4. Konkreter Änderungstext (für Option A)

**Datei:** `docs/spezifikation/00-UEBERSICHT.md` (Abschnitt „Bereichskürzel der Funktions-IDs", Z. 62–68)

*Vorher:*
```markdown
| BIB | Wissensbibliothek |
| LRN | Lernen |
| PLN | Wochenplaner |
| VID | Lernvideos |
| SUC | Suche & „Frag deine Vorlesung" |
```

*Nachher:*
```markdown
| BIB | Wissensbibliothek |
| SUC | Suche & „Frag deine Vorlesung" |
| LRN | Lernen |
| PLN | Wochenplaner |
| VID | Lernvideos |
```

#### 5. Fragen an den Owner
Keine.

---

### K-03 · Tote Links auf `KONZEPT.md`, `STUDIENALLTAG.md` und `LERNMODELL.md`

#### 1. Problem (in 2–3 Sätzen)
In `docs/FEATURE-KATALOG.md` (Z. 4, 77, 101) und `docs/referenz-analysen/README.md` (Z. 6) zeigen relative Markdown-Links (`[Studienalltag](STUDIENALLTAG.md)`, `[Lernmodell](LERNMODELL.md)`, `../STUDIENALLTAG.md`) auf die drei Vorgängerdokumente, die nicht im Repository liegen (vgl. auch die Textverweise in `00-UEBERSICHT.md` Z. 13, `01-PRODUKT.md` Z. 98 und `06-LERNMODELL-PLANER.md` Z. 3). Beim Anklicken in GitHub oder im Editor laufen diese Links ins Leere.

#### 2. Optionen

- **Option A (Relative Links in `FEATURE-KATALOG.md` und `referenz-analysen/README.md` auf die entsprechenden Kapitel unter `docs/spezifikation/` umbiegen; in `00`, `01` und `06` klarstellen, dass die Inhalte hier vollständig aufgegangen sind):**
  - *Betroffene Stellen:* `docs/FEATURE-KATALOG.md` (Z. 4, 48, 77, 101), `docs/referenz-analysen/README.md` (Z. 6), `docs/referenz-analysen/quizlet.md` (Z. 8), `docs/spezifikation/01-PRODUKT.md` (Z. 98), `docs/spezifikation/06-LERNMODELL-PLANER.md` (Z. 3).
  - *Aufwand:* **S**.
  - *Risiken:* Keine.
- **Option B (Links unverändert lassen, falls der Owner `KONZEPT.md`, `STUDIENALLTAG.md` und `LERNMODELL.md` noch ins Repo legt):**
  - *Betroffene Stellen:* Keine.
  - *Aufwand:* **S**.
  - *Risiken:* Solange die drei Dateien nicht nachgeliefert werden, bleiben die Links in `FEATURE-KATALOG.md` kaputt (`404`).

#### 3. Empfehlung mit Begründung
**Empfehlung: Option A.**
Selbst falls die historischen Entwurfsdokumente später noch abgelegt werden, ist laut `00-UEBERSICHT.md` (Z. 15: *„Bei Widersprüchen gilt diese Spezifikation"*) die Spezifikation unter `docs/spezifikation/` die maßgebliche Quelle. Links auf `spezifikation/01-PRODUKT.md#8-alltagsmomente-kurzfassung` und `spezifikation/06-LERNMODELL-PLANER.md` funktionieren sofort und führen direkt zu den verbindlichen Abschnitten.

#### 4. Konkreter Änderungstext (für Option A)

**Datei 1:** `docs/FEATURE-KATALOG.md` (Z. 4, Z. 77, Z. 101)

*Vorher (Z. 4):*
```markdown
> **Regel:** Eine Funktion kommt nur rein, wenn sie einen konkreten Moment aus dem [Studienalltag](STUDIENALLTAG.md) (M1–M13) verbessert.
```

*Nachher (Z. 4):*
```markdown
> **Regel:** Eine Funktion kommt nur rein, wenn sie einen konkreten Moment aus dem [Studienalltag](spezifikation/01-PRODUKT.md#8-alltagsmomente-kurzfassung) (M1–M13) verbessert.
```

*Vorher (Z. 77):*
```markdown
| Lernstatistiken pro Fach | 🔧 | P1 | M10 | Als **Klausur-Readiness** (siehe [Lernmodell](LERNMODELL.md)) |
```

*Nachher (Z. 77):*
```markdown
| Lernstatistiken pro Fach | 🔧 | P1 | M10 | Als **Klausur-Readiness** (siehe [Lernmodell](spezifikation/06-LERNMODELL-PLANER.md)) |
```

*Vorher (Z. 101):*
```markdown
| FSRS-Algorithmus inkl. Optimierer | ✅ | P1 | Siehe [Lernmodell](LERNMODELL.md) |
```

*Nachher (Z. 101):*
```markdown
| FSRS-Algorithmus inkl. Optimierer | ✅ | P1 | Siehe [Lernmodell](spezifikation/06-LERNMODELL-PLANER.md) |
```

**Datei 2:** `docs/referenz-analysen/README.md` (Z. 6)

*Vorher:*
```markdown
- **Funktion** und Moment (M1–M13) aus `../STUDIENALLTAG.md`
```

*Nachher:*
```markdown
- **Funktion** und Moment (M1–M13) aus `../spezifikation/01-PRODUKT.md` (§8)
```

**Datei 3:** `docs/spezifikation/06-LERNMODELL-PLANER.md` (Z. 3)

*Vorher:*
```markdown
Hintergrund und Begründung: `docs/LERNMODELL.md`. Dieses Kapitel legt die verbindlichen Formeln, Parameter und Abläufe fest. Alle Parameter sind Konstanten in `services/core/src/learning/params.ts` und über Tests abgesichert.
```

*Nachher:*
```markdown
Dieses Kapitel fasst das Lernmodell (`docs/LERNMODELL.md`) vollständig zusammen und legt die verbindlichen Formeln, Parameter und Abläufe fest. Alle Parameter sind Konstanten in `services/core/src/learning/params.ts` und über Tests abgesichert.
```

#### 5. Fragen an den Owner
Keine (siehe jedoch die inhaltliche Frage bei **W-01** zu `docs/LERNMODELL.md` §2.7).
