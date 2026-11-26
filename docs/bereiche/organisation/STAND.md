# Stand: organisation   (zuletzt: 26.11.2026, Claude (Übergabe))

Status: ruht.

## Bestand (kurz)
- Web: [abgabe](../../../apps/web/src/app/abgabe/), [kalender](../../../apps/web/src/app/kalender/), [planer](../../../apps/web/src/app/planer/), Moodle-Bausteine in [apps/web/src/components/moodle/](../../../apps/web/src/components/moodle/).
- Core Moodle: [services/core/src/moodle/](../../../services/core/src/moodle/), [routes/moodle.ts](../../../services/core/src/routes/moodle.ts) (inkl. Recheck).
- Core Kalender und Organisation: [routes/calendar.ts](../../../services/core/src/routes/calendar.ts), [routes/organisation.ts](../../../services/core/src/routes/organisation.ts).
- Abgleich zur Vorlesung (LectureSync, F3a) ist im Core vorhanden.
- Spezifikation: [04-FUNKTIONEN.md](../../spezifikation/04-FUNKTIONEN.md) (ORG, KAL, MDL).
- Plan: [T1-24-MOODLE-AKTIONEN.md](../../plaene/T1-24-MOODLE-AKTIONEN.md). Anleitungen: [MOODLE.md](../../anleitungen/MOODLE.md), [MOODLE-TOKEN.md](../../anleitungen/MOODLE-TOKEN.md).

## Läuft
- Nichts aktiv.
- #322 – Moodle-Token an die Aktion binden (Priorität niedrig). Wartet auf #289.
- #93 – Moodle-Härtung, Rest Punkt 4, gemeinsam mit T1-24. Wartet auf #289.
- #308 Teil UX-314 – Abgabestand in der Fristenliste. Zurückgestellt bis zum ersten echten Moodle-Test.

## Fertig seit letzter Übersicht
- Moodle-Recheck und Token-Übernahme im Core (siehe Commit-Verlauf zu `services/core/src/moodle`).

## Wartet auf den Owner
- #289 – Moodle-Abgaben aus Studien-Gehirn: Umfang und Grenzen (T1-24)

## Schnittstellen, die andere Bereiche betreffen
- Keine offen.

## Als Nächstes
1. Owner entscheidet #289, danach #322 und #93.
2. UX-314 nach dem ersten echten Moodle-Test.
