# Design-Fahrplan Studien-Gehirn

Diese Liste führt Schritt für Schritt durch die Gestaltung der App, so wie ein Produktteam vorgeht: erst **was wir ausdrücken**, dann **Struktur**, dann **Optik**, dann **Baukasten** und **Umsetzung**.

**Ausgangslage (17.11.2026):** Wir starten bei null. Die heutige Oberfläche ist ein Platzhalter, um Funktionen zu testen. Das **Funktionskonzept** steht ([Spezifikation](../spezifikation/00-UEBERSICHT.md)), der **Aufbau** darf sich noch ändern. Gestaltungsregeln aus der Konzeptphase (z. B. [07-UX.md](../spezifikation/07-UX.md)) sind nur Entwürfe und nicht bindend.

## Rollen

| Wer | Rolle |
|---|---|
| **Du** | Gibst die Impulse, hast die Ideen und triffst die Entscheidungen. |
| **Claude** | **Beobachterin:** achtet darauf, dass wir keinen Schritt überspringen. **Beraterin:** erklärt Prinzipien, Hintergründe und Psychologie. **Qualitätsprüferin:** prüft jeden Teilschritt gegen die Freigabekriterien. Erst wenn sie einverstanden ist, geht es weiter. |

Claude macht keine Gestaltungsvorschläge oder Optionslisten, außer du fragst ausdrücklich danach. Wenn du willst, setzt Claude deine Ideen sichtbar um, ohne eigene Richtung hineinzulegen.

Jede Entscheidung wird mit ihren Alternativen in [DESIGN-ENTSCHEIDUNGEN.md](DESIGN-ENTSCHEIDUNGEN.md) festgehalten.

**Legende:** `[ ]` offen · `[x]` freigegeben · ⛳ Freigabe-Tor am Ende jeder Phase

---

## Phase 1 – Fundament: Was soll die App ausstrahlen?

*Warum zuerst:* Jede spätere Entscheidung (Farbe, Schrift, Layout) braucht einen Maßstab. Ohne ihn wird nach Geschmack entschieden, und das Ergebnis wirkt beliebig.

- [x] **Für wen und in welcher Lage:** Wer nutzt die App, wann, wo, in welcher Stimmung?
- [x] **Gefühlsmomente:** Wie soll es sich anfühlen, die App in typischen Situationen zu öffnen?
- [x] **Markenattribute:** 3–5 Eigenschaften, die die App ausstrahlen soll, jeweils mit Bedeutung und Gegenteil.
- [ ] **Abgrenzung:** Wie soll die App auf keinen Fall wirken?
- [ ] **Design-Prinzipien:** wenige Leitsätze, die bei späteren Streitfragen entscheiden.
- [ ] **Name und Zeichen:** Bleibt der Name? Braucht es ein Logo oder Icon?

**Ergebnis:** `docs/ux/MARKENKERN.md`, in deinen Worten

**Freigabekriterien:**
- Jedes Attribut ist **konkret**: Ein Konkurrent könnte bewusst das Gegenteil wählen. „Modern“ oder „benutzerfreundlich“ zählen nicht, die will jeder.
- Jedes Attribut hat eine Erklärung, woran man es später im Design **erkennt**.
- Jedes Prinzip kann einen echten **Konflikt entscheiden** (A gegen B), sonst ist es Deko.
- Attribute und Prinzipien **widersprechen sich nicht**, oder der Vorrang ist geklärt.
- Die Gefühlsmomente passen zu echten Situationen aus deinem Studienalltag.

⛳ Freigabe Phase 1

---

## Phase 2 – Bestandsaufnahme und Inspiration

*Warum:* Gutes Design erfindet selten alles neu. Man lernt von dem, was funktioniert, und versteht, *warum* es funktioniert.

- [ ] **Konkurrenz und Vorbilder:** Welche Apps nutzt du fürs Studium und im Alltag gern? Was genau gefällt dir daran?
- [ ] **Moodboard:** Bilder, Apps, Websites, Gegenstände, die das Gefühl aus Phase 1 treffen, jeweils mit einem Satz *warum*.
- [ ] **Anti-Moodboard:** Beispiele, die das Gegenteil sind, mit Begründung.
- [ ] **Abgleich mit Phase 1:** Passt die Sammlung zum Markenkern? Wo nicht, was ist falsch: die Sammlung oder der Markenkern?

**Ergebnis:** `docs/ux/MOODBOARD.md` (oder eine Bildersammlung)

**Freigabekriterien:**
- Jedes Beispiel hat eine **Begründung**, die über „sieht gut aus“ hinausgeht.
- Ein gemeinsamer roter Faden ist erkennbar, und der passt zum Markenkern.
- Klar ist, was wir **übernehmen** wollen (Prinzip) und was nicht (Kopie).

⛳ Freigabe Phase 2

---

## Phase 3 – Struktur: Layout ohne Farbe

