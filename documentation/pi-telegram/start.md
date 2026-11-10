# Telegram: Prozessstart und Bausteine

Die aktuelle Architektur steht in [ARCHITECTURE.md](../../ARCHITECTURE.md).

`start.js` setzt nur den Prozess zusammen. `handlers.js` behandelt eingehende Nachrichten;
`client.js` übernimmt interne HTTP-/Dateianfragen, `messenger.js` Texte, Anhänge und optionale
Sprachantworten. `users.js` liest Nutzerzuordnungen; `inbox.js` legt Fotos sicher ab.

`scheduler.js` registriert die Zeitpläne. Fachliche Zustandsänderungen liegen getrennt in
`jobs/reminders.js` und `jobs/proactive.js`. Versandreservierungen und gemeinsame Dateien
verwenden dieselben Hilfen aus `shared/` wie der Agent. Der bekannte Doppelversand aus
Tool-Ausgabe und anschließender Zusammenfassung bleibt unterbunden.

Beim Beenden werden die Zeitpläne gestoppt und offene Client-Anfragen abgebrochen. Tests
verwenden injizierte Bot-/Transportobjekte; es werden keine echten Telegram-Nachrichten gesendet.

## Fortsetzung vom 9. November

`/audio an|aus` und `/vorschau an|aus` speichern Telegram-Präferenzen pro Nutzer. Private Chats können temporäre Entwürfe zeigen; fertige Antworten werden weiterhin einmal zugestellt. `trace.js` verbindet Eingangs-, Agent-, Text- und Audiozeiten über eine UUID. `stream.js` liest nur geprüfte SSE-Textdeltas, `preview.js` drosselt Entwürfe. Einzelheiten und Grenzen: [PERFORMANCE-ROUND3.md](../../PERFORMANCE-ROUND3.md).
