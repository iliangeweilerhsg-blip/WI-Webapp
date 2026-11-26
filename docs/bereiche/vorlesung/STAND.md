# Stand: vorlesung   (zuletzt: 26.11.2026, Claude)

Status: ruht (nicht im Pilot). Offen ist nur der Gerätetest zu #388.

## Bestand (kurz)
- iPad-App mit Tinte, Folien, Sync, Kopplung: [apps/ipad/Sources/](../../../apps/ipad/Sources/) (Ordner Ink, Slides, Sync, Pairing, Library).
- Web: Aufnahme in [apps/web/src/app/session/](../../../apps/web/src/app/session/), Dokumentansicht in [apps/web/src/app/dokument/](../../../apps/web/src/app/dokument/), Tinten-Renderer in [apps/web/src/components/ink/](../../../apps/web/src/components/ink/).
- Core-Routen für Sitzungen, Aufnahmen, Transkript, Notizbücher, Seiten, Fotos, Material: [services/core/src/routes/](../../../services/core/src/routes/).
- Strichformat v2 im Web (Fasen statt Keile, alte Striche dicker geschätzt) ist gemergt, siehe Commit-Verlauf zu `apps/web/src/components/ink`.
- Spezifikation: [04-FUNKTIONEN.md](../../spezifikation/04-FUNKTIONEN.md) (SES, INK, SYN, AUD), [08-SCHNITTSTELLEN.md](../../spezifikation/08-SCHNITTSTELLEN.md) (§4 Strich-Format).
- Pläne: [FOLIEN-SESSION.md](../../plaene/FOLIEN-SESSION.md), [T1-11-13-NOTIZBUECHER.md](../../plaene/T1-11-13-NOTIZBUECHER.md), [210-AUFNAHME-APPSHELL.md](../../plaene/210-AUFNAHME-APPSHELL.md).
- Anleitungen: [IPAD.md](../../anleitungen/IPAD.md), [VORLESUNGSTAG.md](../../anleitungen/VORLESUNGSTAG.md), [TRANSKRIPTION.md](../../anleitungen/TRANSKRIPTION.md).

## Läuft
- #324 H-3 (iPad-Teil) – nicht mehr blockiert, weil #388 gemergt ist. Startet, sobald der Bereich wieder aktiv ist.
- #79 – Ink-Renderer. Code erledigt, wartet auf die Messung des Owners (Zoom 1 und 2, Chrome und Safari).

## Fertig seit letzter Übersicht
- Kurze v1-Striche behalten ihre Fläche (#394, #396).
- Strichformat v2 auf dem iPad: Das iPad sendet die Breite je Punkt (#388, gemergt am 26.11.2026, schließt #382).

## Wartet auf den Owner
- iPad-App neu installieren und Füller-Striche auf dem Gerät mit dem Mac vergleichen (VERTRAEGE §23.10).
- Messung für #79.
- #287 – Wie soll das iPad melden, wenn es Notizbücher nicht speichern kann?
- #271 – Notizen zur selben Folie in mehreren Vorlesungen: eine Seite oder je Vorlesung eine?
- #240 – UX-54: Seiten von einem anderen iPad (oder nach Neuinstallation)?
- #239 – UX-45: Offline geschriebene Seiten nachträglich der Vorlesung zuordnen?
- #219 – iPad-Notizbücher: Blättern, Löschen, Verwalten, Folien vorab
- #209 – UX-28: Welcher Browser für die Aufnahme?
- #205 – UX-24: Falsche Vorlesung gestartet – was soll möglich sein?
- #201 – UX-20: Aufnahme bei zugeklapptem Mac?

## Schnittstellen, die andere Bereiche betreffen
- Strichformat v2 (VERTRAEGE §23) berührt iPad, Core und Web. Keine weitere Änderung offen.

## Als Nächstes
1. Gerätetest des Owners zu #388 auswerten.
2. #324 H-3 (iPad-Teil) angehen, sobald der Bereich wieder aktiv ist.
3. #79 schließen, sobald die Messung vorliegt.
