# hey-ribo.py — Sprachsteuerung, TTS/STT, Musik, Timer

Der zentrale native Service auf macOS. Vereint mehrere Funktionen:
1. **Wake-Word-Listener** — hört auf "Hey Ribo" und verarbeitet Sprachbefehle
2. **TTS/STT HTTP-API** — `/tts` und `/transcribe` für den Telegram-Bot
3. **Musik/Radio-Player** — spielt Streams via mpv
4. **Timer-Service** — Countdown-Timer mit Alarm

Läuft nativ (kein Docker) weil MLX Whisper und pocket-tts die Apple-Silicon-GPU brauchen.

## Konfiguration (Konstanten)
- `WAKE_WORD` — "hey ribo"
- `AGENT_URL` — Adresse des pi-agent
- `LISTEN_SECONDS` — Aufnahme-Chunk-Länge zum Lauschen (1.5s)
- `COMMAND_SECONDS` — Maximale Befehlsdauer (30s)
- `SILENCE_THRESHOLD` / `SILENCE_DURATION` — Ab wann Stille erkannt wird
- `WHISPER_MODEL` — MLX Whisper Modell
- `TTS_VOICE` / `TTS_LANGUAGE` — pocket-tts Stimme
- `MUSIC_PORT` — HTTP-Port (8085)
- `RADIO_STATIONS` — Dictionary mit ~50 deutschen Radio-Streams

## Klassen

### `MusicPlayer`
Steuert mpv als Subprozess für Radio/Musik-Wiedergabe.
- `play(station_name, url)` — Sender abspielen (Fuzzy-Matching auf RADIO_STATIONS)
- `stop()` — Wiedergabe beenden
- `set_volume(volume)` — Lautstärke ändern (startet mpv neu)
- `status()` — Aktueller Zustand

### `AudioDucker`
Reduziert die Musiklautstärke während Ribo spricht (Ducking) und stellt sie danach wieder her. Wichtig damit man die Sprachantwort über der Musik hört.
- `duck()` — Lautstärke absenken (< 200ms)
- `restore()` — Lautstärke wiederherstellen
- Thread-sicher, behandelt auch den Fall dass Musik während des Sprechens stoppt

### `TimerEntry` / `TimerService`
Verwaltet Countdown-Timer.
- `create_timer(name, duration_seconds)` — Timer starten (max 10 gleichzeitig, 1s-24h)
- `cancel_timer(name)` — Timer abbrechen
- `list_timers()` — Aktive Timer mit Restzeit
- `_on_timer_expired()` — Bei Ablauf: Alarm abspielen (mit Ducking falls Musik läuft)
- `_play_alarm()` — Spielt alarm.wav oder einen generierten Sinus-Ton

## HTTP-API (`MusicAPIHandler`)

### GET-Endpoints
- `/music/status` — Player-Status
- `/music/stations` — Alle Sender
- `/timer/list` — Aktive Timer
- `/health` — Service-Status

### POST-Endpoints
- `/tts` — **Text → OGG-Audio** (via pocket-tts + ffmpeg-Konvertierung). Genutzt vom Telegram-Bot für Sprachantworten
- `/transcribe` — **Audio → Text** (via MLX Whisper). Genutzt vom Telegram-Bot für Sprachnachrichten
- `/music/play`, `/music/stop`, `/music/volume` — Musik steuern
- `/timer/create`, `/timer/cancel` — Timer verwalten
- `/tts/speak` — Text lokal am Mac-Lautsprecher aussprechen (mit Ducking)

## Kern-Funktionen

### `record_chunk(duration)` / `record_until_silence(max_duration)`
Nehmen Audio vom Mikrofon auf. `record_until_silence` stoppt automatisch wenn der Nutzer aufhört zu reden (Stille erkannt) oder das Maximum erreicht ist.

### `transcribe(audio)`
Wandelt aufgenommenes Audio in Text um via MLX Whisper (Metal-beschleunigt, deutsch).

### `send_to_agent(text)`
Schickt den erkannten Befehl an den pi-agent `/prompt` (mit Retry-Logik bei Verbindungsproblemen).

### `speak(text)` / `speak_with_ducking(text)`
Sprechen Text über den Lautsprecher via pocket-tts. Die Ducking-Variante senkt vorher die Musiklautstärke.

### `play_tone(frequency)`
Spielt einen kurzen Signalton (Feedback z.B. nach Wake-Word-Erkennung).

### `check_audio_device()` / `check_ffmpeg()`
Prüfen beim Start ob Mikrofon und ffmpeg verfügbar sind.

### `main()`
Der Hauptablauf:
1. Prüft Mikrofon + ffmpeg
2. Startet die Music/TTS HTTP-API (in einem Thread)
3. Endlosschleife: Lauscht auf "Hey Ribo" → nimmt den Befehl auf → transkribiert → an Agent → spricht die Antwort

## Wichtig zum Multi-User-Verhalten
hey-ribo.py schickt **keine** user_id an den Agent. Deshalb läuft alles was per Sprache kommt als Default-User "enrico". Wer am Mikrofon spricht, greift auf Enricos Daten zu. Das ist bewusst so (Familien-Haushalt-Gerät).
