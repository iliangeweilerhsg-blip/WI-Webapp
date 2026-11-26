# Stand: plattform   (zuletzt: 26.11.2026, Claude (Übergabe))

Status: ruht.

## Bestand (kurz)
- `sg`-Start und Befehle: [infra/sg/](../../../infra/sg/), Infrastruktur in [infra/](../../../infra/) (docker-compose.yml).
- Mac-Tunnel (Swift): [apps/mac-tunnel/](../../../apps/mac-tunnel/). Anleitung: [IPAD-VERBINDUNG.md](../../anleitungen/IPAD-VERBINDUNG.md).
- Core: Geräte und Kopplung ([routes/devices.ts](../../../services/core/src/routes/devices.ts)), Backups ([routes/backups.ts](../../../services/core/src/routes/backups.ts)), Papierkorb ([routes/trash.ts](../../../services/core/src/routes/trash.ts)), System, Einstellungen.
- Backup mit Prüfung verlinkter Dateien (#324, #368). Anleitung: [BACKUP-WIEDERHERSTELLEN.md](../../anleitungen/BACKUP-WIEDERHERSTELLEN.md).
- CI-Skripte: [scripts/ci/](../../../scripts/ci/).
- Spezifikation: [09-NFA.md](../../spezifikation/09-NFA.md), [02-ARCHITEKTUR.md](../../spezifikation/02-ARCHITEKTUR.md) (§8 Sicherheit). Plan: [UX-12-MAC-WIEDERFINDEN.md](../../plaene/UX-12-MAC-WIEDERFINDEN.md).

## Läuft
- #304 – Security-Audit (UX-12), Meilenstein M1 wartet auf den Owner.

## Fertig seit letzter Übersicht
- CI: wackelnde Tests stabilisiert (Backup, Zeittest).

## Wartet auf den Owner
- M1 aus #304 (Security-Audit).
- #208 – UX-27: Backup-Ziel und Verschlüsselung
- #206 – UX-25: Bezahltes Apple-Entwicklerkonto (99 €/Jahr)?
- #203 – UX-22: Datenbank in Docker oder nativ (8 GB)?
- #202 – UX-21: Studien-Gehirn ohne Terminal starten?

## Schnittstellen, die andere Bereiche betreffen
- Keine offen.

## Als Nächstes
1. Owner liefert M1 für #304.
2. Entscheidungen #208, #206, #203, #202 nach Bedarf.
