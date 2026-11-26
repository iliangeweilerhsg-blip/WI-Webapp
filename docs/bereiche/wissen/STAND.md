# Stand: wissen   (zuletzt: 26.11.2026, Claude (Übergabe))

Status: AKTIV im Pilot. Erster Schritt: Leitbild-Gespräch (ARBEITSSTRUKTUR §11).

## Bestand (kurz)
- Suche ⌘K: [apps/web/src/components/search/](../../../apps/web/src/components/search/), Core [routes/search.ts](../../../services/core/src/routes/search.ts) und [services/search.ts](../../../services/core/src/services/search.ts). Anleitung: [SUCHE.md](../../anleitungen/SUCHE.md).
- Konzepte und Bibliothek: [apps/web/src/components/concepts/](../../../apps/web/src/components/concepts/), Core [routes/concepts.ts](../../../services/core/src/routes/concepts.ts), Worker [sg_worker/concepts/](../../../services/worker/src/sg_worker/concepts/).
- Inbox mit Vorschlägen: [apps/web/src/components/inbox/](../../../apps/web/src/components/inbox/), Core [services/inbox.ts](../../../services/core/src/services/inbox.ts).
- Rückblick mit Zusammenfassung, Transkript, Notizen: [apps/web/src/components/rueckblick/](../../../apps/web/src/components/rueckblick/), Core [routes/summary.ts](../../../services/core/src/routes/summary.ts) und [routes/review.ts](../../../services/core/src/routes/review.ts).
- Kosten: Core [routes/costs.ts](../../../services/core/src/routes/costs.ts).
- Spezifikation: [04-FUNKTIONEN.md](../../spezifikation/04-FUNKTIONEN.md) (NAC, BIB, SUC), [05-KI-PIPELINE.md](../../spezifikation/05-KI-PIPELINE.md).
- Suche zuletzt verbessert (Review #401, Zeitlimit mit 503 `search_timeout`).

## Läuft
- #324 – Restpunkte zu Konzepten, Inbox und Netz-Wächter (ohne H-3, das gehört zu vorlesung).
- #334 – Suche, Leistung. Erledigt durch #398 und #401, Rest ist optional.

## Fertig seit letzter Übersicht
- Suche: Leistung und Zeitlimit (#398, #401).
- Inbox: also_changed und Namen in der Beziehungs-Nutzlast (Teil von #324).

## Wartet auf den Owner
- #204 – UX-23: Wann soll nach der Vorlesung verarbeitet werden?
- #189 – Monatsbudget und Automatik für die KI-Konzepte

## Schnittstellen, die andere Bereiche betreffen
- Keine offen.

## Als Nächstes
1. Leitbild-Gespräch mit dem Owner (ARBEITSSTRUKTUR §11).
2. Restpunkte aus #324 abarbeiten.
3. #334 schließen oder den optionalen Rest entscheiden.
