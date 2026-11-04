# Hörsaal-Tests & Abnahme von Phase 1 (`T1-20` · `09 §6` · `10 §3`)

In diesem Ordner liegen die Vorlagen und die ausgefüllten Testprotokolle für echte Vorlesungen. Jede Phase-1-Version wird vor ihrer Freigabe im echten Hörsaal-Betrieb geprüft (`docs/spezifikation/09-NFA.md` §6).

## Wofür ist dieser Ordner da?

Technische Tests am Schreibtisch finden nicht heraus, ob die App im echten Vorlesungsalltag ruhig bleibt, ob das Uni-WLAN zickt oder ob beim schnellen Mitschreiben Striche verloren gehen. Deshalb gilt für **Phase 1 (Vorlesung)** laut [`docs/spezifikation/10-UMSETZUNG.md`](../../spezifikation/10-UMSETZUNG.md) (§3):

1. **Vor dem ersten Hörsaal-Einsatz (und nach Änderungen an der Stift-Logik):** Einmalig den **5-Minuten-Blindvergleich gegen GoodNotes** ([`BLINDVERGLEICH.md`](BLINDVERGLEICH.md)) durchführen.
2. **Vor Freigabe jeder Phase-1-Version:** Mindestens eine echte Vorlesung mit der Checkliste ([`VORLAGE.md`](VORLAGE.md)) begleiten.
3. **Für die Gesamtabnahme von Phase 1:** **3 echte Vorlesungen** in Folge ohne Strichverlust (`0`), mit Audioverlust `≤ 30 s` und Startzeit `≤ 10 s` bestehen.

---

## Welche Phase-1-Kriterien werden wo geprüft?

Nicht jedes Abnahmekriterium aus `10-UMSETZUNG.md` §3 und `09-NFA.md` §1–3 lässt sich während einer laufenden Vorlesung messen. Hier ist die Aufteilung:

| Abnahmekriterium (`10 §3` / `09 §1–3`) | Grenzwert | Wo wird es geprüft? |
| :--- | :--- | :--- |
| **Heute-Bildschirm öffnen** | `< 2 s` | **Im Hörsaal** ([`VORLAGE.md`](VORLAGE.md) §2.4) |
| **Ein-Tipp-Start bis laufende Aufnahme** | `≤ 10 s`, `1` Tipp, `0` Dialoge | **Im Hörsaal** ([`VORLAGE.md`](VORLAGE.md) §2.5 & §6) |
| **Strichverlust** | **`0` Striche** (3 echte Vorlesungen) | **Im Hörsaal** ([`VORLAGE.md`](VORLAGE.md) §4.1 & §6) |
| **Audioverlust** | **`≤ 30 s`** (bei Netzunterbrechung `0 s`) | **Im Hörsaal** ([`VORLAGE.md`](VORLAGE.md) §4.2 & §6) |
| **Live-Spiegelung (gleiches WLAN)** | Strich `≤ 1 s`, Folie `< 300 ms` | **Im Hörsaal** ([`VORLAGE.md`](VORLAGE.md) §3, §4.3 & §6) |
| **Offline-Betrieb & Nachsynchronisation** | Keine Blockade (`R14`), Sync vollständig | **Im Hörsaal** ([`VORLAGE.md`](VORLAGE.md) §2.3, §4 & §6) |
| **Ruhe in der Vorlesung (`R1–R4`)** | `0` modale Dialoge / Popups | **Im Hörsaal** ([`VORLAGE.md`](VORLAGE.md) §3, §5 & §6) |
| **Blindvergleich Schreibgefühl (`F-INK-01`)** | `≥ GoodNotes` (5 min gleiche Seite) | **Separat am Schreibtisch** mit [`BLINDVERGLEICH.md`](BLINDVERGLEICH.md) |
| **Spikes `S1`–`S4` entschieden** | Entscheidungen dokumentiert | **Separat vorab** in `docs/entscheidungen/S1.md`–`S4.md` |
| **Backup & Wiederherstellung (`F-DAT-01/-02`)** | Backup ≤ 24 h, Restore fehlerfrei | **Separat am Mac** (`pnpm sg backup` & `pnpm sg restore` + automatischer Test) |
| **7-Tage-Signatur-Ablauf iPad (`09 §2`)** | `0` Datenverlust beim Neu-Aufspielen | **Separat beim App-Update** (lokaler Container + Mac-Abgleich) |

---

## Ablauf für eine Test-Vorlesung (15 Minuten gesamt)

1. **Vorlage kopieren (vor der Vorlesung):**
   Lege für die Vorlesung eine neue Datei mit dem Datum und dem Modulkürzel an:
   ```bash
   cp docs/tests/hoersaal/VORLAGE.md docs/tests/hoersaal/JJJJ-MM-TT-modul.md
   ```
   *(Beispiele: `2026-11-10-dbs.md`, `2026-11-12-mikro1.md`)*
2. **5 Minuten vor Beginn:** Abschnitt **1 (Kopfdaten)** und **2 (Vor der Vorlesung)** ausfüllen, Stoppuhr bereitlegen und per **[ Start ]** in die Vorlesung starten.
3. **Während der Vorlesung:** Ganz normal mit dem iPad mitschreiben. Nur falls etwas hakt, in Abschnitt **3** einen Strich oder eine kurze Zeitnotiz machen.
4. **10 Minuten direkt nach Ende:** Abschnitte **4 bis 6** durchgehen (Seitenzahl und 3 Stichproben-Seiten vergleichen, kurz in die Audiodatei hören, Bewertung `1–5` ankreuzen).

---

## Wie du das Ergebnis an Claude gibst

Sobald du `docs/tests/hoersaal/JJJJ-MM-TT-modul.md` (oder `BLINDVERGLEICH.md`) ausgefüllt und gespeichert hast, schreibst du Claude im Chat einfach kurz:

> *„Hörsaal-Protokoll `docs/tests/hoersaal/2026-11-10-dbs.md` ist ausgefüllt – bitte auswerten."*

Claude liest die Datei direkt aus dem Repository, prüft alle Grenzwerte in Abschnitt 6, übernimmt das Ergebnis in den Abnahmestand und legt bei nicht bestandenen Punkten automatisch die nötigen Korrektur-Aufgaben an.
