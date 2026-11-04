# Drittanbieter-Abhängigkeiten (Laufzeit)

Übersicht der Pakete, die zur Laufzeit ausgeliefert werden (ohne Entwicklungswerkzeuge). Die Lizenzangaben stammen von den Paketseiten nach Kenntnisstand des Autors und sind vor einer Weitergabe der App noch einmal gegen die installierten Versionen zu prüfen.

> **PyMuPDF / MuPDF: AGPL-3.0.** Für den lokalen Einzelnutzer-Betrieb unkritisch; vor einer Weitergabe der App muss der Owner entscheiden (AGPL-Pflichten oder kommerzielle Lizenz).

## Core (Node)

| Paket | Version | Lizenz | Zweck |
|---|---|---|---|
| fastify | 5.12.8 | MIT | HTTP-Server |
| @fastify/cors | 11.4.0 | MIT | CORS für die Entwicklungs-Web-App |
| @fastify/multipart | 10.1.4 | MIT | Datei-Upload (multipart) |
| @fastify/static | 10.1.8 | MIT | Auslieferung der Web-App |
| @fastify/swagger | 9.9.3 | MIT | OpenAPI-Beschreibung |
| fastify-type-provider-zod | 7.0.0 | MIT | Zod-Validierung der Routen |
| zod | 4.6.7 | MIT | Validierung |
| drizzle-orm | 0.45.4 | Apache-2.0 | Datenbankzugriff |
| postgres | 4.0.0 | Unlicense | PostgreSQL-Treiber |
| pino | 10.4.0 | MIT | Logging |

## Worker (Python)

| Paket | Version | Lizenz | Zweck |
|---|---|---|---|
| **pymupdf (MuPDF)** | 1.28.2 | **AGPL-3.0** (oder kommerzielle Lizenz von Artifex) | PDF rendern, Text und Textblöcke lesen |
| pillow | 13.0.0 | HPND (MIT-ähnlich) | WebP-Vorschaubilder |
| psycopg (binary) | 3.3.7 | LGPL-3.0 | PostgreSQL-Treiber |
| pydantic (über sg-schemas) | 2.14.2 | MIT | Payload-Validierung |

## Web-App

| Paket | Version | Lizenz | Zweck |
|---|---|---|---|
| next | 15.5.29 | MIT | Framework (Static Export) |
| react, react-dom | 19.3.1 | MIT | UI |
| @tanstack/react-query | 5.105.3 | MIT | Datenabruf und Cache |

## Hinweise

- PyMuPDF steht bewusst auf der 1.x-Linie (1.28.2): Die Version 2.x zieht onnxruntime, numpy und weitere Pakete nach, die der Worker nicht braucht.
- Neue Laufzeit-Abhängigkeiten bitte hier mit Lizenz eintragen.
