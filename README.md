# Pi Agent – Persönlicher AI-Assistent

Persönlicher AI-Assistent mit Sprachsteuerung, Telegram-Bot, Smart-Home-Integration, Kalender, Wetter, Nachrichten und mehr. Läuft auf Mac Mini M5 Pro (Apple Silicon, 48 GB) oder Linux (NVIDIA GPU).

## Features

| # | Feature | Beispiel |
|---|---------|----------|
| 1 | **Timer** | „Stell einen Timer auf 5 Minuten" |
| 2 | **Wetter** | „Wie wird das Wetter morgen in München?" |
| 3 | **Nachrichten** | „Was gibt es Neues?" (RSS-Feeds) |
| 4 | **Web-Suche** | „Wie ist der Bitcoin-Kurs?" (Tavily) |
| 5 | **Notizen** | „Merk dir: Zahnarzt am Donnerstag" |
| 6 | **Kalender + Erinnerungen** | „Trag Freitag 10 Uhr Meeting ein, erinnere mich 1h vorher" |
| 7 | **Routinen** | „Gute Nacht" (Smart-Home Szenen) |
| 8 | **Musik/Radio** | „Spiel Radio Teddy" / „Leiser" |
| 9 | **Listen** | „Setz 3 Äpfel auf die Einkaufsliste" |
| 10 | **Wochenplanung** | „Was steht diese Woche an?" |
| 11 | **Bildanalyse + Aktionsvorschläge** | Foto schicken → „Soll ich das in den Kalender eintragen?" |
| 12 | **Sprachnachrichten** | Voice in Telegram → Antwort als Text + Voice |
| 13 | **Smart Home** | „Mach das Licht im Wohnzimmer an" |
| 14 | **Lernkarten (Spaced Repetition)** | „Ich will Japanisch lernen" / „Frag mich ab" |
| 15 | **Kochassistent** | „Was kann ich mit Kartoffeln kochen?" + Einkaufsliste |
| 16 | **Ausgaben-Tracker** | „33€ für Spielzeug bei Amazon" / „Monatsübersicht" |
| 17 | **Bildgenerierung (FLUX)** | „Generier einen blauen Roboter, Pixel Art" |
| 18 | **Multi-User** | Getrennte Daten, geteilte Kalender/Listen, Berechtigungen |
| 19 | **Persönlichkeit pro User** | Beim ersten Kontakt: Wie soll ich mit dir reden? |
| 20 | **Langzeitgedächtnis** | Merkt sich Fakten, fasst Sessions zusammen, selektives Vergessen |
| 21 | **Proaktive Nachrichten** | Automatisch Wetter/Termine zur gewohnten Zeit |
| 22 | **Gewohnheiten lernen** | Erkennt Muster, schlägt Automatisierung vor |
| 23 | **Plugin-System** | „Bau dir ein Tool das Witze erzählt" (Admin) |
| 24 | **Admin-Verwaltung** | „Leg User Liam an mit Gruppe Familie" |
| 25 | **Dateien senden** | „Schick mir mein main.js Script" / „Welche Bilder habe ich?" |
| 26 | **Code-Projekte** | „Schreib mir ein JavaScript das CSVs zusammenführt" + ZIP-Export |

## Voraussetzungen

