# Spike S6: Mac und iPad direkt per Wi-Fi peer-to-peer testen

> **Erledigt (UX-12, PR 4).** Der Spike hat seinen Zweck erfüllt: Die Direktverbindung ist in die App eingebaut und läuft mit der gesicherten Verbindung (TLS 1.2, PSK, Verfahren ECDHE). **Die Testansicht „Direktverbindung testen“ ist aus der iPad-App entfernt.** Die Schritte unten für das iPad gelten nicht mehr. Der Gerätetest im Hörsaal läuft jetzt mit der normalen App: [IPAD-VERBINDUNG.md](IPAD-VERBINDUNG.md), Abschnitt 6, und der Plan, Abschnitt 9.1. Das Mac-Paket `spikes/s6-p2p` bleibt als Beleg im Repo (Messung der TLS-Verfahren, Selbsttest).


Dieser Test klärt, ob iPad und Mac sich im Hörsaal **ohne gemeinsames Netz und ohne Mobilfunk** direkt erreichen (Wi-Fi peer-to-peer, die Technik hinter AirDrop). Ergebnis: ein Protokoll, das du ins Issue #138 kopierst. Es entscheidet, ob der Umbau aus dem Plan `docs/plaene/UX-12-MAC-WIEDERFINDEN.md` gebaut wird.

Aufwand: einmal etwa 20 Minuten zu Hause, dann zwei Vorlesungen (eine kurze, eine mit 90 Minuten Dauertest). Du musst nichts im Code ändern.

## Was der Test tut (und was nicht)

- Der Mac-Teil ist ein kleines Programm, das du von Hand im Terminal startest. Es zeigt einen **Code mit 8 Ziffern**, der bei jedem Start neu ist, und beendet sich nach spätestens **4 Stunden** von selbst.
- Es kennt nur vier feste Befehle: `ping`, `health` (fragt den Core nach seinem Status, gibt nur Status und Dauer zurück), `echo` (höchstens 64 KiB) und `blob` (höchstens 50 MB Zufallsdaten). Höchstens 4 Verbindungen gleichzeitig. Nach 50 gescheiterten Verbindungsversuchen (zum Beispiel jemand rät den Code) beendet er sich zum Schutz. Dann einfach neu starten, es gilt ein neuer Code.
- Es **reicht nichts weiter** und kennt keine Daten der App, keine Notizen, kein Geräte-Token.
- Die Testansicht am iPad steckt in den Verbindungsdetails und nutzt eigene Verbindungen. Sie schickt dein Token nie.
- `sg start` startet den Mac-Teil nie. Er läuft nur, solange du das Terminal-Fenster offen lässt.

## Einmal vorbereiten (zu Hause)

**Mac: Mac-Teil bauen und starten** (eine Zeile im Terminal, im Projektordner `WI-Webapp`):

```bash
swift run -c release --package-path spikes/s6-p2p sg-spike
```

- Der erste Start baut das Programm und dauert 1 bis 3 Minuten. Du brauchst Xcode oder die Kommandozeilenwerkzeuge, ein Apple-Konto brauchst du nicht. Meldet das Terminal „swift: command not found“, installiere sie mit `xcode-select --install` und wiederhole die Zeile.
- Am Ende erscheint ein Kasten mit dem **Code für das iPad** (zum Beispiel `4821 7305`) und der Zeile „Core: antwortet …“. Läuft der Core nicht, ist das für den Funktest egal, nur `health` meldet dann einen Fehler.
- Fragt macOS, ob das Programm Verbindungen annehmen oder das lokale Netzwerk nutzen darf: **Erlauben** und aufschreiben, dass die Frage kam.
- Beenden mit **ctrl+C**.

**Optional, 30 Sekunden:** Der Mac prüft sich selbst und zeigt, welche TLS-Verfahren funktionieren. Das ersetzt keinen Test mit dem iPad, ist aber eine gute erste Rückmeldung.

```bash
swift run -c release --package-path spikes/s6-p2p sg-spike --selftest
```

**iPad: App neu aufspielen.** Die Testansicht ist neu in der App, darum die App einmal über Xcode neu installieren (zuerst `bash apps/ipad/scripts/projekt-erzeugen.sh`, dann wie gewohnt auf das iPad starten).

**iPad: Testansicht öffnen.** Auf dem Startbildschirm oben rechts auf **„Mac ●“** tippen, ganz unten **„Entwickler“** aufklappen und **„Direktverbindung testen“** wählen. Fragt das iPad „Lokales Netzwerk erlauben?“, erlaube es.

## Vorher: AirDrop-Probe im Hörsaal (5 Minuten, empfohlen)

Im Hörsaal während einer Vorlesung, beide Geräte im Uni-WLAN, Bluetooth an: eine Datei mit etwa 50 MB per AirDrop vom iPad an den Mac schicken und zurück. Notiere: Wird der Mac sofort angeboten? Wie lange dauert es? Bricht es ab? AirDrop nutzt denselben Funkweg. Geht es zügig, spricht das für den Plan. Geht es gar nicht, schreib das ins Issue, bevor du weiter testest.

## Die Tests, Schritt für Schritt

