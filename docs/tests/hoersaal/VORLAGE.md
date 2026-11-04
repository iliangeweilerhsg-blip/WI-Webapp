# Hörsaal-Testprotokoll (Phase 1 · T1-20)

> **Zeitaufwand:** ca. **5 Minuten vor** der Vorlesung und **10 Minuten direkt danach** (während der Vorlesung nur kurze Strichliste bei Auffälligkeiten).
> Kopiere diese Datei vor der Vorlesung nach `docs/tests/hoersaal/JJJJ-MM-TT-<modul-kuerzel>.md`.

---

## 1. Kopfdaten

| Feld | Eintrag |
| :--- | :--- |
| **Datum & Uhrzeit** | `JJJJ-MM-TT`, `HH:MM` – `HH:MM` Uhr |
| **Modul & Termin** | z. B. `Datenbanksysteme · VL 7` |
| **Hörsaal / Sitzplatz** | z. B. `H 012, Reihe 5 Mitte` |
| **Verbindung (WLAN)** | [ ] Uni-WLAN (gleiches Netz) · [ ] Uni-WLAN (Geräte isoliert / Offline-Weg) · [ ] Persönlicher Hotspot · [ ] Komplett offline |
| **App-Version (Commit)** | `________________` *(im Terminal auf dem Mac: `git rev-parse --short HEAD`)* |
| **Mac & Browser** | Modell: `________________` · macOS: `______` · Browser: [ ] Safari [ ] Chrome |
| **iPad & Stift** | Modell: `________________` · iPadOS: `______` · Apple Pencil: [ ] 2. Gen [ ] USB-C [ ] Pro |
| **Folien vorhanden?** | [ ] Ja, vorab hochgeladen (`_____` Seiten) · [ ] Nein (folienloser Modus) |
| **Schreibmodus auf dem iPad** | [ ] Freie Seite (an Folie geheftet) · [ ] Auf die Folie schreiben |

---

## 2. Vor der Vorlesung (ca. 5 min vor Beginn)

1. **Systemcheck am Mac (Terminal):**
   - `pnpm sg doctor` ausführen → [ ] Alles grün · [ ] Warnung/Fehler: `________________`
2. **Akkustände notieren:**
   - Mac: `_____%` · iPad: `_____%` · Apple Pencil: `_____%`
3. **Verbindung prüfen:**
   - Auf dem **Startbildschirm (iPad)** bzw. in der **Schreibansicht** unten rechts schauen:
     - [ ] Punkt neben `Mac ●` ist **grün** (verbunden)
     - [ ] Punkt ist **grau** (Offline-Betrieb – Schreiben, Marker und Fotos müssen trotzdem ohne Fehlermeldung gehen)
4. **Messung 1 · Heute-Bildschirm öffnen (Ziel: `< 2 s`):**
   - Web-App am Mac neu öffnen → **Heute (Startbildschirm)** mit Karte *„Gleich: … [ Start ]"* ist sofort da:
     - [ ] Ja (`< 2 s`) · [ ] Nein (`____ s`)
5. **Messung 2 · Ein-Tipp-Start bis laufende Aufnahme (Ziel: `≤ 10 s`, genau 1 Tipp, 0 Dialoge):**
   - *So misst du:* Stoppuhr am Handy starten in dem Moment, in dem du die App öffnest, und auf der Karte *„Gleich"* auf **[ Start ]** tippst (am Mac **oder** am iPad). Stoppen, sobald im **Live-Dashboard** unten links der rote Punkt `● 00:00:01` läuft und auf dem iPad die **Schreibansicht** offen ist.
   - Start ausgelöst am: [ ] Mac · [ ] iPad
   - Gemessene Startzeit: **`____,__ s`** *(Grenzwert: `≤ 10 s`)*
   - Anzahl Tipps bis zur laufenden Aufnahme: **`____`** *(Ziel: `1`)*
   - Kam ein modaler Dialog oder ein Popup? [ ] Nein *(Pflicht)* · [ ] Ja (welcher?): `________________`

---

## 3. Während der Vorlesung (höchstens 5 kurze Notizen – sonst einfach mitschreiben)

> **Wichtig:** Lass dich nicht vom Zuhören ablenken. Mach hier nur einen Strich oder notiere kurz die Sitzungszeit aus der **Statusleiste** (z. B. `00:42`), wenn dir etwas auffällt.

- **Verzögerte Strich-Spiegelung am Mac (`> 1 s` nach Stift absetzen):** `[     ]` *(Strichliste)*
- **Verzögerter Folienwechsel Mac ↔ iPad (`> 0,3 s`):** `[     ]` *(Strichliste)*
- **Unerwartetes Popup / Banner / Blinken (Verstoß gegen R1/R4):** `[     ]` *(Strichliste)*
- **Kurze Zeitstempel-Notizen (max. 5 Zeilen):**
  1. `00:__` – `________________________________________________________________`
  2. `00:__` – `________________________________________________________________`
  3. `00:__` – `________________________________________________________________`
  4. `00:__` – `________________________________________________________________`
  5. `00:__` – `________________________________________________________________`

