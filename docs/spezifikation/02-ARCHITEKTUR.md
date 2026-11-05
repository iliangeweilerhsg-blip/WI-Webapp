# 02 · Architektur

## 1. Überblick

```
┌──────────────────────────── iPad ────────────────────────────┐
│  iPad-App „Studien-Gehirn Schreiben" (SwiftUI + PencilKit)   │
│  • Canvas, Werkzeuge, Marker, Tafel-Kamera                   │
│  • Lokaler Speicher: Seiten-Dateien + Ausgangswarteschlange  │
└───────────────┬──────────────────────────────────────────────┘
                │ WebSocket (Sync-Protokoll, Kap. 08) · HTTP (Bilder, PDFs)
                │ gefunden per Bonjour oder QR-Code-Kopplung
┌───────────────▼──────────────────── Mac ─────────────────────────────────────┐
│                                                                              │
│  ┌──────────────────────┐      ┌───────────────────────────────────────────┐ │
│  │ Web-App (Browser)    │◄────►│ Core (Node.js · Fastify · ws)             │ │
│  │ Next.js (Static      │ HTTP │ • REST-API, Sync-Server, Datei-Uploads    │ │
│  │ Export), React, TS   │  WS  │ • Sessions, Lernlogik (FSRS), Planer      │ │
│  │ • Dashboard, Lernen, │      │ • Vault-Schreiber, Datei-Watcher          │ │
│  │   Bibliothek, Planer │      │ • Job-Erzeugung, Backups                  │ │
│  │ • Audioaufnahme      │      └──────┬───────────────────────┬────────────┘ │
│  └──────────────────────┘             │ SQL                   │ Jobs (Tabelle │
│                                       │                       │ + NOTIFY)     │
│                       ┌───────────────▼─────────┐   ┌─────────▼────────────┐ │
│                       │ PostgreSQL 16 + pgvector│◄──┤ Worker (Python 3.12) │ │
│                       │ (Docker, nur localhost) │   │ nativ, nutzt Metal   │ │
│                       └─────────────────────────┘   │ • PDF, Whisper,      │ │
│                                                     │   Embeddings, LLM,   │ │
│  ┌───────────────────────────────────────────────┐  │   TTS, Video         │ │
│  │ Datenordner ~/StudienGehirn/                   │◄─┤                      │ │
│  │ media/ (PDF, Folienbilder, Audio, Fotos, Video)│  └──────────┬───────────┘ │
│  │ vault/ (Markdown, Obsidian-kompatibel)         │             │             │
│  │                                                │             │ HTTPS       │
│  └───────────────────────────────────────────────┘             ▼             │
└────────────────────────────────────────────── Cloud-KI (optional, abschaltbar)┘
                                                  Claude API · ggf. Whisper/TTS-API
```

## 2. Komponenten

| Komponente | Verantwortung | Technik | Läuft wo |
|---|---|---|---|
| **iPad-App** | Mitschreiben, Marker, Tafel-Foto, Folie blättern, Session starten/stoppen, später Wiederholung unterwegs | Swift 6, SwiftUI, PencilKit, AVFoundation (Kamera), Network.framework (Bonjour), URLSessionWebSocketTask | iPad, über Swift Playgrounds oder Xcode |
| **Web-App** | Alle Bildschirme am Mac, Audioaufnahme (MediaRecorder), PDF-Anzeige, Strich-Darstellung | Next.js 15 im Static-Export, React, TypeScript, Tailwind, TanStack Query, pdf.js, perfect-freehand | Browser am Mac (Safari oder Chrome), ausgeliefert vom Core |
| **Core** | REST-API, WebSocket-Sync, Geschäftslogik, FSRS, Planer, Vault-Dateien, Backups, Job-Erzeugung | Node.js 22 LTS, TypeScript, Fastify, `ws`, Drizzle ORM, `ts-fsrs`, `chokidar`, `bonjour-service` | Mac, nativer Prozess |
| **Worker** | KI-Pipeline: PDF zerlegen, Transkription, Ausrichtung, Embeddings, LLM-Aufgaben, TTS, Videos | Python 3.12, `uv`, PyMuPDF, `mlx-whisper` (bzw. `whisper.cpp`), `sentence-transformers` (bge-m3), Anthropic SDK, `ffmpeg`, Remotion (Node, über CLI) | Mac, **nativer** Prozess (nicht in Docker, sonst kein Zugriff auf Metal/GPU) |
| **Datenbank** | Struktur, Beziehungen, Lernstatus, Embeddings, Job-Warteschlange | PostgreSQL 16 + pgvector | Docker-Container, nur an `127.0.0.1` gebunden |
| **Dateispeicher** | Alle Binärdaten und der Vault | Dateisystem unter `~/StudienGehirn/` | Mac |