Vor jedem Test: **Mac-Teil läuft**, Code am iPad eingeben (Feld „Code“, 8 Ziffern), WLAN an beiden Geräten **an** (Bluetooth auch). Ein Netz brauchst du nicht: Der Mac darf im Uni-WLAN, in einem anderen Netz oder in **gar keinem** Netz sein. Kein Netzwerkkabel am Mac. Die App am iPad bleibt im Vordergrund.

Unter „2 · Weg“ gilt: **Über das Netz** erlaubt nur das gemeinsame WLAN. **Direkt erlaubt** erlaubt zusätzlich peer-to-peer. Unter „3 · Prüfen“ tippst du auf **„Alles prüfen“** und wartest etwa eine Minute. Danach steht bei „Handshake …“ jeweils, über welchen Weg die Verbindung lief.

| Schritt | Wo | Was du tust | Bestanden, wenn |
|---|---|---|---|
| 1 | Zu Hause, im WLAN | Weg „Über das Netz“, „Alles prüfen“ | Dienst gefunden, Handshake über das Netz gelungen, `health` antwortet |
| 2 | Zu Hause | Auf beiden Geräten das WLAN-Netz **abmelden** (WLAN-Schalter bleibt an), Weg „Direkt erlaubt“, „Alles prüfen“ | „Handshake mit peer-to-peer“ gelungen, Weg „direkt (AWDL)“, `health` antwortet |
| 3 | Zu Hause | Durchsatz aus Schritt 2 ansehen | Mehr als 1 MB/s |
| 4 | Hörsaal, Vorlesung | Beide im Uni-WLAN, Weg „Direkt erlaubt“, „Alles prüfen“ | Verbindung direkt in unter 15 s |
| 5 | Hörsaal, 90 Minuten | Weg „Direkt erlaubt“, **„Dauertest starten“**, iPad normal nutzen, am Ende **„Dauertest beenden“** | Höchstens 3 Abbrüche, jeder unter 30 s, Akku höchstens 10 Prozentpunkte mehr als ohne Test |
| 6 | Beliebig | Mac-Deckel 2 Minuten zu, dann auf (der Mac-Teil läuft weiter) | Nach dem Öffnen steht die Verbindung in unter 30 s wieder (im Dauertest sichtbar) |
| 7 | Mac | Hat macOS nach „Lokales Netzwerk“ oder der Firewall gefragt? Stört Cisco / das Uni-VPN? | Nur aufschreiben, auch wenn nichts gefragt hat |

Dazu einmal **„TLS-Verfahren messen“** (zu Hause, Weg „Über das Netz“ reicht). Das Protokoll zeigt, welche der drei Verfahren funktionieren. Wichtig ist, ob eines mit **ECDHE** dabei ist.

Für Schritt 5: Den Akkustand merkt sich der Test. Für den Vergleich ohne Test schaust du an einem normalen Vorlesungstag vorher und nachher auf den Akku.

## Ergebnis weitergeben

1. In der Testansicht unter „5 · Protokoll“ auf **„Protokoll teilen“** tippen und per AirDrop an den Mac schicken (oder in Notizen ablegen). Das Protokoll enthält keine Namen und keine Adressen.
2. Den Text als Kommentar ins Issue #138 kopieren. Dazu in zwei Sätzen: Schritt 7 (Fragen von macOS, Cisco) und ob Time Machine bei dir an und verschlüsselt ist.
3. Optional die Ausgabe des Selbsttests vom Mac dazu.

## Wenn es nicht klappt

| Beobachtung | Was du probierst |
|---|---|
| „Dienst nicht gefunden“ | Code richtig? Läuft der Mac-Teil noch (Terminal offen)? WLAN an beiden Geräten an? Am iPad unter Einstellungen → Datenschutz → Lokales Netzwerk die App erlauben. Am Mac das Programm erlauben, falls macOS gefragt hat. |
| Dienst gefunden, Handshake scheitert | Code noch einmal prüfen (jeder Start des Mac-Teils hat einen neuen). |
| Nur „über das Netz“ geht, „direkt“ nicht | Im Protokoll steht, über welche Schnittstellen der Dienst zu sehen war (`awdl0` heißt: direkter Funkweg sichtbar). Genau das ist die Antwort auf die Testfrage, bitte teilen. |
| Zu Hause mit „Direkt erlaubt“ steht „über das Netz“ | Normal, solange beide im selben WLAN sind. Für einen echten Test der Direktverbindung das Netz abmelden (Schritt 2). |
| Cisco Secure Client ist an | Siehe [`IPAD-VERBINDUNG.md`](IPAD-VERBINDUNG.md). Den Socket-Filter probeweise ausschalten und beides aufschreiben. |

## Aufräumen

- Mac-Teil mit **ctrl+C** beenden (sonst beendet er sich nach 4 Stunden selbst).
- Die Testansicht bleibt in der App, bis der Umbau aus dem Plan (PR 4) sie entfernt. Sie tut nichts, solange du sie nicht öffnest.

Technische Einzelheiten stehen in [`spikes/s6-p2p/README.md`](../../spikes/s6-p2p/README.md).
