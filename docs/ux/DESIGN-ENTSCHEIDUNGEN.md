# Design-Entscheidungen

Hier steht jede Entscheidung aus dem [Design-Prozess](DESIGN-FAHRPLAN.md) zusammen mit den **Alternativen**, die im Raum standen, und dem **Grund**. So lässt sich später nachvollziehen, *warum* etwas so ist, und eine Entscheidung kann bewusst wieder geöffnet werden.

**Regeln**
- Jede neue Entscheidung bekommt sofort einen Eintrag, und die Nummern bleiben fest.
- Wird eine Entscheidung geändert, bleibt der alte Eintrag stehen. Er wird als *ersetzt durch Nr. X* markiert, und es gibt einen neuen Eintrag.
- **Status:** ✅ fest · 🔶 vorläufig (wird später noch geprüft) · ❓ offen (Alternativen stehen, Entscheidung fehlt) · ⛔ ersetzt
- **Woher die Alternativen kommen:** *Owner* = von dir eingebracht. *Prüfung* = als Einwand oder aus der Forschung von Claude eingebracht.

---

## Prozess und Zusammenarbeit

### E1 · Design neu aufbauen oder Platzhalter verfeinern ✅
- **Datum:** 17.11.2026
- **Alternativen:** (a) die bestehende Oberfläche und die Regeln aus 07-UX weiterentwickeln · (b) ganz von vorn anfangen
- **Entscheidung:** (b). Die heutige Oberfläche ist nur ein Platzhalter, um Funktionen zu testen. Die Regeln in 07-UX sind Entwürfe und nicht bindend. Das Funktionskonzept bleibt, der Aufbau darf sich ändern.
- **Grund:** Das Design soll von unten aufgebaut werden statt aus einem Platzhalter heraus.

### E2 · Wer gibt die Richtung vor ✅
- **Datum:** 17.11.2026
- **Alternativen:** (a) Claude legt Optionen und Auswahlboxen vor · (b) der Owner gibt die Impulse, Claude beobachtet, berät und prüft
- **Entscheidung:** (b). Optionen nur, wenn der Owner ausdrücklich danach fragt.
- **Grund:** kreativ frei bleiben, nicht in eine Richtung gelenkt werden, den Prozess selbst lernen. Hintergrund ist der Ankereffekt: Vorgelegte Optionen ziehen das Urteil in ihre Richtung.

### E3 · Begriffe aus dem alten Konzept als Startpunkt ✅
- **Datum:** 17.11.2026
- **Alternativen:** (a) „ruhig, klar, verlässlich, ehrlich“ aus der Spezifikation als Grundlage nehmen · (b) verwerfen und neu erarbeiten
- **Entscheidung:** (b)
- **Grund:** Diese Begriffe stammen aus dem alten Konzept, nicht vom Owner (Ankereffekt).

### E4 · Fragen gebündelt oder einzeln ✅
- **Datum:** 24.11.2026
- **Alternativen:** (a) mehrere Prüffragen auf einmal · (b) eine Frage nach der anderen
- **Entscheidung:** (b)
- **Grund:** Jede Antwort wird gründlicher, wenn sie für sich allein steht.

### E5 · Arbeitsstand sichern ✅
- **Datum:** 24.11.2026
- **Alternativen:** (a) Dateien lokal liegen lassen · (b) per PR ins Repo
- **Entscheidung:** (b), und künftig nach jedem freigegebenen Schritt. Fahrplan und Markenkern sind über PR #402 gesichert.

### E6 · Entscheidungen mit Alternativen festhalten ✅
- **Datum:** 25.11.2026
- **Alternativen:** (a) nur Ergebnisse im Markenkern · (b) zusätzlich ein eigenes Entscheidungsprotokoll mit Alternativen
- **Entscheidung:** (b), also diese Datei
- **Grund:** Der Owner will nachvollziehen können, wo zwischen mehreren Dingen gewählt wurde.

---

## Phase 1 · Nutzungskontext und Gefühle (Schritte 1.1 und 1.2)

### E7 · Im Urlaub ⛔ ersetzt durch E8
- **Datum:** 17.11.2026
- **Entscheidung:** Im Urlaub will der Owner die App nicht öffnen.

