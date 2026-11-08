# Ribo — Code-Dokumentation

Diese Dokumentation erklärt jede Code-Datei und -Funktion des Pi-Agent-Projekts.

## Struktur

```
documentation/
├── README.md                  ← Diese Übersicht
├── architektur.md             ← Gesamtarchitektur, Datenflüsse, Services
├── pi-agent/
│   ├── server.md              ← Entry-Point (Express, Sessions, Routing)
│   ├── lib-users.md           ← Multi-User System
│   ├── lib-helpers.md         ← Shared Helpers (Datum, Kalender, Listen)
│   ├── lib-plugins.md         ← Plugin-Loader
│   ├── tools.md               ← Alle 22 Tools erklärt
│   └── weather-helpers.md     ← Wetter-/Geocoding-Helper
├── pi-telegram/
│   └── start.md               ← Telegram-Bot + Reminder + Gewohnheiten
├── ha-service/
│   └── server.md              ← Home Assistant Bridge
├── imagegen-service/
│   └── server.md              ← Bildgenerierung (FLUX)
└── hey-ribo/
    └── hey-ribo.md            ← Sprachsteuerung + TTS/STT + Musik + Timer
```

## Schnellüberblick der Services

| Service | Sprache | Läuft in | Zweck |
|---------|---------|----------|-------|
| **pi-agent** | Node.js | Docker | Zentraler AI-Agent, HTTP-API, alle Tools, Web-Chat |
| **pi-telegram** | Node.js | Docker | Telegram-Bot, Reminder-Service, Gewohnheiten-Analyse |
| **ha-service** | Node.js | Docker | Bridge zu Home Assistant (Smart Home) |
| **imagegen-service** | Python | Nativ (macOS) | Bildgenerierung via FLUX/mflux |
| **hey-ribo.py** | Python | Nativ (macOS) | Sprachsteuerung, TTS/STT, Musik, Timer |

## Wie alles zusammenspielt (Kurzform)

1. **Eingabe** kommt über Telegram, Web-Chat oder Sprache ("Hey Ribo")
2. Alles landet beim **pi-agent** `/prompt` Endpoint (mit `user_id`)
3. Der pi-agent lädt/erstellt eine **Session pro User** (mit dem LLM via Ollama)
4. Das LLM entscheidet welches **Tool** aufgerufen wird
5. Tools lesen/schreiben Dateien im **workspace/** (pro User isoliert)
6. Die Antwort geht zurück an den Eingabekanal

Details siehe `architektur.md`.