*Warum ohne Farbe:* Farbe lenkt ab. In Graustufen diskutiert man darüber, ob etwas am richtigen Platz ist, nicht darüber, ob einem das Grün gefällt.

- [ ] **Bereiche und Navigation:** Welche Hauptbereiche hat die App, wie kommt man dorthin? (Hier passt du den Aufbau an.)
- [ ] **Wichtigste Abläufe:** die 3–5 häufigsten Wege Schritt für Schritt, z. B. „Vorlesung mitschreiben“ oder „Lücke zum Lernen nutzen“.
- [ ] **Hierarchie pro Bildschirm:** Was ist das Wichtigste, was das Zweitwichtigste, was darf versteckt sein?
- [ ] **Wireframes in Graustufen** für die Schlüssel-Bildschirme.
- [ ] **Geräte (iPhone, iPad, Mac):** Was ist gleich, was unterscheidet sich? Das iPhone ist im bisherigen Konzept nicht vorgesehen, siehe [Markenkern, offene Punkte](MARKENKERN.md).

**Ergebnis:** Struktur-Dokument und Wireframes

**Freigabekriterien:**
- Jeder Ablauf lässt sich durchspielen, ohne Sackgasse und ohne unnötige Schritte.
- Pro Bildschirm gibt es **ein** klar erkennbares Hauptziel.
- Die Struktur folgt den Design-Prinzipien aus Phase 1, nachweisbar an Beispielen.

⛳ Freigabe Phase 3

---

## Phase 4 – Visuelle Sprache: Farben, Schrift, Form

*Warum erst jetzt:* Jetzt gibt es einen Maßstab (Phase 1), Vorbilder (Phase 2) und Inhalte mit Gewichtung (Phase 3). Farbe und Schrift dienen diesen drei.

- [ ] **Farben:** Welche Farbrollen braucht die App, und warum? Hell- und Dunkelmodus.
- [ ] **Typografie:** Schrift, Größenstufen, Gewichte, Zeilenabstand.
- [ ] **Raster und Abstände.**
- [ ] **Form:** Ecken, Linien, Ebenen und Tiefe.
- [ ] **Icons und Bilder.**
- [ ] **Bewegung:** Wann bewegt sich etwas, wie schnell, warum?
- [ ] **Sprache und Ton** der Texte in der App.

**Ergebnis:** Style-Guide (alles auf einer Seite)

**Freigabekriterien:**
- Jede Entscheidung lässt sich auf ein Attribut oder Prinzip aus Phase 1 **zurückführen**.
- Kontraste erfüllen die Barrierefreiheits-Norm (WCAG AA). Information hängt nie nur an Farbe.
- Hell- und Dunkelmodus sind beide durchdacht.
- Getestet mit echtem Inhalt, nicht mit Platzhaltertext.

⛳ Freigabe Phase 4

---

## Phase 5 – Design-System: der Baukasten

*Warum:* Ein Baukasten sorgt dafür, dass jeder Bildschirm aus einem Guss ist, auch wenn er Monate später entsteht.

- [ ] **Design-Tokens:** die Werte aus Phase 4 als benannte Variablen (Web und iPad aus einer Quelle).
- [ ] **Komponenten-Inventar:** Welche Bausteine brauchen wir?
- [ ] **Zustände:** normal, Hover, Fokus, deaktiviert, lädt, Fehler, leer.
- [ ] **Galerie:** alle Bausteine live auf einer Seite.

**Freigabekriterien:**
- Jede Komponente hat alle Zustände.
- Bedienbar per Tastatur und mit Screenreader.
- Keine Werte außerhalb der Tokens.

⛳ Freigabe Phase 5

---

## Phase 6 – Ausgearbeitete Entwürfe und Test

*Warum:* Was im Entwurf gut aussieht, kann sich im Alltag falsch anfühlen. Erst der Gebrauch zeigt es.

- [ ] **Schlüssel-Bildschirme ausarbeiten**, mit echtem Inhalt.
- [ ] **Klickbarer Prototyp** der Abläufe aus Phase 3.
- [ ] **Alltagstest:** eine Woche benutzen, Reibungen notieren.
- [ ] **Nachbessern.**

**Freigabekriterien:** Die Reibungspunkte aus dem Alltagstest sind gelöst oder bewusst vertagt.

⛳ Freigabe Phase 6

---

## Phase 7 – Umsetzung

- [ ] **App-Rahmen zuerst**, weil alles darauf sitzt.
- [ ] **Bildschirm für Bildschirm**, ein PR pro Bildschirm, mit Vorher/Nachher-Screenshot.
- [ ] **Design-Prüfung nach jedem PR** gegen den Style-Guide.
- [ ] **iPad nachziehen.**

---

## Phase 8 – Pflege

- [ ] **Design-Regeln in die Projektregeln** ([AGENTS.md](../../AGENTS.md)) aufnehmen.
- [ ] **Regelmäßige Prüfung**, z. B. am Ende jedes Meilensteins.