### E8 · Im Urlaub ✅
- **Datum:** 25.11.2026
- **Alternativen:** (a) die App im Urlaub bewusst nicht öffnen (E7) · (b) die App auch im Urlaub öffnen
- **Entscheidung:** (b)
- **Grund (Owner):** Das Prinzip „Erfolg ist relativ“ (E15) gilt auch dort. Die Wahrscheinlichkeit, dass er die App öffnet, ist im Urlaub am geringsten, gerade deshalb zählt jedes Öffnen.
- **Bewusst in Kauf genommen:** Die Erholungsforschung (Sonnentag & Fritz) betont, wie wichtig gedankliches Abschalten ist. Der Owner hat das gehört und anders entschieden.

### E9 · Schreibtisch: wie fordernd ✅
- **Datum:** 17.11.2026
- **Alternativen (Prüfung):** (a) leicht, damit keine Überforderung entsteht · (b) fordernd
- **Entscheidung:** (b), fordernd, aber nicht überfordernd
- **Grund (Owner):** „Am Schreibtisch entsteht das tiefe Wissen. Es ist immer noch eine Lern-App.“

### E10 · „Die ganze Nacht lernen“ ✅
- **Datum:** 17.11.2026
- **Alternativen:** (a) wörtlich · (b) als Bild
- **Entscheidung:** (b). Gemeint ist das Gefühl, nicht aufhören zu wollen.

### E11 · Umgang mit Schwächen ✅
- **Datum:** 17.11.2026
- **Alternativen (Prüfung):** (a) Schwächen zeigen · (b) Schwächen zurückhalten, damit man nicht erschlagen wird
- **Entscheidung:** (a), aber **mit Führung**
- **Grund (Owner):** „Wenn ich an die Hand genommen und durch das Problem geführt werde, ist es nicht schlimm, meine Schwächen zu sehen.“

### E12 · Vorlesung: echter Vergleich oder Gefühl ✅
- **Datum:** 17.11.2026, bestätigt am 25.11.2026 (siehe E19)
- **Alternativen (Prüfung):** (a) Leistungsziel, also echter Vergleich mit den anderen · (b) Lernziel, also das Gefühl, bestens vorbereitet zu sein
- **Entscheidung:** (b). „Es geht um das Gefühl, nicht um einen echten Vergleich.“

---

## Phase 1 · Der Begleiter (Schritt 1.3, in Arbeit)

### E13 · Wofür gelobt wird ✅
- **Datum:** 24.11.2026
- **Alternativen (Prüfung, nach Mueller & Dweck):** (a) Lob für Eigenschaften wie „du bist schlau“ · (b) Lob für Anstrengung und Vorgehen
- **Entscheidung:** (b), genauer: Lob für **Anstrengung**, für **selbst hergestellte Zusammenhänge** und für den **Versuch, sich etwas selbst zu erschließen**, statt nach der Lösung oder nach Hinweisen zu fragen. Das Lob ist **an die Anforderung angepasst**: Am Schreibtisch geht es um komplexe Aufgaben, im Bett um leichte Abfragen, spielerisch.

### E14 · Wann die Beispielsätze entstehen ✅
- **Datum:** 24.11.2026
- **Alternativen:** (a) jetzt in Schritt 1.3 · (b) später in Phase 4 (Sprache und Ton)
- **Entscheidung:** (b)
- **Grund (Owner):** Die Sätze folgen aus der Persönlichkeit, die noch nicht feststeht.
- Ebenso verschoben: „Wofür er nicht lobt“ wandert nach Schritt 1.4 (Abgrenzung).

### E15 · Was als Erfolg zählt ✅
- **Datum:** 25.11.2026
- **Alternativen:** (a) Erfolg gemessen an fester Leistung · (b) Erfolg relativ zur Situation und zur Wahrscheinlichkeit, die App gerade überhaupt zu öffnen
- **Entscheidung:** (b), vom Owner selbst eingebracht. Schon die kleinste Aufgabe ist mehr als gar nicht in der App zu sein.