- Mac Mini M5 Pro (18-Core CPU, 48 GB RAM) oder Linux mit NVIDIA GPU
- Docker Desktop (Mac) oder Docker + NVIDIA Container Toolkit (Linux)
- Ollama installiert (`brew install ollama` auf Mac, [ollama.com](https://ollama.com) auf Linux)
- [uv](https://docs.astral.sh/uv/) für native Python-Services (TTS/STT, Sprachsteuerung)
- ffmpeg (`brew install ffmpeg`) + mpv (`brew install mpv`) für Audio
- Kein Mikrofon erforderlich: Audio-Service für TTS/STT, Musik und Timer.

## Setup

```bash
# Ollama starten
ollama serve

# Modell laden (multimodal: Text + Tool-Calling + Vision in einem)
ollama pull qwen3.8:27b

# .env konfigurieren
cp .env.example .env
# TELEGRAM_BOT_TOKEN, HA_TOKEN, TAVILY_API_KEY eintragen

# Native Services starten (TTS/STT + Musik + Timer + Timer)
uv run --env-file .env --locked hey-ribo.py

# Optional: Bildgenerierung starten (FLUX auf Apple Silicon)
uv run --env-file .env --locked imagegen-service/server.py

# Docker Stack starten (Agent, Telegram-Bot, Home Assistant)
docker compose up -d
```

## Architektur

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│   Telegram / Web-Chat / "Hey Ribo"                               │
│         ↕              ↕            ↕                            │
│   pi-telegram      localhost:8080   hey-ribo.py                  │
│         ↕              ↕            ↕                            │
│         └──────── pi-agent (LLM + alle Tools) ───────┐           │
│                        ↕         ↕         ↕         ↕           │
│                     Ollama   ha-service  hey-ribo  imagegen       │
│                     (LLM)    (Smart Home) (Musik,   (FLUX)       │
│                                           Timer,                 │
│                                           TTS/STT)               │
│                        ↕                                         │
│                  Home Assistant                                   │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

Alles läuft über den **pi-agent** — egal ob via Telegram, Web-Chat oder Sprache. Der Agent entscheidet welches Tool aufgerufen wird.

## Services

| Service        | Port  | Beschreibung                              | Läuft in      |
|----------------|-------|-------------------------------------------|---------------|
| pi-agent       | 8080  | AI Agent HTTP API + Web-Chat              | Docker        |
| hey-ribo.py    | 8085  | TTS/STT + Musik + Timer | Nativ (macOS) |
| imagegen       | 8086  | Bildgenerierung (FLUX via MLX)            | Nativ (macOS) |
| pi-telegram    | –     | Telegram-Bot (Text, Voice, Bilder)        | Docker        |
| ha-service     | 8082  | Home Assistant Bridge (intern)            | Docker        |
| Open WebUI     | 3000  | Chat UI für Ollama                        | Docker        |
| Home Assistant | 8123  | Smart Home Steuerung                      | Docker        |
| Ollama         | 11434 | LLM Backend                               | Nativ         |

## Umgebungsvariablen

| Variable             | Zweck                                         | Beispiel                                                                                  |
|----------------------|-----------------------------------------------|-------------------------------------------------------------------------------------------|
| `LLM_PROVIDER`       | LLM-Backend: `ollama` (lokal) oder `anthropic` (Claude API) | `ollama`                                                                    |
| `ANTHROPIC_API_KEY`  | Claude API Key (nur bei `anthropic`) — API-Key, **nicht** das Abo | `sk-ant-xxxxxxxx`                                                     |
| `PI_MODEL`           | Modell (Text + Tools + Vision). Leer = Provider-Default | `qwen3.8:27b` / `claude-sonnet-5`                                               |
| `THINKING_LEVEL`     | Standard-Denkintensität | `low`                                                                        |
| `TELEGRAM_BOT_TOKEN` | Bot-Token von @BotFather für Telegram         | `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`                                              |
| `HA_TOKEN`           | Long-Lived Access Token für Home Assistant    | `eyJhbGciOi...`                                                                           |
| `TAVILY_API_KEY`     | API Key für Web-Suche (optional)              | `tvly-xxxxxxxxxxxxxxx`                                                                    |
| `WEATHER_LOCATION`   | Standard-Koordinaten für Wetter (lat,lon)     | `52.52,13.405`                                                                            |
| `NEWS_FEEDS`         | RSS-Feeds für Nachrichten (name:url,...)      | `tagesschau:https://www.tagesschau.de/xml/rss2`                                          |
| `WHISPER_MODEL`      | MLX Whisper Modell (HuggingFace Repo)         | `mlx-community/whisper-large-v3-mlx`                                                     |
| `TTS_VOICE`          | Pocket TTS Stimme                             | `juergen`                                                                                 |
| `IMAGEGEN_MODEL`     | FLUX-Modell (schnell/dev)                     | `schnell`                                                                                 |

Konfiguration über `.env`-Datei im Projektverzeichnis.

## Docker

Das Projekt nutzt Docker Compose für alle Services. Der Agent speichert Daten in einem gemeinsamen `workspace`-Volume:

```
./workspace:/workspace
```

| Datei              | Zweck                                                          |
|--------------------|----------------------------------------------------------------|
| `calendar.ics`     | Lokaler Kalender im iCalendar-Format (Events, Termine)         |
| `notes.json`       | Gespeicherte Notizen als JSON-Array                            |
| `lists/*.json`     | Benannte Listen (Einkauf, ToDo etc.) als JSON-Dateien          |
| `routines.yaml`    | Definierte Routinen mit Aktionssequenzen (z.B. "Gute Nacht")  |

## Nutzung

### Web-Chat

Ribo hat ein eingebautes Chat-Interface. Nach dem Start erreichbar unter:

```
http://localhost:8080
```

Dark Theme, responsive, funktioniert auf Desktop und Handy. Nachrichten gehen direkt an den Agent mit allen Tools (Kalender, Smart Home etc.).

### Text-Prompt

```bash
curl -X POST http://localhost:8080/prompt \
  -H "Content-Type: application/json" \
  -d '{"message": "Was steht heute im Kalender?"}'
```

### Imagegen local
```bash
mflux-generate \
  --prompt "cute cat with big eyes" \
  --model dev \
  --width 1024 \
  --height 1024 \
  --steps 20 \
  --quantize 5 \
  --output output.png \
  --lora detail_enhancer_flux_v1.safetensors 0.8
```

### Session zurücksetzen

```bash
curl -X POST http://localhost:8080/reset
```

### Health-Checks

```bash
curl http://localhost:8080/health    # Agent
curl http://localhost:8082/health    # Home Assistant
curl http://localhost:8085/health    # TTS/STT Service
```

### Telegram

1. Bot bei [@BotFather](https://t.me/BotFather) erstellen → Token kopieren
2. In `.env` eintragen: `TELEGRAM_BOT_TOKEN=...`
3. Chat-IDs in `workspace/users.json` eintragen (siehe Multi-User Setup)
4. `docker compose up -d`
5. Bot in Telegram öffnen → `/start` senden

Der Bot unterstützt:
- **Text-Nachrichten** → Antwort als Text + Voice
- **Sprachnachrichten** → Transkription + Antwort als Text + Voice
- **Bilder** (mit optionaler Caption) → Bildanalyse + Antwort
- **`/id`** → Zeigt die eigene Chat-ID an (für Setup)

**Chat-ID herausfinden:** Dem Bot `/id` schicken — er antwortet mit der Chat-ID. Diese in `workspace/users.json` beim entsprechenden User eintragen.

## Multi-User

Ribo unterstützt mehrere Nutzer mit getrennten Daten. Konfiguration über `workspace/users.json`.

### Setup

**Erstmaliges Einrichten (Admin = Enrico):**

1. Bot bei @BotFather erstellen → Token in `.env`
2. `docker compose up -d`
3. Dem Bot in Telegram `/id` schicken → eigene Chat-ID erhalten
4. Chat-ID in `workspace/users.json` bei sich eintragen
5. `docker compose restart pi-telegram`

**Neuen Nutzer hinzufügen (z.B. Jaqueline):**

1. Jaqueline sucht den Bot in Telegram (über den Bot-Namen)
2. Sie schickt `/id` → der Bot antwortet mit ihrer Chat-ID (z.B. `987654321`)
3. Enrico sagt zu Ribo: *"Leg Jaqueline mit Chat-ID 987654321 und Gruppe Familie an"*
   — oder trägt die ID manuell in `workspace/users.json` ein
4. `docker compose restart pi-telegram`
5. Jaqueline schickt `/start` → sie ist verbunden

**Hinweis:** Solange die Chat-ID nicht in `users.json` steht, bekommt der Nutzer eine Fehlermeldung ("Kein Zugriff"). Der `/id`-Befehl funktioniert für alle — damit kann jeder seine ID herausfinden, auch bevor er freigeschaltet ist.

1. Jeder Nutzer schickt dem Bot `/id` → erhält seine Chat-ID
2. Chat-IDs in `workspace/users.json` eintragen:

```json
{
  "users": {
    "enrico": {
      "name": "Enrico",
      "chat_id": 123456789,
      "permissions": ["calendar", "notes", "lists", "imagegen", "smart_home", "music", "timer", ...],
      "groups": ["familie", "eltern"]
    },
    "jaqueline": {
      "name": "Jaqueline",
      "chat_id": 987654321,
      "permissions": ["calendar", "notes", "lists", "imagegen", "smart_home", "music", "timer", ...],
      "groups": ["familie"]
    },
    "uwe": {
      "name": "Uwe",
      "chat_id": 111222333,
      "permissions": ["calendar", "notes", "lists", "imagegen", "weather", "news", "search", "weekplanner"],
      "groups": ["eltern"]
    }
  }
}
```

3. `docker compose restart pi-telegram`

### Datentrennung

| Daten | Isolation |
|-------|-----------|
| Kalender | Persönlich pro User + geteilte Gruppen-Kalender |
| Notizen | Komplett getrennt pro User |
| Listen | Persönlich + konfigurierbar geteilte Listen (z.B. Einkaufsliste) |
| Generierte Bilder | Komplett getrennt, nur an Anforderer gesendet |
| Smart Home / Musik | Geteilt (selber Haushalt), per Permission steuerbar |
| Routinen | Geteilt |

### Gruppen

Gruppen ermöglichen geteilte Kalender und Listen:

- **familie** (Enrico + Jaqueline): Familienkalender + Einkaufsliste
- **eltern** (Enrico + Uwe): Eltern-Kalender

Ein User kann in mehreren Gruppen sein. "Was steht im Kalender?" zeigt persönliche + alle Gruppen-Termine.

### Berechtigungen

Nicht jeder User braucht Zugriff auf alle Features. Beispiel:
- Uwe (anderer Haushalt) → kein Smart Home, keine Musik, kein Timer
- Enrico + Jaqueline → voller Zugriff

### Verzeichnisstruktur

```
workspace/
├── users.json              ← User-Konfiguration
├── users/
│   ├── enrico/
│   │   ├── calendar.ics
│   │   ├── notes.json
│   │   ├── lists/
│   │   └── generated-images/
│   ├── jaqueline/
│   │   └── ...
│   └── uwe/
│       └── ...
├── shared/
│   ├── familie/
│   │   ├── calendar.ics
│   │   └── lists/
│   └── eltern/
│       ├── calendar.ics
│       └── lists/
└── routines.yaml
```

## Features im Detail

### Kalender – CRUD + Erinnerungen

```
„Trag morgen um 14 Uhr Zahnarzt ein"
„Trag Freitag 10 Uhr Meeting ein und erinnere mich 1 Tag und 1 Stunde vorher"
„Was steht heute an?"
„Verschieb den Zahnarzt auf Freitag"
„Lösch den Termin Zahnarzt"
```

Erinnerungen werden als Push-Nachricht via Telegram geschickt (1 Tag vorher, 1 Stunde vorher, etc.).

Unterstützte Datumsformate: `heute`, `morgen`, `übermorgen`, Wochentage, `TT.MM.`, `TT.MM.YYYY`
Unterstützte Uhrzeitformate: `HH:MM`, `um X Uhr`, `um halb X`

### Listen – Einkauf, ToDo & mehr

```
„Erstell eine Einkaufsliste"
„Setz 3 Äpfel auf die Einkaufsliste"
„Setz Zählerstände ablesen auf die ToDo"
„Was steht auf der Einkaufsliste?"
```

Duplikate werden automatisch erkannt (case-insensitiv). Bei Einträgen mit Menge werden die Mengen addiert.

### Wetter mit Ortsangabe

```
„Wie ist das Wetter in München?"
„Wie wird das Wetter morgen in Berlin?"
```

### Web-Suche

```
„Wie ist der Bitcoin-Kurs?"
„Rezept für Kartoffelsuppe"
```

Benötigt `TAVILY_API_KEY` in der `.env`.

### Smart Home

```
„Mach das Licht im Wohnzimmer an"
„Wie warm ist es im Schlafzimmer?"
```

### Lernkarten (Spaced Repetition)

```
„Ich will Japanisch lernen"
„Mach 10 neue Spanisch-Vokabeln"
„Frag mich Japanisch ab"
„Wie ist mein Lernfortschritt?"
```

Ribo erstellt Vokabel-Decks, generiert Karten und fragt dich ab. Karten werden nach dem SM-2 Algorithmus wiederholt — je besser du eine Karte kannst, desto seltener wird sie abgefragt. Funktioniert auch per Sprache via Telegram.

## Hey Ribo – TTS/STT + Musik + Timer (macOS)

`hey-ribo.py` startet den nativen Audio-Service aus `ribo_audio.py`. Er stellt bereit:

1. **TTS/STT API** (Port 8085) — `/tts` und `/transcribe` Endpoints für Telegram
2. **Musik/Radio** — `/music/play`, `/music/stop`, `/music/volume`
3. **Timer** — `/timer/create`, `/timer/cancel`, `/timer/list`
Es wird kein Mikrofon- oder Wake-Word-Listener gestartet.

MLX Whisper nutzt die Metal GPU für schnelle Transkription.

```bash
# uv installieren (falls noch nicht vorhanden)
curl -LsSf https://astral.sh/uv/install.sh | sh

# Dependencies installieren und starten
uv run --env-file .env --locked hey-ribo.py
```

TTS/STT arbeiten nacheinander; Status, Musik und Timer bleiben parallel erreichbar.
Die Sprachausgabe hat eine begrenzte Warteschlange. Bei voller Auslastung liefert die API
Status 503. Temporäre Audiodateien werden auch bei Verarbeitungsfehlern aufgeräumt.

## Bildgenerierung (FLUX auf Apple Silicon)

Ribo kann Bilder lokal generieren — komplett offline, Metal-beschleunigt via MLX. Nutzt FLUX.1 (Schnell oder Dev) von Black Forest Labs.

### Setup

```bash
# mflux installieren (enthält FLUX-Modelle für Apple Silicon)
uv pip install mflux

# ImageGen Service starten (Port 8086)
uv run --env-file .env --locked imagegen-service/server.py
```

Beim ersten Aufruf wird das FLUX-Modell automatisch von HuggingFace heruntergeladen (~12 GB für schnell, ~24 GB für dev). Danach läuft alles offline.

### Nutzung

```
„Generier mir ein Bild von einer Katze mit Hut"
„Erstell ein Pixel-Art Sprite von einem Roboter"
„Mach mir ein Wallpaper — Sonnenuntergang über dem Meer"
```

Via Telegram wird das generierte Bild automatisch als Foto zurückgeschickt.

### Modelle

| Modell | Steps | Geschwindigkeit | Qualität | RAM-Bedarf |
|--------|-------|-----------------|----------|------------|
| `schnell` (default) | 4 | ~10s/Bild | Gut | ~12 GB |
| `dev` | 20 | ~50s/Bild | Exzellent | ~24 GB |

Konfiguration in `.env`:
```
IMAGEGEN_MODEL=schnell
IMAGEGEN_QUANTIZE=8
```

## Plugins

Die vier gepflegten Plugins `send_message`, `reminders`, `file_reader` und `witz` liegen
versioniert unter `pi-agent/plugins/`. Im lokalen `workspace/plugins/` liegen kleine
Import-Dateien und die jeweiligen `.meta.json`-Freigaben. Die bestehenden Freigaben bleiben
bei einem Rebuild erhalten. Neue eigene Plugins können weiterhin dort liegen.

Nur Administratoren mit passender Freigabe dürfen Plugins ausführen. Fehlende, ungültige
oder leere `allowed_users` verweigern den Zugriff; `null` erlaubt allen Admins die Nutzung.
`develop` kann Plugins auflisten und eine Vorlage anzeigen. Automatische Code- und
Freigabeänderungen sind standardmäßig gesperrt; Änderungen werden lokal geprüft und eingespielt.

Nach einer Neuinstallation lassen sich die geprüften Standard-Importdateien und fehlende
Freigaben für einen bereits angelegten Administrator einrichten:

```bash
python3 scripts/install-default-plugins.py --admin enrico
```

Eigene vorhandene Plugins und bestehende Freigaben werden dabei nicht überschrieben.
Plugins laufen im Agent-Prozess und haben dessen Node.js-Zugriff; sie sind kein isolierter
Ausführungsbereich. Installiere daher nur geprüften Code.

Das Erinnerungs-Plugin unterstützt einmalige und tägliche/wöchentliche Telegram-Erinnerungen,
z.B. `morgen 08:00`, `in 10 Minuten` und `jeden Montag um 09:00`. Alte Datensätze ohne `due_at`
bleiben als solche erkennbar und können mit `reschedule` neu terminiert werden.

Geplante Ribo-Aufträge bündeln Versandaufträge und Antwort: Der Scheduler liefert den
vollständigen Inhalt einmal aus. Texte über dem Telegram-Limit werden als Textdatei in
einer einzelnen Nachricht zugestellt.

## Plattform-Hinweise

### Mac (Apple Silicon) — Empfohlen
- Ollama nutzt Metal GPU automatisch
- hey-ribo.py für TTS/STT + Musik + Timer (MLX Whisper, Metal-beschleunigt)
- TTS/STT läuft **nativ** (kein Docker) — deutlich schneller
- Docker Desktop nur für Agent, Telegram-Bot und Home Assistant

**GPU RAM-Limit erhöhen (empfohlen für 32b Modelle):**

macOS begrenzt standardmäßig wie viel RAM die GPU nutzen darf. Für große Modelle lohnt es sich das Limit anzuheben:

```bash
# GPU darf bis zu 36 GB nutzen (empfohlen für M5 Pro 48 GB)
sudo sysctl iogpu.wired_limit_mb=36000
```

Überlebt keinen Neustart. Für permanenten Effekt als Login-Script einrichten oder bei jedem Boot ausführen.

### Linux (NVIDIA GPU)
- Ollama nutzt CUDA automatisch
- hey-ribo.py nicht verfügbar (braucht MLX/Metal)
- TTS/STT erfordert eigene Lösung (hey-ribo.py nutzt MLX/pocket-tts, läuft nur auf Mac)
- NVIDIA Container Toolkit erforderlich (`nvidia-docker`)

## Modell-Empfehlungen

### Lokal (LLM_PROVIDER=ollama, Default)

| RAM   | Modell (PI_MODEL)          | Vision | Stärken                                    |
|-------|----------------------------|--------|--------------------------------------------|
| 48 GB | qwen3.8:27b (empfohlen)    | ✅ nativ | Multimodal, starkes Agentic, ein Modell    |
| 48 GB | qwen3:32b + qwen2.5vl:32b  | separat | Ältere Variante, zwei Modelle              |
| 16 GB | qwen3:8b                   | ❌     | Leicht, schnell, nur Text                  |

**Warum qwen3.8:27b?** Es ist multimodal — versteht Text UND Bilder/Videos nativ. Damit brauchst du **kein separates Vision-Modell** mehr (Agent + Vision in einem). Zusätzlich starkes Agentic/Tool-Calling-Verhalten und flexibles Reasoning (`THINKING_LEVEL`).

**Thinking-Level:** Der lokale Standard ist `low` (Normal). Im Webchat lassen sich
Normal, Gründlich (`high`) und Sehr gründlich (`xhigh`) wählen. In Telegram:
`/modus normal`, `/modus gruendlich`, `/modus maximal`. Telegram merkt sich den Modus
bis zum Bot-Neustart. Gründlichere Modi benötigen mehr Zeit.

### Cloud (LLM_PROVIDER=anthropic, Claude API)

Statt lokalem Ollama kann Ribo auch die **Claude API** nutzen. Alle aktuellen Claude-Modelle sind multimodal (Text + Bild), Vision funktioniert also automatisch mit.

| Modell (PI_MODEL)  | Preis (In/Out je MTok) | Stärken                                  |
|--------------------|------------------------|------------------------------------------|
| claude-sonnet-5 (empfohlen) | $2 / $10      | Bester Speed/Preis-Mix, für Alltag ideal |
| claude-opus-5      | $5 / $25               | Stärker bei komplexen Aufgaben           |
| claude-haiku-4.5   | $1 / $5                | Am schnellsten/günstigsten               |

*(Preise Stand Sept. 2026, per MTok = 1 Mio. Tokens. Exakte Modell-IDs/Versionen siehe [platform.claude.com/docs](https://platform.claude.com/docs/en/docs/about-claude/models).)*

**Einrichtung:**
```bash
# in .env:
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...      # API-Key aus console.anthropic.com
PI_MODEL=claude-sonnet-5
```

> ⚠️ **API-Key ≠ Abo:** Es funktioniert nur der **API-Key** aus der [Anthropic Console](https://console.anthropic.com) (pay-per-token). Das **Claude-Pro/Max-Abo** (claude.ai) lässt sich hier **nicht** einbinden — das ist an Anthropics eigene Clients gebunden.
>
> 🔒 **Datenschutz:** Mit `anthropic` verlassen alle Prompts (Kalender, Notizen, Fotos, Familien-Daten) deinen Mac und gehen an Anthropic. `ollama` bleibt vollständig lokal.
>
> ℹ️ **Ollama-Fallback:** Bei `LLM_PROVIDER=anthropic` wird Ollama nicht mehr gebraucht. Der `open-webui`-Service (Chat-UI für Ollama) bleibt davon unberührt und kann weiter lokal laufen oder gestoppt werden.

### Laufzeit und Speicher

Das vorhandene 64k-Modell und sein Modelfile bleiben erhalten. Der Server kürzt ältere
Gesprächsrunden ab etwa 36.000 geschätzten Tokens oder 40 Nachrichten. Das ist eine
konservative Schätzung, kein exakter Tokenizer. Ein einzelner übergroßer letzter Turn
bleibt der Kontextbehandlung des SDK überlassen. Werkzeug-Textausgaben sind auf insgesamt
24.000 Zeichen pro Ergebnis begrenzt; bei Kürzung bleiben Anfang und Ende erhalten.

`IMAGEGEN_REUSE_MODEL=1` verwendet für Flux2-Textbilder einen einzelnen Modell-Worker.
Ein Modellwechsel startet einen frischen Prozess. Nach `IMAGEGEN_MODEL_IDLE_SECONDS=60`
Sekunden ohne Auftrag beendet er sich und gibt den Metal-Speicher frei. Andere Engines,
Bildbearbeitung und Videos behalten ihre bisherigen CLI-Aufrufe. Bild und Video laufen
nacheinander; weitere Generierungsanfragen erhalten währenddessen 503, Statusabfragen bleiben erreichbar.

Lokaler Test (256×256, Flux2 Klein 4B, 8 Bit, 4 Schritte, gleicher Seed/Prompt):
erster Aufruf 7,29 s, zweiter Aufruf mit geladenem Modell 1,54 s. Das ist keine Prognose
für große Bilder. Für Chat, Audio und Generierung werden Laufzeiten protokolliert;
die neuen Messmeldungen enthalten keine Nachrichteninhalte.


## Projektstruktur

```
pi-agent/
├── docker-compose.yaml
├── .env.example
├── .gitignore
├── IDEAS.md                           ← Feature-Ideen
├── pyproject.toml                     ← Python-Dependencies (uv)
├── hey-ribo.py                        ← TTS/STT + Musik + Timer (nativ, macOS)
├── pi-agent/
│   ├── Dockerfile
│   ├── server.js                      ← Prozessstart; app.js/http/services sind getrennt
│   ├── lib/
│   │   ├── users.js                   ← Multi-User System
│   │   ├── helpers.js                 ← Date-Parsing, Kalender, Listen, Pfade
│   │   └── plugins.js                 ← Plugin-Loader
│   ├── tools/                         ← Alle Tools als einzelne Dateien
│   │   ├── homeassistant.js           ← Smart Home
│   │   ├── music.js                   ← Musik/Radio
│   │   ├── timer.js                   ← Timer
│   │   ├── weather.js                 ← Wetter
│   │   ├── news.js                    ← Nachrichten
│   │   ├── notes.js                   ← Notizen
│   │   ├── calendar.js                ← Kalender + Erinnerungen
│   │   ├── routines.js                ← Routinen
│   │   ├── lists.js                   ← Listen
│   │   ├── weekplanner.js             ← Wochenplanung
│   │   ├── search.js                  ← Web-Suche
│   │   ├── imagegen.js                ← Bildgenerierung
│   │   ├── flashcards.js              ← Lernkarten
│   │   ├── cooking.js                 ← Kochassistent
│   │   ├── expenses.js                ← Ausgaben-Tracker
│   │   ├── personality.js            ← Persönlichkeit pro User
│   │   ├── memory.js                  ← Langzeitgedächtnis
│   │   ├── files.js                   ← Dateien senden/löschen
│   │   ├── projects.js                ← Code-Projekte
│   │   ├── admin.js                   ← User-Verwaltung
│   │   └── develop.js                 ← Plugin-Entwicklung
│   ├── public/index.html              ← Web-Chat Interface
│   ├── SYSTEM.md                      ← System-Prompt
│   ├── models.json                    ← Ollama-Modell-Konfiguration (editierbar)
│   └── weather-helpers.js
├── pi-telegram/
│   ├── Dockerfile
│   └── start.js                       ← Bot-Prozessstart; Handler, Transport und Jobs getrennt
├── imagegen-service/
│   └── server.py                      ← Bildgenerierung (FLUX via mflux, nativ)
├── ha-service/
│   ├── Dockerfile
│   └── server.js                      ← Home Assistant Bridge
└── workspace/
    ├── users.json                     ← User-Konfiguration
    ├── routines.yaml                  ← Smart-Home Routinen (global)
    ├── plugins/                       ← Ribo-Plugins
    ├── users/                         ← Persönliche Daten pro User
    └── shared/                        ← Geteilte Gruppen-Daten
```

## Web-Chat vom Windows-PC im Heimnetz

Der Ribo-Web-Chat ist auf Port 8080 im Heimnetz erreichbar. Nach Änderungen
an Web-Chat oder Portfreigabe den Agenten neu bauen und starten:

```bash
docker compose up -d --build pi-agent
```

Auf dem Windows-PC im Browser `http://<LAN-IP-des-Macs>:8080` öffnen.
Die IP steht am Mac unter Systemeinstellungen → Netzwerk → aktive Verbindung → Details.
Beide Rechner müssen sich im selben Heimnetz befinden; eine Mac-Firewall muss
eingehende Verbindungen zu Docker auf Port 8080 erlauben.

Über die Büroklammer ein JPEG-, PNG- oder WebP-Bild bis 10 MB auswählen,
optional eine Frage ergänzen und senden. Ohne Text fragt Ribo nach dem Bildinhalt.
Die Bildanalyse nutzt dieselbe Ollama-Schnittstelle wie Telegram.

Der Web-Chat verlangt jetzt eine Browser-Anmeldung. Einmalig `python3 scripts/setup-security.py` ausführen.
Nutzer und generiertes Passwort stehen ausschließlich lokal in `.ribo-browser-access.txt` (nicht in Git).
Die Anmeldung ist an einen festen Nutzer gebunden; andere Nutzeridentitäten werden abgewiesen.
HTTP Basic schützt den Zugriff, verschlüsselt aber ohne HTTPS nicht die Übertragung: nur im vertrauenswürdigen Heimnetz verwenden; keine Router-Portweiterleitung einrichten.
Für einen ausschließlich lokalen Zugang in `.env` `RIBO_BIND_ADDRESS=127.0.0.1`
setzen und den Agenten mit obigem Befehl neu starten.

## Sicherheitskonfiguration

Vor dem ersten Start: `python3 scripts/setup-security.py`, danach `python3 scripts/setup-mqtt.py`. Das ergänzt vorhandene
`.env`-Werte, ohne bestehende Zugangsdaten zu überschreiben. Native Dienste und Docker
müssen denselben `RIBO_INTERNAL_TOKEN` verwenden. Native Dienste deshalb über
`uv run --env-file .env --locked …` starten. Nach dieser Umstellung müssen die bereits
laufenden nativen Dienste einmal neu gestartet werden.

Browserzugriffe nutzen HTTP Basic mit `RIBO_WEB_USER` und `RIBO_WEB_PASSWORD`.
Telegram und die lokalen Dienste nutzen stattdessen einen internen Bearer-Token.
Downloads sind auf den authentifizierten Nutzer begrenzt, Reset betrifft nur dessen
Session. Die interne Dienstkennung ist geheim zu halten und darf nicht in Browsercode stehen.

Eigene Node-Dienste verwenden versionierte `package.json`/`package-lock.json`,
`npm ci --ignore-scripts`, keine globalen npm-Auto-Updates und keine unkontrollierten
Rebuild-Skripte. Die Ollama-Erweiterung verwendet denselben Runtime-Paketbestand.
`node --test tests/*.test.mjs` führt Sicherheits-Regressionstests aus; die Integrationstests
verwenden ausschließlich einen isolierten Container mit `/tmp` und `/workspace` als tmpfs.
Nicht gegen den produktiven Workspace ausführen. Tests verlangen `RIBO_TEST_ISOLATED=1`.
Im Laufzeit-Image sind npm und npx entfernt; neue Pakete werden ausschließlich beim Build installiert.

Workspace-Plugins sind standardmäßig nur für den Administrator verfügbar; fehlende
oder ungültige Metadaten sperren sie. Leere `allowed_users` bedeutet **niemand**,
`null` bedeutet explizit alle (zusätzlich gilt die Admin-Schranke). Plugin-Code läuft
weiterhin im Agentprozess und ist deshalb nur nach lokaler Prüfung zu installieren.
LLM-gesteuerte Änderungen sind standardmäßig gesperrt (`RIBO_ALLOW_PLUGIN_EDIT` ist aus).

MQTT und die alte Open-WebUI-Oberfläche werden standardmäßig nur auf dem Mac
veröffentlicht. MQTT-Clients im Docker-Netz bleiben erreichbar. MQTT verwendet zusätzlich
Passwortanmeldung und eine explizite ACL. Home Assistant und Govee verwenden die
zusammen eingerichteten Broker-Zugangsdaten. Die Datei `mosquitto/config/passwords`
enthält ausschließlich Passwort-Hashes und wird nicht eingecheckt. Govees
Steueroberfläche lauscht nur auf `127.0.0.1:8056`.


### Beibehaltener Smart-Home-Aufbau

Home Assistant, govee2mqtt und der abgesicherte Mosquitto-Broker bleiben auf Wunsch
erhalten. Die Leuchten antworten lokal auf dem Mac. Die getestete Direktanbindung
über Docker Desktop war wegen Multicast und umgeschriebener UDP-Absenderadressen
nicht verlässlich. Es wird keine zusätzliche VM eingerichtet.

Für einen frischen Checkout erzeugt `scripts/setup-mqtt.py` die nicht eingecheckte
Passwort-Hashdatei; vorhandene Dateien und Zugangsdaten werden beibehalten. Bei einem
neuen Home-Assistant-Setup die MQTT-Integration mit Broker `mosquitto`, Port `1883`
und den lokalen `GOVEE_MQTT_USER`/`GOVEE_MQTT_PASSWORD`-Werten aus `.env` einrichten.
Eine Änderung des MQTT-Passworts muss immer mit Home Assistant und Govee abgestimmt werden.

## Code-Struktur und Entwicklung

Die Einstiegspunkte `pi-agent/server.js` und `pi-telegram/start.js` enthalten nur noch den
Prozessstart. Chat-/Sitzungslogik, HTTP, Telegram-Transport, Darstellung und native Fachbausteine
sind getrennt und separat testbar. Details: [ARCHITECTURE.md](ARCHITECTURE.md).

Mit `make verify` werden die Images gebaut, Syntax geprüft und die isolierten Regressionstests
ausgeführt. Die vorbereitete GitHub-CI verwendet denselben Ablauf. Hinweise für Änderungen:
[DEVELOPMENT.md](DEVELOPMENT.md).

Leistungsprüfung vom 9. November 2026: [Messungen und Verbesserungen](PERFORMANCE-RESULTS.md), einschließlich Schnellmodus und weiterer Prioritäten.

Gedächtnis und weitere Leistungsverbesserungen: [Grundwissen, Kontext und Bildspeicher](PERFORMANCE-ROUND2.md).

Telegram-Komfort und Modellplanung: [Vorschau, Audio-Schalter, Zeitmessung und Alltagstests](PERFORMANCE-ROUND3.md).

Bild-Uploads: [Nutzertrennung, eigene Namen und Bildverwaltung in Web/Telegram](IMAGE-UPLOADS.md).

Modelle im laufenden Betrieb wechseln: [Webauswahl, Telegram-Befehl und Verhalten](MODEL-SWITCHING.md).
