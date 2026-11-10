> Aktuelle Modulstruktur und Entwicklungsregeln: [ARCHITECTURE.md](../ARCHITECTURE.md).
> Die folgende Übersicht beschreibt die Dienste und Datenbereiche.

# Architektur

## Überblick

Ribo ist ein persönlicher AI-Assistent der lokal auf einem Mac Mini läuft. Die Kernidee: Ein LLM (Qwen3.8:27b über Ollama) bekommt eine Nutzeranfrage, entscheidet welches Werkzeug ("Tool") es braucht, und führt es aus.

## Die fünf Services

```
┌──────────────────────────────────────────────────────────────────┐
│   Eingabekanäle                                                   │
│   Telegram        Web-Chat          "Hey Ribo" (Mikrofon)         │
│      ↕               ↕                    ↕                       │
│   pi-telegram   localhost:8080      hey-ribo.py                   │
│      │               │                    │                       │
│      └───────────────┴──── /prompt ───────┘                       │
│                       ↓                                            │
│              pi-agent (Docker, :8080)                             │
│              ├─ Session pro User                                   │
│              ├─ 22 Tools                                           │
│              └─ Plugins                                            │
│                  ↕            ↕            ↕            ↕          │
│              Ollama      ha-service   hey-ribo    imagegen        │
│              (LLM)       (Smart Home) (Musik/TTS) (FLUX)          │
│                              ↕                                     │
│                        Home Assistant                             │
└──────────────────────────────────────────────────────────────────┘
```

## Warum Docker + Nativ gemischt?

- **Docker** (pi-agent, pi-telegram, ha-service): Portabel, isoliert, einfach zu starten
- **Nativ** (hey-ribo.py, imagegen-service): Brauchen Apple-Silicon-Beschleunigung (MLX/Metal), die im Docker nicht verfügbar ist. Deshalb laufen sie direkt auf macOS.

Docker-Container erreichen die nativen Services über `host.docker.internal` (Docker-Desktop-Feature, das auf den Host zeigt).

## Datenspeicherung: workspace/

Alle Nutzerdaten liegen im `workspace/`-Ordner (als Docker-Volume gemountet, also auf der Mac-Festplatte):

```
workspace/
├── users.json              ← Nutzer-Konfiguration (wer, Berechtigungen, Gruppen)
├── routines.yaml           ← Smart-Home-Routinen (global)
├── plugins/                ← Von Ribo geschriebene Plugins
├── users/
│   ├── enrico/             ← Enricos private Daten
│   │   ├── calendar.ics
│   │   ├── notes.json
│   │   ├── lists/
│   │   ├── flashcards/
│   │   ├── expenses/
│   │   ├── memory/
│   │   ├── generated-images/
│   │   └── projects/
│   ├── jaqueline/
│   └── uwe/
└── shared/
    ├── familie/            ← Geteilt zwischen Enrico + Jaqueline
    │   ├── calendar.ics
    │   └── lists/
    └── eltern/             ← Geteilt zwischen Enrico + Uwe
```

## Der zentrale Ablauf einer Anfrage

1. Nutzer schreibt "Was steht morgen an?" in Telegram
2. **pi-telegram** erkennt die Chat-ID → ermittelt `user_id` (z.B. "enrico") aus users.json
3. pi-telegram ruft `pi-agent` `/prompt` auf mit `{ message, user_id }`
4. **pi-agent** setzt den aktuellen User-Kontext (`setCurrentUser`)
5. pi-agent lädt die Session für diesen User (oder erstellt eine neue)
6. Persönlichkeit + Langzeitgedächtnis werden als Kontext vor die Nachricht gehängt
7. Das LLM (Ollama) verarbeitet die Nachricht und ruft das `calendar`-Tool auf
8. Das calendar-Tool liest `workspace/users/enrico/calendar.ics` (+ Familien-Kalender)
9. Die Antwort geht zurück an pi-telegram → als Text + Sprachnachricht an Telegram

## Multi-User-Prinzip

Der Trick: Es gibt eine globale Variable `_currentUserId` im pi-agent. Vor jeder Anfrage wird sie auf den anfragenden User gesetzt. Alle Tools rufen `getCurrentUserId()` auf und leiten daraus ihre Dateipfade ab (`workspace/users/<name>/...`). So arbeitet jeder User isoliert, ohne dass die Tools selbst User-Logik brauchen.

## Berechtigungen

Jeder Tool-Aufruf prüft am Anfang `checkPermission("toolname")`. Die Berechtigungen stehen in `users.json` pro User. Fehlt die Berechtigung, gibt das Tool eine Fehlermeldung zurück statt zu handeln.