### E16 · Wie schwer die Aufgaben sind ✅
- **Datum:** 25.11.2026
- **Alternativen:** (a) gleichbleibende Schwierigkeit · (b) in den ersten Minuten an die Situation angepasst, danach steigend
- **Entscheidung:** (b). Dafür muss die App das Verhalten des Owners analysieren (Funktionsanforderung für Phase 3).

### E17 · Duolingo als Vorbild 🔶
- **Datum:** 24.11.2026
- **Alternativen (Prüfung):** (a) Vorbild für **verspieltes Aussehen**, also Figuren, Farben, Animationen · (b) Vorbild für **Gamification-Mechanik**, also Punkte, Serien, Ranglisten
- **Entscheidung (vorläufig):** (a). Der Owner kennt Duolingo nur von Screenshots, und die zeigen das Aussehen, nicht wie sich die Mechanik anfühlt. Wird in Phase 2 (Moodboard) aufgegriffen.

### E18 · Punkte, Serien und ob man sie verlieren kann ❓
- **Datum:** 25.11.2026
- **Alternativen:**
  - (a) Etwas aufbauen, das **nie verloren** geht. Das erzeugt Stolz, aber keine Verlustangst.
  - (b) Etwas aufbauen, das **verloren gehen kann**. Verlustangst als Antrieb, mit dem Risiko, dass der Owner nach einem Verlust aufgibt.
  - (c) eine Mischform
- **Stand:** bewusst **nicht entschieden**. Der Owner will beides: aufbauen *und* nicht verlieren. Wird als **eigene Funktion mit eigener Recherche** behandelt.
- **Argument des Owners (25.11.2026):** Die laufende Serie **darf verfallen**, aber was man gemacht hat, bleibt **rückwirkend immer sichtbar**. Das soll motivieren, sie neu aufzubauen. Das spricht für eine Mischform (c).
  - *Hypothese, die die Recherche prüfen muss:* Bei Snapchat hat der Owner nach dem Verlust nicht neu angefangen. Dort war allerdings nichts mehr sichtbar. Ob die sichtbare Geschichte den Effekt aus dem Snapchat-Erlebnis abfedert, ist noch unbelegt.
- **Grundlage:** die eigene Erfahrung des Owners mit Snapchat. 400 Flammen, einmal vergessen, alles weg. Das machte ihn traurig, und er hat danach nicht neu angefangen. Snapchat verdient an genau diesem Moment mit einer Bezahloption. Die App des Owners ist nicht kommerziell (E21) und muss deshalb anders abwägen: Nutzen durch tägliches Kommen gegen Demotivation nach dem Verlust.

### E19 · Vergleich mit Mitstudenten ✅
- **Datum:** 25.11.2026
- **Alternativen:** (a) die App zeigt einen echten Vergleich mit anderen · (b) nur das Gefühl „die haben bestimmt nicht so viel gemacht wie ich“
- **Entscheidung:** (b). Ob es stimmt, ist egal. **Das Gefühl soll nicht in Worten ausgedrückt werden.**
- **Grenze (Prüfung, vom Owner nicht widersprochen):** Die App behauptet nie einen Vergleich, den sie nicht belegen kann, weil das das Vertrauen zerstört.
- **Technisch:** Die App hat ohnehin keine Daten über andere.

### E20 · Wenn du den nächsten Schritt nicht machst ✅
- **Datum:** 25.11.2026
- **Alternativen:**
  - (a) Den Vorschlag einfach wegklicken können
  - (b) Eine Barriere mit Abfrage des Grundes, gedacht als Mittel für Vertrauen (erster Entwurf des Owners)
  - (c) Eine Barriere als **Messinstrument**. Vertrauen entsteht durch Erklärung, und die Barriere gilt nur je nach Situation.
- **Entscheidung:** (c). Nach dem Einwand der Prüfung hat der Owner (b) zu (c) weiterentwickelt. Wer sich überwunden hat, die App zu öffnen, bekommt keine Barriere, dort ist schon „machen, was ich will“ ein Fortschritt.
- **Seine Reaktion:**
  - Alternativen: enttäuscht · neugierig und verständnisvoll
  - Entscheidung: **neugierig und verständnisvoll**. Er schlägt einen anderen sinnvollen Weg vor. *(Korrigiert am 25.11.2026: Er gibt nicht zu, dass seine Wahl uneindeutig war, siehe E25.)* Nimmst du auch den nicht, versteht er es und **unterstützt dich bei deinem eigenen Weg**.
