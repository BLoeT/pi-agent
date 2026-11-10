# pi-agent/tools/ — Alle Tools

Jedes Tool ist eine eigene Datei in `tools/`. Ein Tool wird mit `defineTool()` erstellt und hat: `name`, `label`, `description`, `parameters` (TypeBox-Schema) und `execute` (die Logik). Das LLM sieht die Beschreibung + Parameter und entscheidet wann es das Tool aufruft.

Fast alle Tools rufen am Anfang `checkPermission("toolname")` auf — fehlt die Berechtigung, geben sie eine Fehlermeldung zurück. Ausnahmen: `personality` und `memory` (System-Tools, immer verfügbar).

Rückgabeformat aller Tools:
```javascript
{ content: [{ type: "text", text: JSON.stringify({...}) }], details: {} }
```

---

## homeassistant.js — Smart Home
Steuert Geräte über die ha-service Bridge. Permission: `smart_home`.
- `call_service` — Gerät steuern (z.B. Licht an: domain=light, service=turn_on, entity_id=light.wohnzimmer)
- `get_states` — Status aller/eines Geräts abfragen
- `get_services` — Verfügbare Services auflisten

Ruft intern den `ha-service` (Port 8082) auf.

## music.js — Musik/Radio
Steuert die Wiedergabe über hey-ribo.py (Port 8085). Permission: `music`.
- `play` — Sender/Stream abspielen
- `stop` — Wiedergabe stoppen
- `volume` — Lautstärke (0-100)
- `status` — Was läuft gerade?

## timer.js — Timer
Verwaltet Countdown-Timer über hey-ribo.py. Permission: `timer`.
- `create` — Timer erstellen (name, duration_seconds)
- `cancel` — Timer abbrechen
- `list` — Aktive Timer anzeigen

## weather.js — Wetter
Fragt Wetterdaten über die Open-Meteo API ab. Permission: `weather`.
- `current` — Aktuelles Wetter
- `forecast` — Vorhersage für einen Tag (heute/morgen/Wochentag)
- Optional `location` — Ortsname wird via Geocoding aufgelöst (weather-helpers.js)

## news.js — Nachrichten
Liest RSS-Feeds (konfiguriert über `NEWS_FEEDS`). Permission: `news`.
- `headlines` — Aktuelle Schlagzeilen (optional pro Quelle)
- `list_sources` — Verfügbare Quellen
Nutzt `rss-parser` mit Timeout pro Feed.

## notes.js — Notizen
Persönliche Notizen (JSON-Datei pro User). Permission: `notes`.
- `add` — Notiz speichern (max 500 Zeichen)
- `list` — Notizen anzeigen (max 20)
- `delete` — Notiz per Suchbegriff löschen
- `delete_all` — Alle löschen

## calendar.js — Kalender + Erinnerungen
Termine im ICS-Format. Permission: `calendar`.
- `today` — Heutige Termine (persönlich + Gruppen)
- `day` — Termine an einem Tag
- `add` — Termin erstellen, mit optionalen `reminders` (z.B. "1440,60" = 1 Tag + 1h vorher → VALARM)
- `delete` — Termin per Suchbegriff löschen
- `edit` — Hinweis: löschen + neu anlegen

Datums-/Zeit-Parsing über helpers.js. Erinnerungen werden vom pi-telegram Reminder-Service ausgewertet und als Push verschickt.

## routines.js — Routinen
Verwaltet und führt Aktionssequenzen aus (aus `workspace/routines.yaml`). Permission: `routines`.
- `run` — Routine ausführen (z.B. "Gute Nacht" → mehrere HA/Musik/TTS-Aktionen)
- `list` — Verfügbare Routinen
- `create` — Neue Routine anlegen/überschreiben (`routine_name` + `actions`-Array). Schreibt in `routines.yaml`. Validiert jede Action.
- `delete` — Routine löschen (`routine_name`)
Jede Aktion kann Typ `ha` (domain/service/entity_id/data), `music` (action play/stop/volume + station/volume) oder `tts` (text) haben.
Zeitsteuerung erfolgt NICHT hier, sondern über proaktive Regeln (pi-telegram) mit prompt "führe Routine X aus".

## capabilities.js — Funktionsübersicht
Listet auf, welche Funktionen der aktuelle Nutzer nutzen darf — gefiltert nach seinen Permissions plus für ihn freigegebene Plugins. Keine Permission (jeder darf fragen).
- keine Parameter; genutzt bei "Was kannst du?" / "Was hast du für Funktionen?"

## lists.js — Listen
Einkaufslisten, ToDos etc. Permission: `lists`.
- `create_list`, `rename_list`, `delete_list`
- `add_item` (mit optionaler Menge), `update_item`, `remove_item`
- `show_list`, `show_all_lists`

Geteilte Listen (z.B. Einkaufsliste der Familie) werden automatisch im Gruppen-Ordner gespeichert (via getListPath in helpers.js).

