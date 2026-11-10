# Agent: Prozessstart und Anwendung

Die aktuelle Architektur steht in [ARCHITECTURE.md](../../ARCHITECTURE.md).

- `server.js`: Konfiguration, Plugin-Laden, Listener und Shutdown.
- `app.js`: separat konstruierbare Express-Anwendung mit Authentifizierung und Fehlergrenze.
- `http/chat-routes.js`: validierte Chat-/Cancel-/Reset-Anfragen.
- `http/respond.js`: SSE- und JSON-Antworten.
- `http/file-routes.js`: Downloads innerhalb des zulässigen Nutzer-Workspace.
- `services/chat.js`: Chat-Ablauf, aktive Anfragen und Abbruch.
- `services/request-queue.js`: begrenzte Warteschlange pro Nutzer.
- `services/sessions.js`: SDK-Lebensdauer und Tool-/Modell-Konfiguration.
- `services/response.js`: SDK-Ereignisse ohne HTTP-Abhängigkeit.

Die bisherigen Endpunkte `/prompt`, `/cancel`, `/reset`, `/files` und `/health` bleiben bestehen.
Sitzungen sind weiterhin im Arbeitsspeicher. Modell- und Nutzerzugriffe werden nicht bereits
bei einem Health-Aufruf initialisiert.