### Warum diese Aufteilung
- **Core in TypeScript:** Ein gemeinsames Typsystem mit der Web-App. Sync, Planer und FSRS sind latenzkritisch und gehören in einen dauerhaft laufenden Prozess.
- **Worker in Python:** Das beste Ökosystem für PDF, Audio, Embeddings und ML. Er läuft nativ, damit Whisper und die Embeddings Apple Silicon (Metal/MLX) nutzen.
- **Job-Warteschlange in PostgreSQL** (`SELECT … FOR UPDATE SKIP LOCKED` + `LISTEN/NOTIFY`): kein zusätzlicher Dienst wie Redis, transaktionssicher, gut für einen Nutzer.
- **Web-App als Static Export:** Kein zweiter Server-Prozess. Der Core liefert die Dateien aus, Daten kommen per API.

## 3. Betrieb auf dem Mac

| Thema | Festlegung |
|---|---|
| Start | `pnpm sg start` startet Postgres (Docker), Core, Worker und öffnet die Web-App. Später (P1): macOS-LaunchAgent für Autostart beim Login. |
| Ports | Core: `4710` (HTTP + WebSocket) auf allen Interfaces, damit das iPad ihn erreicht. Postgres: `5432` nur `127.0.0.1`. |
| Erreichbarkeit fürs iPad | Der Core kündigt sich per **Bonjour** als `_studiengehirn._tcp` an. Fallback: Die Web-App zeigt einen **QR-Code** mit Adresse und Kopplungs-Token (Kap. 08 §3). |
| Datenordner | `~/StudienGehirn/` (konfigurierbar). Struktur siehe [08 §7](08-SCHNITTSTELLEN.md#7-dateiablage). |
| Geheimnisse | API-Schlüssel in `~/StudienGehirn/config/.env` (Rechte 600), nie im Repo. P1: macOS-Schlüsselbund. |
| Updates | `git pull && pnpm sg migrate && pnpm sg start`. Datenbank-Migrationen mit Drizzle, rückwärtskompatibel. |
| Ruhezustand des Macs | Core und Worker überstehen den Ruhezustand. Jobs werden danach fortgesetzt. Läuft eine Aufnahme, verhindert die Web-App den Ruhezustand über die Screen Wake Lock API (solange der Deckel offen ist). |

## 4. Zentrale Datenflüsse

### 4.1 Vorlesung (Session) – vom Start bis zur fertigen Nacharbeitung

```
Zeit ─────────────────────────────────────────────────────────────────────────►

Web-App          Core                     iPad-App              Worker
   │ „Start" ───►│ Session: läuft         │                     │
   │             │──── session.started ──►│ öffnet Notizbuch    │
   │ Aufnahme    │                        │ Seite an Folie 1    │
   │ Chunk 0 ───►│ speichert media/…      │                     │
   │ ←/→ Folie ─►│ SlideEvent             │◄─ slide.changed     │
   │             │◄──── stroke.add ───────│ (nach jedem Strich) │
   │◄─ Strich ───│ (an alle Clients)      │                     │
   │             │◄──── marker.add ───────│ ❓ getippt           │
   │ Chunk n ───►│                        │                     │
   │ (Auto-)Stopp│ Session: beendet       │                     │
   │             │── Jobs anlegen ───────────────────────────────►│ transkribieren
   │             │                        │                     │ ausrichten
   │             │◄── Ergebnisse, Inbox-Vorschläge ──────────────│ Konzepte, Karten
   │ „Nacharbeitung bereit" (nur im Heute-Bildschirm, keine Push-Nachricht)
```

### 4.2 Upload von Folien und Übungen

`Web-App (Drag & Drop)` → `Core: speichert PDF, legt SlideDeck/ExerciseSheet an` → `Job pdf.ingest` → `Worker: Seiten rendern (PNG 2×), Text + Positionen extrahieren, bei fehlendem Textlayer Vision-Beschreibung` → `Job embed.slides` → `Job match.tasks_slides` (sobald Foliensatz und Übungsblatt existieren) → `Job prereq.check` (für kommende Vorlesungen).

### 4.3 Lernen

`Web-App/iPad: Karte beantwortet` → `Core: Review speichern, FSRS-Zustand aktualisieren, Beherrschung des Konzepts neu berechnen` → `bei falscher offener Antwort: Job grade.analyze_error` → `Schwächen-Score aktualisiert` → `Planer-Neuplanung (entprellt, max. 1×/min)`.

## 5. Zeitmodell

Alle Ereignisse einer Session (Strich, Folienwechsel, Marker, Foto, Audio-Chunk) brauchen dieselbe Zeitachse.

- **Referenzuhr ist der Core.** Jeder Client misst beim Verbinden und danach alle 5 Minuten seinen Uhrversatz: 5 Ping-Pong-Runden, Versatz = Median von `t_server − (t_send + t_recv)/2`.
- Clients speichern Ereignisse mit **lokaler Zeit + aktuellem Versatz**. Ist kein Versatz bekannt (iPad offline seit dem Start), wird mit Versatz 0 gespeichert und `clock_uncertain = true` gesetzt. Beim nächsten Verbinden wird nachkorrigiert, sobald ein Versatz gemessen ist. Die Uhren von iPad und Mac weichen dank NTP typischerweise weniger als 1 s ab.
- **Sitzungszeit** = Ereigniszeit − `session.started_at`, in Millisekunden. Alle Verknüpfungen (Strich ↔ Audio ↔ Folie) rechnen in Sitzungszeit.
- Audio: Jeder Chunk trägt `start_ms` in Sitzungszeit. Lücken (z. B. kurzer Absturz) bleiben als Lücke erhalten und werden nicht zusammengeschoben.

## 6. Verhalten ohne Verbindung

| Situation | iPad | Web-App | Ergebnis |
|---|---|---|---|
| iPad und Mac im selben Netz | Live-Sync, Folienwechsel in beide Richtungen | Notizen erscheinen nach jedem Strich | Normalfall |
| Uni-WLAN isoliert die Geräte | Schreibt normal weiter, alles in der Ausgangswarteschlange. Folie blättern nur lokal. Session startet über das iPad, wenn der Mac nicht erreichbar ist. | Aufnahme und Folienwechsel normal. Notizen-Spalte zeigt dezent „iPad nicht verbunden". | Abgleich beim nächsten Kontakt. Die Folienzuordnung der Seiten wird über Zeitstempel und F-NAC-03 rekonstruiert. |
| Mac ohne Internet | – | Alles außer Cloud-KI | Cloud-Jobs warten in der Warteschlange |
| Core abgestürzt | Schreibt weiter (lokal) | Aufnahme puffert bis zu 30 min in IndexedDB | Nach Neustart wird nachgeliefert |

**Regel:** Kein Bildschirm darf blockieren, weil eine Verbindung fehlt (LP3, LP5).

## 7. KI-Anbieter-Schnittstelle

Alle KI-Aufrufe laufen im Worker über eine interne Schnittstelle. So lassen sich Anbieter tauschen und Kosten steuern.

```python
class Transcriber(Protocol):
    def transcribe(self, audio: Path, language_hint: list[str]) -> list[Segment]: ...

class Embedder(Protocol):
    dim: int
    def embed(self, texts: list[str]) -> list[list[float]]: ...

class LLM(Protocol):
    def complete(self, task: str, messages: list[Msg], schema: type[BaseModel] | None,
                 tier: Literal["fast", "standard", "deep"], images: list[Path] = []) -> Result: ...

class Speech(Protocol):
    def synthesize(self, text: str, voice: str, lang: str) -> Path: ...
```

| Schnittstelle | Standard (lokal, kostenlos) | Alternative (Cloud) |
|---|---|---|
| Transcriber | `mlx-whisper` mit `large-v3-turbo` (Metal) | OpenAI-Whisper-API |
| Embedder | `BAAI/bge-m3` (mehrsprachig, 1024 Dimensionen) auf MPS | – |
| LLM | – (Cloud nötig) | Claude API. Stufen (Beispiel-IDs, konkrete Modell-Strings über `config/.env` und Einstellungen änderbar): `fast` = `claude-haiku-5-5`, `standard` = `claude-sonnet-5-5`, `deep` = `claude-opus-5-5`. |
| Speech | macOS-Stimmen (`say`) für Entwürfe | TTS-API für fertige Videos |

- Jeder LLM-Aufruf hat einen **`task`-Namen** (z. B. `concepts.extract`). Darüber laufen Kostenzähler, Logs und Prompt-Versionen.
- **Strukturierte Ausgaben** werden immer gegen ein Pydantic-Schema geprüft. Bei Fehlern: einmal neu versuchen mit Fehlermeldung, dann Job als `failed` markieren (kein stilles Weitermachen).
- **Modus „nur lokal"** (Einstellung): Cloud-LLM-Aufgaben werden übersprungen. Betroffene Funktionen zeigen „braucht Cloud-KI" statt eines Fehlers.

## 8. Sicherheit & Datenschutz (Architektur-Sicht)

- Der Core nimmt Verbindungen aus dem lokalen Netz nur mit gültigem **Geräte-Token** an. Das Token entsteht bei der Kopplung, siehe Kap. 08 §3. Die Web-App am Mac selbst (localhost) braucht kein Token.
- Kein Port wird ins Internet geöffnet. Keine Telemetrie.
- An die Cloud-KI gehen nur Texte, Folienbilder und die eigenen Antworten. **Audio nur, wenn die Cloud-Transkription gewählt ist.** Was wann gesendet wird, ist im Kostenzähler pro Job sichtbar.
- Details: [09-NFA §4](09-NFA.md#4-datenschutz--sicherheit).
