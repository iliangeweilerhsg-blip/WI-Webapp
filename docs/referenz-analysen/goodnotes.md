# GoodNotes – Recherche (öffentliche Quellen, 03.11.2026)

Methode: Stufe 1 (öffentliche Infos). Die App selbst wurde nicht untersucht.

## Abdeckband (Tape Tool) – Moment M7
- **Gesehen:** Werkzeug in der Schreibleiste. Man malt Band über Inhalte, tippt mit dem Finger darauf und deckt sie auf. Größe und Farbe sind einstellbar, im Menü gibt es „alles Band entfernen". Gedacht als Karteikarten-Ersatz direkt auf der Seite. [Hilfe-Center](https://support.goodnotes.com/hc/en-us/articles/9489290046607), [Blog](https://www.goodnotes.com/blog/tape-tool-tips-tricks), [Zusammenfassung](https://recapio.com/digest/new-goodnotes-6-features-in-2025-by-janice-good-mondays-paper)
- **Lücke laut Nutzer-Feedback:** Es fehlt ein Knopf, der alle Bänder auf einmal wieder zudeckt. Jedes muss einzeln angetippt werden. [Feedback](https://feedback.goodnotes.com/forums/191274-customer-suggestions-for-goodnotes-apple/suggestions/49168682-hide-all-masking-tapes-memorization-pens-display)
- **Unsere Umsetzung:** Band als eigenes Objekt über Strichen und Folien. Dazu „Alle zudecken" / „Alle aufdecken" pro Seite. **Neu:** Jedes Band kann eine Karteikarte werden (FSRS). Ich bewerte nach dem Aufdecken mit Nochmal/Gut, und das Band taucht in der Wiederholung auf.

## Formerkennung (Draw & Hold) – Moment M3
- **Gesehen:** Form zeichnen und den Stift am Ende halten. Die Form wird dann zu einer sauberen Linie, einem Kreis, einem Vieleck usw. Einschalten lässt sich das in den erweiterten Stifteinstellungen, die Form ist danach anpassbar. [Blog](https://www.goodnotes.com/blog/shape-recognition), [Feedback](https://feedback.goodnotes.com/forums/191274-customer-suggestions-for-goodnotes/suggestions/39359695-hold-stroke-for-perfect-shape)
- **Lücke laut Nutzer-Feedback:** Die Erkennung ist unzuverlässig, und der Textmarker kann nur gerade Linien.
- **Unsere Umsetzung:** Halten für ca. 0,5 s löst die Erkennung aus. Erkannt werden Linie, Pfeil, Rechteck, Kreis/Ellipse, Dreieck und Raute (wichtig für ER-Modelle und BPMN). Bei unsicherer Erkennung bleibt der Strich, wie er ist. Lieber gar nichts erkennen als falsch. PencilKit bietet dafür keine fertige Funktion, wir bauen sie selbst.

## Offen
- Details zu Lasso → Text und zur Handschriftsuche brauchen wir erst in Phase 2.