---

## 4. Direkt nach der Vorlesung (ca. 10 min)

> *Falls das iPad im Hörsaal getrennt war (grauer Punkt): Verbinde Mac und iPad jetzt kurz über denselben Hotspot oder das Heim-WLAN und warte ca. 10–30 Sekunden, bis der Punkt neben `Mac ●` grün ist und alle Einträge übertragen wurden.*

### 4.1 Strichverlust prüfen (Grenzwert: `0` fehlende Striche)
- *So misst du (ohne Technik):*
  1. Schau in der **Seitenleiste** der **Schreibansicht** auf dem iPad auf die Gesamtseitenzahl und vergleiche sie mit der **Notizen-Spalte** im **Live-Dashboard** (bzw. in der **Fachübersicht → Vorlesungen**) am Mac.
  2. Lege iPad und Mac nebeneinander und prüfe **3 Seiten** genau (die **erste** Seite, eine **mittlere** Seite mit viel Schrift/Lasso-Verschiebung und die **letzte** Seite): Sind alle Wörter, Formeln, Unterstreichungen und Textmarker-Stellen am Mac vollständig und an der richtigen Position da?
- Seitenzahl iPad: **`____`** · Seitenzahl Mac: **`____`** *(muss identisch sein)*
- Stichprobe 1 (Seite `___`): [ ] Alles da · [ ] Es fehlt / ist verschoben: `________________`
- Stichprobe 2 (Seite `___`): [ ] Alles da · [ ] Es fehlt / ist verschoben: `________________`
- Stichprobe 3 (Seite `___`): [ ] Alles da · [ ] Es fehlt / ist verschoben: `________________`
- **Ergebnis Strichverlust:** [ ] **0 Striche verloren (Bestanden)** · [ ] Verlust festgestellt (**Nicht bestanden**)

### 4.2 Audioaufnahme & Lücken prüfen (Grenzwert: `≤ 30 s` Verlust bei Absturz, `0 s` bei Netzunterbrechung)
- *So misst du (ohne Technik):*
  1. Notiere vor oder direkt beim Beenden die angezeigte Laufzeit in der **Statusleiste** (`● HH:MM:SS`).
  2. Öffne nach dem Stopp die fertige Audiodatei der Vorlesung (oder den Player der Session) und prüfe die Gesamtdauer.
  3. Klicke an **3 Stellen** in die Aufnahme (Anfang, Mitte, letzte Minute): Ist der Ton klar verständlich und ohne abgehackte Sprünge?
- Echte Vorlesungsdauer (Laufzeit): **`____ min ____ s`**
- Dauer der gespeicherten Aufnahme: **`____ min ____ s`** *(Abweichung: `____ s`)*
- Gab es während der Vorlesung einen Browser-Neustart / Zuklappen am Mac?
  - [ ] Nein → Erwarteter Verlust: `0 s`
  - [ ] Ja (Dauer der Unterbrechung: `____ s`) → Erschien in der Statusleiste *„Aufnahme fortgesetzt · … s fehlen"*? [ ] Ja [ ] Nein
- Hörprobe (Anfang / Mitte / Ende): [ ] Klar und lückenlos · [ ] Aussetzer / Stummstelle bei Minute `____`
- **Ergebnis Audioverlust:** **`____ s`** *(Grenzwert: `≤ 30 s`)*

### 4.3 Folienwechsel, Marker-Stempel und Tafel-Fotos
- **Folienwechsel (`F-DSH-02`, `F-INK-04`):**
  - Bis zu welcher Folie ist die Vorlesung gekommen? Folie **`____`**
  - Zeigt das **Live-Dashboard** am Mac und die **Folienleiste** am iPad am Ende dieselbe Foliennummer? [ ] Ja · [ ] Nein (`Mac: ___ / iPad: ___`)
  - Hat das Blättern per Zwei-Finger-Wisch am iPad und per Pfeiltasten am Mac verzögerungsfrei geklappt? [ ] Ja · [ ] Nein: `________________`
- **Marker (`F-INK-05`, `F-DSH-05`):**
  - *So misst du:* Vergleiche die Zahl der gesetzten Marker-Stempel auf deinen iPad-Notizseiten (plus am Mac per Taste `F` / `K` / `L` gesetzte Marker) mit dem **Marker-Zähler** in der **Statusleiste** (`❓`, `⚠️`, `🔗`).
  - Gezählte Marker in der Statusleiste: `❓ ____` · `⚠️ ____` · `🔗 ____`
  - Stimmen Anzahl und Position der Stempel am rechten Seitenrand? [ ] Ja, alle da · [ ] Nein: `________________`
- **Tafel-Fotos (`F-INK-06`):**
  - Anzahl aufgenommener Fotos mit dem Kamera-Button (`📷`) in der **Werkzeugleiste**: **`____`** *(falls keine Tafel genutzt wurde: 1 Testfoto vom Hörsaal/Pult machen)*
  - Sind alle Fotos sowohl auf der iPad-Notizseite als auch am Mac sichtbar? [ ] Ja · [ ] Nein: `________________`

