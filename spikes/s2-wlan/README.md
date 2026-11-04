# Spike S2 · WLAN-Erreichbarkeitstest im Hörsaal (iPad ↔ Mac)

Mit diesem kleinen Test prüfst du in **5 Minuten**, ob dein **iPad** deinen **Mac** im Uni-WLAN (z. B. `eduroam`) direkt erreichen kann oder ob das Uni-WLAN Verbindungen zwischen Geräten blockiert (*Client-Isolation*).

Es muss nichts installiert werden (`npm install` ist **nicht** nötig).

---

## Schritt-für-Schritt-Anleitung im Hörsaal

### 1. Beide Geräte mit dem Uni-WLAN verbinden
Verbinde deinen **Mac** und dein **iPad** mit demselben WLAN im Hörsaal (z. B. `eduroam`).

### 2. Testserver auf dem Mac starten
Öffne auf dem Mac das Programm **Terminal**, füge diesen Befehl ein und drücke **Enter**:

```bash
cd ~/WI-Webapp && node spikes/s2-wlan/server.mjs
```

> **Wichtig – macOS-Firewall-Abfrage:**
> Falls macOS ein Fenster einblendet (*„Möchtest du erlauben, dass das Programm ‚node‘ eingehende Netzwerkverbindungen akzeptiert?“*), klicke unbedingt auf **„Erlauben“**. Wenn du auf „Ablehnen“ klickst, blockiert die eigene Firewall des Macs das iPad.

Im Terminal erscheinen jetzt zwei Arten von Adressen, zum Beispiel:
- **IP-Adresse:** `http://10.184.22.45:4799` (oder `http://192.168.x.x:4799`)
- **Bonjour-Name (`.local`):** `http://MacBook-Air.local:4799`

### 3. Testseite auf dem iPad in Safari öffnen
1. Öffne **Safari** auf dem iPad.
2. Tippe **zuerst** die angezeigte **IP-Adresse** (mit Zahlen, z. B. `http://10.184.22.45:4799`) exakt in die Adresszeile ein.
3. Wenn sich die Seite öffnet, probiere **danach** in einem zweiten Tab auch die **`.local`-Adresse** aus (damit wir wissen, ob die automatische Gerätesuche per Bonjour im Uni-WLAN funktioniert).

### 4. Messung starten (5 Minuten) und Ergebnis kopieren
1. Trage im Textfeld oben optional den WLAN-Namen und Hörsaal ein (z. B. `eduroam / Hörsaal H1`).
2. Tippe auf den blauen Knopf **„Test starten (5 min)“** und lass das iPad 5 Minuten eingeschaltet liegen.
3. Nach Ablauf der 5 Minuten zeigt die Seite eines von drei Ergebnissen:
   - **„✓ Verbindung stabil“:** Mindestens 99 % aller Pings kamen an und es gab keine Lücke über 5 Sekunden.
   - **„⚠ Verbindung instabil“:** Die Verbindung funktioniert grundsätzlich, hat aber Aussetzer oder hohe Verzögerungen.
   - **„✗ Keine Verbindung“:** Die Verbindung bricht komplett ab oder die Seite lädt gar nicht erst (siehe unten).
4. Tippe auf **„Ergebnis kopieren“** und schicke den kopierten Textblock einfach an **Claude**.
5. Beende den Server auf dem Mac im Terminal mit **`Strg + C`** (`Ctrl + C`). *(Falls du es vergisst, beendet sich der Server nach 30 Minuten von selbst.)*

---

## Was bedeutet es, wenn die Seite auf dem iPad gar nicht lädt? (`✗ Keine Verbindung`)

Wenn Safari auf dem iPad nach einigen Sekunden meldet *„Safari konnte die Seite nicht öffnen, da der Server nicht mehr antwortet“*:

1. **Weder IP-Adresse (`http://10.x.x.x:4799`) noch `.local` lädt:**
   - **Bedeutung:** **`✗ Keine Verbindung` – Das Uni-WLAN blockiert Verbindungen zwischen Geräten (*Client-Isolation*).**
   - Das ist in vielen `eduroam`-Netzen normal: Jedes Gerät darf zwar ins Internet, aber nicht direkt mit dem Nachbar-Laptop im selben Raum sprechen.
   - Mach in diesem Fall bitte direkt die **Gegenprobe über den iPhone-Hotspot** (siehe nächster Abschnitt) und schicke Claude die kurze Info: *„Im eduroam lädt die IP-Adresse auf dem iPad gar nicht (Client-Isolation).“*
2. **Die IP-Adresse lädt, aber die `.local`-Adresse lädt nicht:**
   - **Bedeutung:** Direkte Verbindungen zwischen iPad und Mac sind im Uni-WLAN **erlaubt**, aber das WLAN filtert **Bonjour/mDNS** (automatische Namensauflösung).
   - Das ist für unsere App völlig in Ordnung: Wir nutzen dann einfach die IP-Verbindung per QR-Code statt Bonjour. Bitte führe den 5-Minuten-Test über die **IP-Adresse** durch!

---

## Gegenprobe über den persönlichen iPhone-Hotspot

Wenn die Seite im Uni-WLAN nicht lädt oder „⚠ Verbindung instabil“ meldet, teste bitte direkt im Anschluss den **persönlichen Hotspot**:

1. Schalte auf deinem **iPhone** unter *Einstellungen → Persönlicher Hotspot* die Option **„Zugriff für andere erlauben“** ein.
2. Verbinde **sowohl den Mac als auch das iPad** im WLAN-Menü mit deinem iPhone-Hotspot.
3. Beende im Terminal auf dem Mac den alten Server mit **`Strg + C`** und starte ihn neu:
   ```bash
   node spikes/s2-wlan/server.mjs
   ```
4. Öffne die **neu angezeigte IP-Adresse** (meist `http://172.20.10.x:4799`) auf dem iPad in Safari und starte den Test.
   - *(Tipp: Für einen schnellen 1-Minuten-Kurztest kannst du `?dauer=60` an die Adresse anhängen, z. B. `http://172.20.10.2:4799/?dauer=60`.)*
5. Kopiere auch dieses Ergebnis und schicke es an Claude.
