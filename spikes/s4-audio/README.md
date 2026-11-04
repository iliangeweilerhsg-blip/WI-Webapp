# Spike S4 – Langzeit-Audioaufnahme im Browser (2h-Stabilität & Chunk-Grenzen)

Mit diesem Testwerkzeug prüfen wir für **Spike S4** (`R-04`, `F-AUD-01`, `F-SES-05`, `08 §7`), ob die Audioaufnahme im Browser auf deinem Mac (**Safari** und **Chrome**) über **2 Stunden** stabil durchläuft, ob der **IndexedDB-Puffer** bei kurzen Verbindungs- oder Serverunterbrechungen keinen einzigen Chunk verliert und welche Aufnahme-Variante (**Variante A** vs. **Variante B**) an den 30-Sekunden-Grenzen die kleinsten Lücken bzw. Überlappungen erzeugt.

---

## 1. Einmalige Vorbereitung

Stelle sicher, dass `ffmpeg` auf deinem Mac installiert ist (für das Zusammenfügen nach `full.m4a` und die Stille-Messung):

```bash
brew install ffmpeg
```

Alle aufgezeichneten Audiodaten landen ausschließlich lokal unter `~/StudienGehirn/spikes/s4/<lauf>/` und **niemals** im Git-Repository.

---

## 2. Lokalen Testserver starten

Öffne das Terminal im Projektordner (`WI-Webapp`) und starte den Server:

```bash
node spikes/s4-audio/server.mjs
```

Der Server lauscht ausschließlich lokal auf deinem Mac unter **`http://127.0.0.1:4798`** (bzw. `http://localhost:4798`) und beendet sich nach 3 Stunden automatisch selbst.

---

## 3. Testablauf im Browser (Safari & Chrome)

Führe die folgenden Schritte nacheinander in **Google Chrome** und in **Safari** auf deinem Mac aus:

### Phase 1: Sinuston-Vergleich (je 10 Minuten pro Variante)

1. Öffne **`http://localhost:4798`** im Browser.
2. **Durchlauf 1 – Variante A mit Sinuston (10 min):**
   - **Aufnahme-Variante:** `Variante A – timeslice(30s) + Init-Chunk`
   - **Audio-Quelle:** `Sinuston 440 Hz (Lücken-Messung)`
   - **Dauer:** `10` Minuten (oder direkt über die URL `http://localhost:4798/?variante=A&modus=sine&dauer=10`)
   - Klicke auf **„Aufnahme starten"** und warte, bis die 10 Minuten abgelaufen sind.
   - Führe danach im zweiten Terminal-Tab den angezeigten Auswertungsbefehl aus:
     ```bash
     node spikes/s4-audio/auswerten.mjs --letzter
     ```
3. **Durchlauf 2 – Variante B mit Sinuston (10 min):**
   - **Aufnahme-Variante:** `Variante B – Recorder-Rotation alle 30s`
   - **Audio-Quelle:** `Sinuston 440 Hz (Lücken-Messung)`
   - **Dauer:** `10` Minuten (oder `http://localhost:4798/?variante=B&modus=sine&dauer=10`)
   - Klicke auf **„Aufnahme starten"** und werte den Lauf anschließend ebenfalls aus:
     ```bash
     node spikes/s4-audio/auswerten.mjs --letzter
     ```

### Phase 2: 2-Stunden-Praxistest mit Mikrofon (bessere Variante)

Wähle die Variante (A oder B), die in Phase 1 weniger Lücken an den Chunk-Grenzen gezeigt hat, und starte den **2-Stunden-Härtetest**:

1. Stelle ein:
   - **Aufnahme-Variante:** die bessere Variante aus Phase 1
   - **Audio-Quelle:** `Mikrofon (2h-Praxistest)` (Browser-Mikrofonfreigabe erlauben)
   - **Dauer:** `120` Minuten
2. Klicke auf **„Aufnahme starten"**.
3. **Wichtig – führe während dieser 2 Stunden genau diese drei Stresstests durch:**
   - **Hintergrund-Tab (5 min):** Wechsle mindestens **5 Minuten lang** in einen anderen Browser-Tab oder ein anderes Programm, sodass der Aufnahme-Tab im Hintergrund liegt.
   - **WLAN kurz aus/an:** Schalte am Mac einmal das **WLAN für ca. 15–30 Sekunden aus und wieder an**.
   - **Deckel kurz zu-/aufklappen:** Klappe den **Mac-Deckel einmal kurz für ca. 10–20 Sekunden zu und wieder auf** (prüft die Ruhezustands-Erkennung und Stille-Einfügung nach `F-SES-05`).
4. Nach Ablauf der 120 Minuten führe im Terminal die Auswertung aus:
   ```bash
   node spikes/s4-audio/auswerten.mjs --letzter
   ```

---

## 4. Ergebnis an Claude schicken

Kopiere nach jedem Lauf den im Terminal ausgegebenen Block **`SPIKE S4 – AUSWERTUNGSBERICHT`** (sowie optional den Browser-Laufbericht aus dem Textfeld der Webseite) und schicke ihn hier im Chat an Claude.
