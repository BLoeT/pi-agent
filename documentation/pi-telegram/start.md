# pi-telegram/start.js — Telegram-Bot

Der Telegram-Bot ist ein eigenständiger Service der Nachrichten empfängt, an den pi-agent weiterleitet und Antworten zurückschickt. Zusätzlich läuft hier der Reminder-Service (Kalender-Erinnerungen) und die Gewohnheiten-Analyse.

> **Library:** `node-telegram-bot-api` **v2** (2.x). v2 ist ein kompletter Rewrite (grammY-artige API): `new Bot(token)`, Middleware-Handler mit `ctx`, alle API-Calls über `bot.api.<methode>({ ... })`, Uploads über `InputFile`, Polling über `run(bot)` aus dem `/node`-Subpfad. Die alte v1-/0.x-API (`bot.sendMessage(chatId, text)`) existiert nicht mehr.

## Setup & Auth

### Konfiguration
- `TELEGRAM_BOT_TOKEN` — Bot-Token von @BotFather
- `AGENT_URL` — Adresse des pi-agent
- `RIBO_URL` — Adresse von hey-ribo.py (für TTS/STT)

### Multi-User Auth (basiert auf users.json)
- `loadUsersConfig()` — Liest die User-Config aus dem gemounteten workspace
- `getUserByChatId(chatId)` — Ordnet eine Telegram-Chat-ID einem User zu
- `getAllowedChatIds()` — Alle konfigurierten Chat-IDs
- `isAuthorized(chatId)` — Prüft ob eine Chat-ID freigeschaltet ist
- `getUserIdForChat(chatId)` — Gibt die User-ID für eine Chat-ID zurück

## Kommunikation mit dem Agent

### `sendToAgent(message, userId, imageBase64?)`
Schickt eine Nachricht an den pi-agent `/prompt` mit der User-ID. Optional wird ein Bild (`imageBase64`) mitgeschickt — das multimodale Modell verarbeitet es dann direkt (ein Aufruf, mit Tools/Session/Gedächtnis). Nutzt `fetchWithRetry` (2 Versuche, 120s Timeout).

### `textToSpeech(text)`
Ruft hey-ribo `/tts` auf → bekommt eine OGG-Audiodatei zurück (für Sprachantworten).

### `transcribeAudio(audioBuffer)`
Ruft hey-ribo `/transcribe` auf → wandelt eine Sprachnachricht in Text um.

### `downloadTelegramFile(fileId)`
Lädt eine Datei (Foto, Sprachnachricht) von den Telegram-Servern herunter. v2: ermittelt den `file_path` über `bot.api.getFile({ file_id })` und lädt dann von `https://api.telegram.org/file/bot<token>/<file_path>`.

### `sendResponseWithVoice(chatId, text, replyToMessageId)`
Zentrale Antwort-Funktion:
1. Erkennt Marker in der Antwort:
   - Generiertes Bild → holt es und sendet als Foto (`bot.api.sendPhoto` mit `InputFile`)
   - `[FILE:...]`-Marker → holt die Datei und sendet sie als Dokument (`bot.api.sendDocument` mit `InputFile`)
2. Sendet den Text (ohne Marker) via `bot.api.sendMessage`
3. Versucht eine Sprachnachricht (TTS) zu senden (falls Text < 1000 Zeichen, `bot.api.sendVoice` mit `InputFile`)

Uploads laufen direkt aus dem Speicher über `new InputFile(bytes, { filename })` — keine temporären Dateien mehr. Antwort-Bezug über `reply_parameters: { message_id }`.

## Nachrichten-Handler

`bot.on("message", async (ctx) => …)` verarbeitet eingehende Nachrichten. Zugriff über den Context: `ctx.chat.id`, `ctx.message` (Text/Voice/Photo/Caption), `ctx.from`. Ablauf:
1. `/id` — Zeigt die Chat-ID (funktioniert vor Auth, für Setup)
2. Auth-Check — nicht autorisierte Chats werden abgewiesen
3. User ermitteln
4. `/start` — Begrüßung
5. `/reset` — Session zurücksetzen (frischer Kontext)
6. **Sprachnachricht** → transkribieren → an Agent → Antwort mit Voice
7. **Foto** → Bild + Prompt in einem Aufruf an den Agent (`sendToAgent` mit `imageBase64`); das multimodale Modell sieht das Bild direkt und schlägt Aktionen vor → Antwort
8. **Text** → Gewohnheits-Bestätigung prüfen → sonst an Agent

## Reminder-Service (Background-Loop)

Prüft alle 2 Minuten alle Kalender auf fällige Erinnerungen.

### `extractRemindersFromIcs(icsContent)`
Parst eine ICS-Datei und extrahiert alle VALARM-Erinnerungen mit ihrem Auslöse-Zeitpunkt (Event-Zeit minus Trigger-Dauer).

### `parseIcsDtstart(line)` / `parseTriggerMinutes(trigger)`
Hilfsfunktionen zum Parsen von ICS-Datumsangaben und VALARM-Trigger-Dauern (`-P1D`, `-PT1H` etc.).

### `checkReminders()`
Für jeden User: liest alle Kalender (persönlich + geteilt), findet Erinnerungen die im aktuellen 3-Minuten-Fenster fällig sind, und sendet sie als Telegram-Nachricht. Ein `reminder_sent.json` verhindert Doppel-Versand (Aufräumen nach 2 Tagen).

## Proaktive Nachrichten & Gewohnheiten

### `loadProactiveRules()` / `saveProactiveRules()`
Verwalten die Regeln in `proactive_rules.json` (welche Nachricht wann automatisch geschickt wird).

### `executeProactiveRule(rule, user)`
Führt eine Regel aus: schickt den Prompt der Regel an den Agent und das Ergebnis an den User.

### `checkProactiveRules()`
Läuft alle 5 Minuten. Prüft ob eine Regel fällig ist (Wochentag + Uhrzeit passen, noch nicht heute gesendet) und führt sie aus.

### `analyzeHabits()`
Läuft einmal täglich. Analysiert das `habits_log.json` jedes Users: findet Muster (gleiche Tool-Nutzung, gleicher Wochentag, gleiche Stunde, 3+ mal). Schlägt dem User via Telegram vor die Aktion zu automatisieren ("Du fragst montags oft nach dem Wetter — soll ich das automatisch schicken?").

### `checkHabitConfirmation(userId, text)`
Fängt "Ja"/"Nein"-Antworten auf Gewohnheits-Vorschläge ab. Bei "Ja" wird die Regel aktiviert, bei "Nein" abgelehnt (und gemerkt, damit nicht erneut vorgeschlagen).

## Bootstrap & Fehlerbehandlung (v2)

- Bot-Instanz: `const bot = new Bot(TELEGRAM_BOT_TOKEN)`
- Fehler-Boundary: `bot.catch((err) => …)` fängt Handler-Fehler ab (ersetzt das alte `polling_error`-Event)
- Start: `run(bot)` (aus `node-telegram-bot-api/node`) startet das Long-Polling und verdrahtet Ctrl-C mit `bot.stop()`
- Die Background-Loops (Reminder, Proaktiv, Gewohnheiten) senden über `bot.api.sendMessage({ chat_id, text })`