- **Gegenargument aus der Prüfung:** Reaktanz (Brehm). Kontrolle erzeugt Trotz.

### E21 · Kommerziell oder persönlich ✅
- **Datum:** 24.11.2026
- **Alternativen:** (a) Erfolg der App gemessen an Nutzungsdauer und Häufigkeit, wie bei kommerziellen Apps · (b) Erfolg gemessen am Lernen und Wohlbefinden des Owners
- **Entscheidung:** (b). „Mein Fokus ist nicht kommerziell, sondern dient der persönlichen Nutzung.“

### E22 · Bewusstseinsphasen aus dem Marketing ✅
- **Datum:** 25.11.2026
- **Alternativen (Prüfung):** (a) die Behauptung ohne Quelle übernehmen · (b) streichen · (c) die Quelle klären und nur die belegte Kernaussage behalten
- **Entscheidung:** (c). Die Quelle ist die Aktivierungstheorie mit der Lambda-Hypothese (Kroeber-Riel), vom Owner bestätigt. Es bleibt: Die Wachheit schwankt, und die Bahn soll die Aktivierung vor der Vorlesung anheben.

### E24 · Was an ihm immer gleich bleibt ✅
- **Datum:** 25.11.2026
- **Alternativen (Prüfung):** (a) Er ist je nach Moment fast ein anderer Charakter · (b) Er hat eine feste **Stimme** (Persönlichkeit) und passt nur den **Tonfall** an
- **Entscheidung:** (b). Immer gleich: verständnisvoll, nie das Gefühl, etwas zu 100 % falsch zu machen, emotionale Stütze auch ohne etwas zu tun, durch Taten und Art statt durch Worte. Was sich ändert: fordernd, spielerisch oder ruhig, je nach Moment.

### E25 · Zeigt er Unsicherheit in seinen Entscheidungen ✅
- **Datum:** 25.11.2026
- **Alternativen:**
  - (a) Er sagt offen, dass seine Wahl knapp war, etwa 51 zu 49
  - (b) Er sagt das nicht, liefert aber **eine zweite, ebenfalls sinnvolle Alternative**
  - (c) Er bietet keine Alternative und bleibt bei seinem Vorschlag
- **Entscheidung:** (b). Er tritt bei seinen Entscheidungen **überzeugt** auf. Ist eine Entscheidung knapp, merkt man das nur daran, dass es eine Alternative gibt.
- **Gegenargument aus der Prüfung:** Forschung zur Glaubwürdigkeit (Tenney u. a., 2007). Wer sehr überzeugt auftritt und sich dann als falsch erweist, verliert mehr Vertrauen als jemand, dessen Überzeugung zu seiner Trefferquote passt. Mit (b) behauptet er aber nichts Falsches, er lässt die Unsicherheit nur unausgesprochen.

### E26 · Lernt er aus deinen Rückmeldungen ✅
- **Datum:** 25.11.2026
- **Alternativen (Prüfung):** (a) Sein Plan bleibt fest, „er hinterfragt ihn nicht“ · (b) Er tritt entschieden auf, lernt aber im Hintergrund aus deinen Rückmeldungen und passt sich an
- **Entscheidung:** (b). Das passt zu E16 (Verhaltensanalyse) und E20 (Rückmeldung „nicht der richtige Schritt“).

### E27 · Wie er auf eine falsche Antwort reagiert ✅
- **Datum:** 25.11.2026
- **Alternativen:**
  - (a) „Nein, das ist nicht richtig“ und dann die Lösung
  - (b) „Nein“ und ein Hinweis, der fast die ganze Lösung verrät
  - (c) Erst anerkennen, was am Denkansatz richtig war, dann die Fehlerstelle benennen (etwa einen Folgefehler), dann ein Hinweis, der zum eigenen Aha-Effekt führt
- **Entscheidung:** (c), vom Owner selbst entwickelt. Vorbild ist seine Mathe-Professorin.
- **Grund (Owner):** Man will nicht in eine unangenehme Situation gebracht werden, aber wissen, wenn etwas nicht richtig ist. Durchgefallen ist das Design, wenn man denkt: „Ich verstehe gar nichts, nächste Frage.“

