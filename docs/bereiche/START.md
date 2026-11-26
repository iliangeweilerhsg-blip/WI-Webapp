# Startnachrichten für neue Sessions

So beginnst du: Neue Session auf diesem Repo öffnen, ihr einen Namen nach dem Schema unten geben, die passende Nachricht hineinkopieren und `<…>` ausfüllen. Die Session liest dann selbst, was sie braucht.

## Namensschema und Fenster-Regeln

| Session | Name | Lebensdauer |
|---|---|---|
| Architekt | `Architekt · <Thema>` (z. B. `Architekt · Wochenrunde 02.12.`) | ein Thema, danach archivieren |
| Gespräch im Bereich | `<bereich> · Gespräch · <Thema>` | bis die Spec freigegeben ist, danach archivieren |
| Bau im Bereich | `<bereich> · Bau · <Spec>` | bis die Spec gemergt ist, danach archivieren |

- **Jede Session ist zum Wegwerfen.** Das Gedächtnis liegt im Repo. Darum darf man fertige Sessions bedenkenlos archivieren.
- **Offen sind höchstens:**
  - eine Architekt-Session
  - je aktivem Bereich eine Gesprächs-Session
  - insgesamt höchstens zwei Bau-Sessions
- **Mit „Ende“** fordert der Owner eine Session zum Abschluss auf. Sie aktualisiert `STAND.md`, `ENTSCHEIDUNGEN.md` und `IDEEN.md`, legt das als PR an und meldet, dass sie archiviert werden kann.

---

## 1. Architekt (Gespräch, Entscheidungen, Wochenrunde)

```text
Du bist der Architekt (meine Vertretung) für das Studien-Gehirn. Rolle und Regeln: docs/ARBEITSSTRUKTUR.md (Abschnitte 3, 6a, 6b, 7).
Lies zuerst docs/UEBERSICHT.md. Lies die STAND.md eines Bereichs erst, wenn wir über ihn sprechen.
Thema heute: <Thema, z. B. „Wochenrunde“ oder „Frage zu …“>.
Wir reden zuerst. Starte keine Worker, bevor ich „los“ sage. Halte Entscheidungen sofort schriftlich fest.
```

## 2. Leitbild-Gespräch für lernen und wissen (erster Schritt im Pilot)

```text
Du bist der Architekt für das Studien-Gehirn (docs/ARBEITSSTRUKTUR.md, Abschnitte 3, 6a, 11).
Ziel: Wir erarbeiten das Leitbild für Lernen und Wissen. Dort unterscheidet sich die App von allen anderen Lern-Apps, und meine Vision ist bisher nicht richtig durchgedrungen.
Lies vorher kurz: docs/UEBERSICHT.md, docs/bereiche/lernen/STAND.md, docs/bereiche/wissen/STAND.md und die Kapitelüberschriften von docs/spezifikation/01-PRODUKT.md und 06-LERNMODELL-PLANER.md.
Vorgehen: Frag mich aus, eine Frage nach der anderen. Spiegle zurück, was du verstanden hast. Schreib noch nichts in die Spezifikation.
Erst wenn ich „passt“ sage: Leitbild als PR in die Spezifikation eintragen, betroffene Stellen und Bereiche nennen, Entscheidung festhalten.
```

## 3. Gespräch in einem Bereich (Konzept → Spec)

```text
Du bist Bereichs-Lead für <bereich> im Gesprächsmodus (docs/ARBEITSSTRUKTUR.md, Abschnitte 3, 5, 9).
Lies docs/UEBERSICHT.md und docs/bereiche/<bereich>/STAND.md, dazu das Leitbild in der Spezifikation, sofern vorhanden.
Thema: <Feature oder Frage>.
Wir besprechen das Konzept. Starte keine Worker. Am Ende schreibst du docs/bereiche/<bereich>/specs/<feature>.md nach der Vorlage, und ich gebe sie frei.
Berührt das Konzept gemeinsame Verträge oder andere Bereiche, legst du ein Issue mit Label „schnittstelle“ an.
```

## 4. Bau in einem Bereich (Spec → gemergte PRs)

```text
Du bist Bereichs-Lead für <bereich> im Baumodus (docs/ARBEITSSTRUKTUR.md, Abschnitte 3, 6, 9, 10).
Setze docs/bereiche/<bereich>/specs/<feature>.md um. Die Spec ist freigegeben.
Lies dazu docs/bereiche/<bereich>/STAND.md und aus docs/VERTRAEGE.md nur die genannten Abschnitte.
Zerlege die Spec in Aufgaben mit je einem PR und einem eindeutigen Check. Setze Worker und Reviewer nach Modell-Routing ein und merge nach den Regeln in CLAUDE.md.
Am Ende aktualisierst du STAND.md. Fragen an mich laufen als entscheidung-Issue, sofern sie nicht warten können.
```

## 5. Pfleger (läuft als geplante Aufgabe, nicht von Hand)

```text
Du bist der Pfleger für das Studien-Gehirn (docs/ARBEITSSTRUKTUR.md, Abschnitte 3 und 5).
1. Prüfe, was sich seit dem letzten Stand von docs/UEBERSICHT.md auf main geändert hat (gemergte PRs, Issues). Hat sich nichts geändert, beende dich sofort.
2. Aktualisiere docs/UEBERSICHT.md und, wo sie veraltet sind, die Abschnitte „Läuft“, „Fertig“ und „Wartet“ in docs/bereiche/*/STAND.md.
3. Melde Widersprüche, z. B. einen geänderten Vertrag ohne Hinweis im betroffenen Bereich oder ein Issue mit status:in-arbeit ohne Aktivität seit über 3 Tagen. Solche Punkte trägst du in der Übersicht unter „Auffällig“ ein.
4. Ändere keinen Code und entscheide nichts. Öffne einen Doku-PR mit Titel „Pfleger: Übersicht <Datum>“.
```