## weekplanner.js — Wochenplanung
Kombinierte Übersicht der Woche. Permission: `weekplanner`.
- `overview` — Termine der nächsten 7 Tage + offene Listen
Liest den Kalender (node-ical) und fasst zusammen.

## search.js — Web-Suche
Sucht im Internet via Tavily API. Permission: `search`.
- `query` — Suchbegriff → Antwort + Quellen
Braucht `TAVILY_API_KEY`, sonst deaktiviert.

## imagegen.js — Bildgenerierung
Generiert Bilder via imagegen-service (FLUX). Permission: `imagegen`.
- `prompt` — Englische Bildbeschreibung
- `model` — "schnell" (4 Steps) oder "dev" (20 Steps)
- `source_image` + `strength` — img2img (bestehendes Bild bearbeiten)

Kopiert das generierte Bild in den User-Ordner, gibt einen `[FILE:...]`-Marker zurück für den Telegram/Web-Versand.

## flashcards.js — Lernkarten (Spaced Repetition)
Vokabel-/Fakten-Lernen mit SM-2 Algorithmus. Permission: `flashcards`.
- `create_deck`, `add_card`, `generate_cards` (mit Duplikat-Filter)
- `study` — fällige Karte abfragen (40% Chance umgekehrte Richtung)
- `answer` — Bewertung → Level hoch/runter, nächste Review berechnet
- `stats`, `list_decks`

Level-Intervalle: 0, 1, 3, 7, 14, 30, 60 Tage.

## cooking.js — Kochassistent
Rezeptsuche + Einkaufsliste. Permission: `cooking`.
- `search_recipe` — Rezept via Tavily suchen
- `add_ingredients` — Zutaten auf eine Liste setzen (Duplikat-Erkennung)

## expenses.js — Ausgaben-Tracker
Ausgaben erfassen und auswerten. Permission: `expenses`.
- `add` — Ausgabe (Betrag, Kategorie, Shop, Datum)
- `list` — Monats-Auflistung
- `summary` — nach Kategorie gruppiert
- `delete`, `categories`

Speichert pro Monat: `expenses/YYYY-MM.json`. 14 vordefinierte Kategorien.

## personality.js — Persönlichkeit (System-Tool, keine Permission)
Speichert den Kommunikationsstil pro User in users.json.
- `get` — aktuelle Persönlichkeit lesen
- `set` — Persönlichkeit speichern

Beim ersten Kontakt fragt Ribo automatisch danach (gesteuert über den Kontext im /prompt-Endpoint).

## memory.js — Langzeitgedächtnis (System-Tool, keine Permission)
Speichert Fakten, Präferenzen und Gesprächs-Zusammenfassungen pro User.
- `remember` — Fakt speichern (mit Kategorie: preference, fact, interest, ...)
- `recall` — Erinnerungen abrufen (optional gefiltert)
- `forget` — per Stichwort löschen
- `forget_all` — alles vergessen
- `summarize_session` — Gespräch zusammenfassen (max 5 Summaries)
- `log_interaction` — Tool-Nutzung loggen (für Gewohnheiten-Analyse)

Speichert in `memory/long_term.json` + `memory/habits_log.json`.

## files.js — Dateien senden/löschen
Zugriff auf den eigenen Workspace. Permission: `files`.
- `list` — Dateien auflisten (optional gefiltert)
- `send` — Datei via Telegram/Chat schicken (gibt `[FILE:...]`-Marker)
- `delete` — Datei löschen

**Sicherheit:** `safeResolve()` verhindert Path-Traversal mit `path.relative()` — kein Ausbruch aus dem User-Workspace möglich.

## projects.js — Code-Projekte
Erstellt beliebige Code-Projekte (JS, Python, Java, ...). Permission: `projects`.
- `write_file` — Datei in einem Projekt schreiben
- `read_file`, `list`, `delete_file`
- `zip` — Projekt als ZIP packen (via `archiver`) und schicken (gibt `[FILE:...]`-Marker)

Generisch für Code-Projekte (jede Sprache, freie Struktur). Speichert in `projects/<name>/`.

## admin.js — User-Verwaltung
Nutzer verwalten. Permission: `admin` (nur Enrico).
- `add_user` — Neuen Nutzer anlegen
- `remove_user` — Nutzer löschen (nicht sich selbst)
- `edit_user` — Name, Chat-ID, Permissions, Gruppen ändern
- `list_users` — Alle Nutzer anzeigen

Schreibt direkt in users.json (via saveUsersConfig).

## develop.js — Plugin-Entwicklung
Ribo erweitert sich selbst. Permission: `admin` (nur Enrico).
- `create_plugin` — Neues Plugin schreiben (optional mit `allowed_users`)
- `edit_plugin`, `delete_plugin`
- `list_plugins` — mit Zugriffsinfo
- `show_template` — Plugin-Vorlage anzeigen
- `grant_access` / `revoke_access` — Plugin-Zugriff pro User steuern

Plugins werden erst nach Neustart aktiv (`docker compose restart pi-agent`).