### E28 · Wenn du ihm widersprichst ✅
- **Datum:** 25.11.2026
- **Alternativen:**
  - (a) Er gibt verständnisvoll nach, wie man es in einem Streit tut
  - (b) Er bleibt bei seiner Meinung, erkennt deine Sicht an, nennt die Fakten und lässt dir die Wahl
- **Entscheidung:** (b). „Du kannst dich immer noch so entscheiden, aber das und das sind die Fakten.“ Wie jemand, der gut argumentieren kann.
- **Abgleich mit E26:** Seine Meinung ändert sich durch Daten aus deinem Verhalten, nicht durch Druck im Moment. *(Vorgelegt am 25.11.2026, der Owner hat nicht widersprochen.)*

### E29 · Wo die Denkleistung liegt ✅
- **Datum:** 25.11.2026
- **Alternativen:**
  - (a) Die App erklärt oder löst, wenn man nicht weiterkommt
  - (b) Die App hilft, das Feedback rechnet die Leistung aber großzügig dir zu („alles richtig“)
  - (c) Die App gibt nur Hinweise, die Denkleistung bleibt immer beim Owner, und das Feedback trennt ehrlich zwischen eigener Leistung und Hilfe
- **Entscheidung:** (c). „Die Denkleistung darf niemals bei der App liegen.“ Die App übernimmt den Überblick, nie das Denken.

### E30 · Wie konkret seine Rückmeldung ist ✅
- **Datum:** 25.11.2026
- **Alternativen:**
  - (a) Allgemein: „Denk noch einmal länger darüber nach“
  - (b) Konkret: den guten Ansatz nennen, die Stelle zeigen und sagen, worauf man achten soll
  - (c) Bei richtigen Antworten „Ja, richtig, aber …“
  - (d) Bei richtigen Antworten „Ja, richtig. Du könntest es an dieser Stelle noch konkretisieren.“
- **Entscheidung:** (b) und (d). Dazu gilt: kein festes Muster in Dauerschleife, sondern konkrete Kritik und abwechslungsreiche Antworten.

### E31 · Wie präsent er ist (Attribut 4) ✅
- **Datum:** 25.11.2026
- **Alternativen:**
  - (a) immer im Blickfeld, damit man ihn nicht vergisst, wie die Erinnerungen der Duolingo-Eule
  - (b) immer erreichbar, aber zurückhaltend sichtbar
- **Entscheidung:** (b). „Ich weiß, dass es da ist, aber ich sehe es nicht immer, oder jedenfalls nicht penetrant.“ Abrufen ohne 20 Schritte.
- **Merke:** Das Aussehen von Duolingo kann Vorbild sein (E17), das aufdringliche Verhalten nicht.

### E32 · „Taten statt Worte“ als Attribut oder Prinzip ✅
- **Datum:** 25.11.2026
- **Alternativen:** (a) Charakterzug, also Attribut 5 · (b) eine Regel, wie wir die App gestalten, also ein Prinzip für Schritt 1.5
- **Entscheidung:** (b). Damit bleibt es bei vier Attributen.

### E33 · Die vier Markenattribute ✅
- **Datum:** 25.11.2026
- **Entscheidung:** (1) verständnisvoll, aber nicht nachgiebig · (2) urteilt nicht, aber schmiert dir keinen Honig ums Maul · (3) auf ihn ist Verlass, aber deine Leistung hängt von dir ab · (4) immer da, aber nicht aufdringlich. Jeweils mit beobachtbaren Kriterien in MARKENKERN.md §3.
- **Weggefallen:** „nachgiebig“ als Form von Verständnis (E28), Lob für alles (E30), Lösungen durch die App (E29), ständige Präsenz im Blickfeld (E31).

---

## Offen für spätere Phasen

### E23 · iPhone im Konzept ❓
- **Datum:** 17.11.2026
- **Alternativen:** (a) bei Mac und iPad bleiben, wie im bisherigen Konzept · (b) das iPhone dazunehmen, denn der Owner nutzt es in Bett und Bahn
- **Stand:** offen. Wird in Phase 3 (Aufbau) entschieden.
