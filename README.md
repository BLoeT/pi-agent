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
| 17 | **Godot Spieleentwicklung** | „Erstell eine Spieler-Szene mit Bewegungslogik" |
| 18 | **Bildgenerierung (FLUX)** | „Generier einen blauen Roboter, Pixel Art" |
| 19 | **Multi-User** | Getrennte Daten, geteilte Kalender/Listen, Berechtigungen |
| 20 | **Persönlichkeit pro User** | Beim ersten Kontakt: Wie soll ich mit dir reden? |
| 21 | **Langzeitgedächtnis** | Merkt sich Fakten, fasst Sessions zusammen, selektives Vergessen |
| 22 | **Proaktive Nachrichten** | Automatisch Wetter/Termine zur gewohnten Zeit |
| 23 | **Gewohnheiten lernen** | Erkennt Muster, schlägt Automatisierung vor |
| 24 | **Plugin-System** | „Bau dir ein Tool das Witze erzählt" (Admin) |
| 25 | **Admin-Verwaltung** | „Leg User Liam an mit Gruppe Familie" |
| 26 | **Dateien senden** | „Schick mir mein player.gd Script" / „Welche Bilder habe ich?" |
| 27 | **Code-Projekte** | „Schreib mir ein JavaScript das CSVs zusammenführt" + ZIP-Export |

## Voraussetzungen

