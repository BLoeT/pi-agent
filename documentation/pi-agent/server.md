# pi-agent/server.js — Entry-Point

Das Herzstück von Ribo. Ein Express-Server der:
- die Tools und Plugins lädt
- pro User eine LLM-Session verwaltet
- HTTP-Endpoints für Prompt (Text + Bild), Dateien, Reset bereitstellt
- den Web-Chat ausliefert

## Imports & Setup

```javascript
import express from "express";
import fs from "fs";
import path from "path";
import { AuthStorage, createAgentSession, ModelRegistry, SessionManager } from "@earendil-works/pi-coding-agent";
```

- **express** — HTTP-Server-Framework
- **@earendil-works/pi-coding-agent** — Die SDK die LLM-Sessions, Tool-Calling und Ollama-Kommunikation handelt
- Die Tools werden alle aus `./tools/` importiert, die Helfer aus `./lib/`

## Konstanten

- `LLM_PROVIDER` — Wählt das LLM-Backend: `ollama` (lokal, Default) oder `anthropic` (Claude API). Steuert Auth, Modell-Lookup und Vision.
- `DEFAULT_MODEL_BY_PROVIDER` — Provider-abhängiger Default-Modellname (Ollama: `qwen3.8:27b`, Anthropic: `claude-sonnet-5`), greift wenn `PI_MODEL` leer ist.
- `getModelRuntime()` — Lazy-Singleton, erstellt das `ModelRuntime` (Auth + Modell-Katalog aus `models.json`). Setzt bei `ollama` einen Dummy-Key, bei `anthropic` den `ANTHROPIC_API_KEY`.
- `coreTools` — Array aller 22 eingebauten Tools
- `MAX_MESSAGE_LENGTH` — Begrenzt Nachrichten auf 10.000 Zeichen (Schutz)
- `IMAGEGEN_SERVICE_URL` — Adresse des nativen Bildgenerierungs-Service

## Session-Management (Multi-User)

### `userSessions` (Map)
Speichert pro User-ID eine LLM-Session. Jeder User hat seinen eigenen Konversationsverlauf.

### `userLocks` (Map)
Pro User eine Promise-Kette. Verhindert dass zwei gleichzeitige Anfragen desselben Users kollidieren — aber unterschiedliche User blockieren sich nicht (laufen parallel).

### `getSessionForUser(userId)`
Kernfunktion. Wenn für den User noch keine Session existiert:
1. Lädt das konfigurierte Modell (`PI_MODEL`, default qwen3.8:27b)
2. Filtert Plugins nach Zugriffsrechten (`allowed_users`) — der User bekommt nur seine erlaubten Plugins
3. Baut die Session-Config (Arbeitsverzeichnis = User-Workspace, alle Tools)
4. Setzt optional `thinkingLevel` (Denk-Intensität, aus `THINKING_LEVEL` env)
5. Erstellt die Session via `createAgentSession()` und cached sie

Beim zweiten Aufruf wird die gecachte Session zurückgegeben.

### `acquireUserLock(userId)`
Gibt ein Promise zurück das erst auflöst wenn der User "an der Reihe" ist. Sorgt für serielle Verarbeitung pro User. Rückgabe: eine `release`-Funktion die nach der Anfrage aufgerufen werden muss.

## HTTP-Endpoints

### `GET /images/:filename`
Proxy für generierte Bilder. Der Web-Chat kann so Bilder anzeigen ohne CORS-Probleme. Holt das Bild vom imagegen-service (Port 8086) und reicht es durch. Sicherheit: nur `.png`-Dateinamen erlaubt.

### `GET /files/:userId/*`
Datei-Download. Liefert eine Datei aus dem Workspace eines Users. **Sicherheit:** Nutzt `path.relative()` um Path-Traversal zu verhindern — man kann nicht mit `../` aus dem User-Ordner ausbrechen.

### `GET /health`
Status-Check. Erstellt testweise eine Session und meldet ob das Modell erreichbar ist. Wird vom Docker-Healthcheck genutzt.

### `POST /prompt` (der wichtigste Endpoint)
Verarbeitet eine Nutzeranfrage (Text **und optional Bild**):
1. Liest `message`, `user_id` und optional `image_base64` aus dem Request
2. Prüft ob der User existiert (sonst 403)
3. Holt den User-Lock (serielle Verarbeitung)
4. Validiert die Nachricht (nicht leer, nicht zu lang)
5. Setzt den aktuellen User-Kontext (`setCurrentUser`)
6. **Kontext-Injection:** Hängt Persönlichkeit + Langzeitgedächtnis vor die Nachricht:
   - Wenn keine Persönlichkeit gesetzt → Hinweis dass Ribo danach fragen soll
   - Wenn Persönlichkeit vorhanden → Kommunikationsstil als Kontext
   - Letzte Session-Zusammenfassungen + bekannte Fakten aus dem Gedächtnis
7. Subscribed die Session-Events um die Antwort-Tokens zu sammeln
8. Ruft `session.prompt()` auf — bei vorhandenem `image_base64` wird das Bild als `images`-Option mitgegeben und direkt vom multimodalen Modell verarbeitet
9. Gibt die Antwort als JSON zurück
10. Gibt den Lock frei (`finally`)

> **Bilder (Vision):** Es gibt keinen separaten `/vision`-Endpoint mehr. Da sowohl das lokale Modell (qwen3.8:27b) als auch Claude multimodal sind, geht ein Bild direkt über `/prompt` (`image_base64`) an dieselbe Session — **ein** LLM-Call mit vollem Tool-/Session-/Gedächtnis-Kontext, statt vorher zwei (Bild→Text→Agent). Das Modell sieht das echte Bild, nicht nur eine Text-Beschreibung.

### `POST /reset`
Session-Reset. Mit `user_id` → resettet nur diesen User. Ohne → alle Sessions. Löscht den Gesprächsverlauf (nicht das Langzeitgedächtnis).

## Startup

```javascript
loadPlugins().then(plugins => {
  loadedPlugins = plugins;
  app.listen(8080, ...);
});
```

Beim Start werden zuerst die Plugins geladen (async), dann startet der Server auf Port 8080. Falls das Plugin-Laden fehlschlägt, startet der Server trotzdem (ohne Plugins).