### 4.4 Session-Ende & Auto-Stopp (`F-SES-03`)
- Wie wurde die Session beendet?
  - [ ] **Manuell** per Klick auf Stopp (`■`) in der **Statusleiste**
  - [ ] **Auto-Stopp** abgewartet (z. B. nach Vorlesungsende + 10 min ohne Sprache oder in einer 15-min-Pause)
- *Falls Auto-Stopp getestet wurde:* Erschien 60 s vorher dezent in der Statusleiste *„Stoppt gleich · weiter aufnehmen"* (ohne Popup-Dialog)?
  - [ ] Ja · [ ] Nein · [ ] Heute manuell gestoppt (Hinweis: Bei den 3 Abnahme-Vorlesungen mindestens 1× Auto-Stopp abwarten)

### 4.5 Akku-Verbrauch
- Akkustände nach der Vorlesung:
  - Mac: `_____%` (Verbrauch: **`_____%`**) · iPad: `_____%` (Verbrauch: **`_____%`**) · Apple Pencil: `_____%`

---

## 5. Deine Bewertung (Skala 1 bis 5)

*(1 = sehr schlecht · 2 = eher schlecht · 3 = mittel · 4 = gut · 5 = hervorragend)*

1. **Schreibgefühl auf dem iPad (`F-INK-01`):** [ ] 1 · [ ] 2 · [ ] 3 · [ ] 4 · [ ] 5
   - *Ein Satz dazu (Stift, Textmarker unter der Schrift, Radierer, Doppeltipp, Handballen):*
     `________________________________________________________________________`
2. **Ruhe & fehlende Ablenkung (`LP1`, `LP5`, `R1–R4`):** [ ] 1 · [ ] 2 · [ ] 3 · [ ] 4 · [ ] 5
   - *Ein Satz dazu (dunkles Live-Dashboard, keine unruhigen Anzeigen, 1-Tipp-Bedienung):*
     `________________________________________________________________________`
3. **Vertrauen („Ich hätte mich heute ohne Zweit-App auf die App verlassen"):** [ ] 1 · [ ] 2 · [ ] 3 · [ ] 4 · [ ] 5
   - *Ein Satz dazu (hast du zwischendurch GoodNotes oder eine andere App geöffnet?):*
     `________________________________________________________________________`

---

## 6. Gesamtergebnis dieser Vorlesung (Abnahmekriterien aus `10 §3` & `09 §1–3`)

| Prüfpunkt | Grenzwert laut Spezifikation | Gemessener Wert heute | Status |
| :--- | :--- | :--- | :--- |
| **1. Startzeit (Ein-Tipp-Start)** | `≤ 10 s`, genau `1` Tipp (`09 §1`, `F-SES-02`) | `____ s` (`___` Tipp) | [ ] Bestanden · [ ] Nicht bestanden |
| **2. Strichverlust** | **`0` Striche** verloren (`09 §2`, `10 §3`) | `____` fehlend | [ ] Bestanden · [ ] Nicht bestanden |
| **3. Audioverlust** | **`≤ 30 s`** (bei Netzunterbrechung `0 s`, `09 §2`) | `____ s` | [ ] Bestanden · [ ] Nicht bestanden |
| **4. Live-Spiegelung (wenn gleiches WLAN)** | Strich `≤ 1 s`, Folie `< 300 ms` (`09 §1`) | [ ] Flüssig · [ ] Verzögert · [ ] Offline-Modus | [ ] Bestanden · [ ] Nicht bestanden |
| **5. Offline-/Reconnect-Festigkeit** | Keine Blockade ohne Netz (`09 §3`, `R14`), Sync vollständig (`F-SYN-03`) | [ ] Alles übertragen · [ ] Fehler | [ ] Bestanden · [ ] Nicht bestanden |
| **6. Keine Dialoge in der Session** | **`0` modale Dialoge / Popups** (`R1`, `F-SES-02`) | `____` Dialoge | [ ] Bestanden · [ ] Nicht bestanden |
| **7. Schreibgefühl im Hörsaal** | Mindestens Bewertung `4` oder `5`, keine Fehleingaben durch Handballen (`F-INK-01`) | Bewertung: `___ / 5` | [ ] Bestanden · [ ] Nicht bestanden |

### Fazit für diesen Vorlesungstest
- [ ] **BESTANDEN** *(alle 7 Punkte oben sind „Bestanden" – zählt als 1 von 3 Pflicht-Vorlesungen für die Phase-1-Freigabe)*
- [ ] **NICHT BESTANDEN** *(mindestens ein Punkt verfehlt – Fehler unten kurz benennen, Version muss nachgebessert werden)*

**Wichtigste Beobachtung / Fehlerbeschreibung für Claude (optional, 1–3 Sätze):**
`________________________________________________________________________________`
`________________________________________________________________________________`