- Mac Mini M5 Pro (18-Core CPU, 48 GB RAM) oder Linux mit NVIDIA GPU
- Docker Desktop (Mac) oder Docker + NVIDIA Container Toolkit (Linux)
- Ollama installiert (`brew install ollama` auf Mac, [ollama.com](https://ollama.com) auf Linux)
- [uv](https://docs.astral.sh/uv/) für native Python-Services (TTS/STT, Sprachsteuerung)
- ffmpeg (`brew install ffmpeg`) + mpv (`brew install mpv`) für Audio
- Optional: USB-Mikrofon für Sprachsteuerung (hey-ribo.py)
- Optional: [Godot Engine 4.4](https://godotengine.org/download/) für Spieleentwicklung

## Setup

```bash
# Ollama starten
ollama serve

# Modell laden (multimodal: Text + Tool-Calling + Vision in einem)
ollama pull qwen3.8:27b

# .env konfigurieren
cp .env.example .env
# TELEGRAM_BOT_TOKEN, HA_TOKEN, TAVILY_API_KEY eintragen

# Native Services starten (TTS/STT + Sprachsteuerung + Musik + Timer)
uv run hey-ribo.py

# Optional: Bildgenerierung starten (FLUX auf Apple Silicon)
uv run imagegen-service/server.py

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
| hey-ribo.py    | 8085  | TTS/STT + Musik + Timer + Sprachsteuerung | Nativ (macOS) |
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
| `THINKING_LEVEL`     | Denk-Intensität (off/minimal/low/medium/high/xhigh/max) | `medium`                                                                        |
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

Dark Theme, responsive, funktioniert auf Desktop und Handy. Nachrichten gehen direkt an den Agent mit allen Tools (Kalender, Godot, Smart Home etc.).

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
      "permissions": ["calendar", "notes", "lists", "godot", "imagegen", "smart_home", "music", "timer", ...],
      "groups": ["familie", "eltern"]
    },
    "jaqueline": {
      "name": "Jaqueline",
      "chat_id": 987654321,
      "permissions": ["calendar", "notes", "lists", "godot", "imagegen", "smart_home", "music", "timer", ...],
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
| Godot-Projekte | Komplett getrennt pro User |
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
- Uwe (anderer Haushalt) → kein Smart Home, keine Musik, kein Timer, kein Godot
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
│   │   ├── godot-project/
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

## Hey Ribo – TTS/STT + Sprachsteuerung (macOS)

Das Script `hey-ribo.py` ist der zentrale native Service auf macOS. Es stellt bereit:

1. **TTS/STT API** (Port 8085) — `/tts` und `/transcribe` Endpoints für Telegram
2. **Musik/Radio** — `/music/play`, `/music/stop`, `/music/volume`
3. **Timer** — `/timer/create`, `/timer/cancel`, `/timer/list`
4. **Sprachsteuerung** — Wake Word "Hey Ribo" mit MLX Whisper + Pocket TTS

MLX Whisper nutzt die Metal GPU für schnelle Transkription.

```bash
# uv installieren (falls noch nicht vorhanden)
curl -LsSf https://astral.sh/uv/install.sh | sh

# Dependencies installieren und starten
uv run hey-ribo.py
```

### Standalone TTS/STT (ohne Sprachsteuerung)

Falls nur der TTS/STT HTTP-Service benötigt wird (z.B. für Telegram-Voice ohne Mikrofon):

```bash
uv run hey-ribo.py
```

(Das Wake-Word kann ignoriert werden — der HTTP-Server auf Port 8085 läuft trotzdem.)

## Bildgenerierung (FLUX auf Apple Silicon)

Ribo kann Bilder lokal generieren — komplett offline, Metal-beschleunigt via MLX. Nutzt FLUX.1 (Schnell oder Dev) von Black Forest Labs.

### Setup

```bash
# mflux installieren (enthält FLUX-Modelle für Apple Silicon)
uv pip install mflux

# ImageGen Service starten (Port 8086)
uv run imagegen-service/server.py
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

## Godot — Spieleentwicklung

Ribo kann Godot-4-Spiele erstellen und bearbeiten. Er schreibt Szenen (`.tscn`), Scripts (`.gd`) und Ressourcen direkt ins Projektverzeichnis.

### Setup

```bash
# Godot 4.4 installieren (macOS)
brew install --cask godot

# Oder manuell von https://godotengine.org/download/

# Pfad in .env setzen
GODOT_PATH=/Applications/Godot.app/Contents/MacOS/Godot
```

### Nutzung

```
„Erstell ein neues 2D-Spiel namens SpaceShooter"
„Erstell eine Spieler-Szene mit CharacterBody2D und Bewegungslogik"
„Schreib ein Script für einen Gegner der dem Spieler folgt"
„Zeig mir die Projektdateien"
„Starte das Spiel"
```

### Was Ribo kann

| Aktion | Beschreibung |
|--------|-------------|
| Projekt erstellen | `project.godot` + Standardverzeichnisse (scenes/, scripts/, assets/) |
| Szenen schreiben | `.tscn`-Dateien mit Nodes, Shapes, Scripts |
| Scripts schreiben | GDScript 4.x (`.gd`) mit typisierter Syntax |
| Dateien lesen | Bestehende Szenen/Scripts anzeigen |
| Dateien löschen | Aufräumen |

Ribo schreibt die Dateien, du öffnest das Projekt in Godot zum Testen:

```bash
# Projekt in Godot öffnen
/Applications/Godot.app/Contents/MacOS/Godot --path workspace/users/enrico/godot-project/

# Oder: Godot starten → Projekt importieren → workspace/users/enrico/godot-project/ auswählen
```

### Projektstruktur

Ribo legt Projekte standardmäßig unter `workspace/godot-project/` an:

```
godot-project/
├── project.godot
├── scenes/
│   ├── player.tscn
│   ├── enemy.tscn
│   └── level_01.tscn
├── scripts/
│   ├── player.gd
│   ├── enemy.gd
│   └── game_manager.gd
└── assets/
    ├── sprites/
    └── audio/
```

## Plugin-System (Ribo erweitert sich selbst)

Admins können Ribo bitten sich selbst neue Tools zu schreiben. Plugins werden als `.js`-Dateien in `workspace/plugins/` gespeichert und beim nächsten Neustart geladen.

### Nutzung

```
„Bau dir ein Tool das Witze erzählen kann"
„Erstell ein Plugin das den aktuellen Bitcoin-Kurs speichert"
„Bau mir ein privates Tool für meine Arbeitszeit" (nur für dich)
„Gib Jaqueline Zugriff auf das Arbeitszeit-Tool"
„Zeig mir alle installierten Plugins"
„Lösch das Witze-Plugin"
```

### Wie es funktioniert

1. Du sagst Ribo was er können soll (nur als Admin)
2. Ribo schreibt ein Plugin nach `workspace/plugins/tool-name.js`
3. `docker compose restart pi-agent`
4. Das neue Tool ist verfügbar

Plugins haben vollen Zugriff auf Node.js APIs (fetch, fs, etc.) und folgen der gleichen Struktur wie die eingebauten Tools.

### Zugriffskontrolle

Plugins sind standardmäßig für alle User verfügbar. Du kannst sie einschränken:

- Beim Erstellen: nur für bestimmte User (`allowed_users`)
- `grant_access` / `revoke_access` — Zugriff nachträglich anpassen

Die Zugriffsrechte werden in einer `<plugin>.meta.json` neben dem Plugin gespeichert. Nur Admins können Plugins erstellen und Zugriffe verwalten.

## Plattform-Hinweise

### Mac (Apple Silicon) — Empfohlen
- Ollama nutzt Metal GPU automatisch
- hey-ribo.py für TTS/STT + Sprachsteuerung (MLX Whisper, Metal-beschleunigt)
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

**Thinking-Level:** qwen3.8 neigt bei "high" und höher zum Überdenken einfacher Befehle. Für Ribo ist **`medium`** ideal (Standard), für maximale Geschwindigkeit **`low`**. Mögliche Werte: `off, minimal, low, medium, high, xhigh, max`.

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

### Performance-Tuning (optional, 48 GB)

Für maximalen Context (32k Token) mit Flash Attention und quantisiertem KV-Cache:

```bash
# Optimiertes Modelfile erstellen
ollama create ribo-agent -f - <<EOF
FROM qwen3.8:27b
PARAMETER num_ctx 32768
PARAMETER flash_attention true
PARAMETER num_gpu 99
EOF
```

Dann in `.env`: `PI_MODEL=ribo-agent`

**Was das bringt:**
- **Flash Attention** — Verarbeitet den Context blockweise, spart ~50% KV-Cache RAM
- **num_gpu 99** — Alle Layer auf GPU (Metal), maximale Geschwindigkeit
- **32k Context** — Doppelt so viel wie Standard, reicht für lange Lernkarten-Sessions und komplexe Konversationen

Ohne dieses Tuning läuft der Agent mit 16k Context (docker-compose Default) — funktioniert gut für die meisten Aufgaben.

## Projektstruktur

```
pi-agent/
├── docker-compose.yaml
├── .env.example
├── .gitignore
├── IDEAS.md                           ← Feature-Ideen
├── pyproject.toml                     ← Python-Dependencies (uv)
├── hey-ribo.py                        ← TTS/STT + Sprachsteuerung + Musik (nativ, macOS)
├── pi-agent/
│   ├── Dockerfile
│   ├── server.js                      ← Entry-Point (Express + Routing + Sessions)
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
│   │   ├── godot.js                   ← Godot-Spiele
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
│   └── start.js                       ← Telegram Bot + Reminder-Service
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
