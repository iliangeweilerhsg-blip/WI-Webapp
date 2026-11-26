# Stand: lernen   (zuletzt: 26.11.2026, Claude (Übergabe))

Status: AKTIV im Pilot. Der Owner hat am 26.11.2026 den Pilot mit lernen und wissen gewählt. Erster Schritt: Leitbild-Gespräch.

## Bestand (kurz)
- Web-Ansicht Lernen: [apps/web/src/app/lernen/](../../../apps/web/src/app/lernen/) und [apps/web/src/components/learn/](../../../apps/web/src/components/learn/) (Lernen, Karten verwalten, Karte von Hand anlegen).
- Core: [services/core/src/learning/](../../../services/core/src/learning/) (FSRS, Warteschlange, Tageswechsel), [routes/cards.ts](../../../services/core/src/routes/cards.ts), [services/cards.ts](../../../services/core/src/services/cards.ts).
- Worker: [sg_worker/cards/](../../../services/worker/src/sg_worker/cards/).
- Kartenformat: [08-SCHNITTSTELLEN.md](../../spezifikation/08-SCHNITTSTELLEN.md) §6.
- Spezifikation: [04-FUNKTIONEN.md](../../spezifikation/04-FUNKTIONEN.md) (LRN), [06-LERNMODELL-PLANER.md](../../spezifikation/06-LERNMODELL-PLANER.md).
- Anleitungen: [LERNEN.md](../../anleitungen/LERNEN.md), [KARTEN-PRUEFEN.md](../../anleitungen/KARTEN-PRUEFEN.md).

## Läuft
- Noch nichts. Zuerst Leitbild-Gespräch.

## Fertig seit letzter Übersicht
- Karten verwalten (F-LRN-16) und Karte von Hand anlegen (B5) im Web.

## Wartet auf den Owner
- #328 – Was kommt als Nächstes: Lernen (Karten + Wiederholung) oder Phase 2 fertig? Der Owner hat mit dem Pilot Richtung Lernen entschieden. Das Issue bleibt offen, der Architekt schließt es nach dem Leitbild-Gespräch.
- #207 – UX-26: Lernfunktionen vor der Prüfungsphase vorziehen?

## Schnittstellen, die andere Bereiche betreffen
- Karten kommen aus wissen (Konzepte, Inbox). Änderungen am Kartenformat gehen an den Architekten.

## Als Nächstes
1. Leitbild-Gespräch mit dem Owner (ARBEITSSTRUKTUR §11).
2. #328 und #207 danach schließen oder neu fassen.
