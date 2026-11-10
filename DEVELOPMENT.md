# Entwicklung

Die aktuelle Architektur und die Zuständigkeiten stehen in [ARCHITECTURE.md](ARCHITECTURE.md).

1. Änderungen lokal an einem zusammengehörigen Baustein durchführen.
2. `make verify` ausführen: Build, Syntax und Offline-Regressionstests.
3. Für Änderungen am Modellpfad zusätzlich den lokalen API-/Qwen-Test mit künstlichem Workspace ausführen.
4. Für native Generierung zusätzlich den lokalen GPU- und Abbruchtest prüfen.
5. Erst danach betroffene Dienste neu starten und deren Health/Startmeldungen kontrollieren.

Die gemeinsamen Codeordner sind Teil beider Compose-Builds. Änderungen in `shared/` erfordern
also einen Build beider Node-Dienste. Neue Pakete werden nicht während des Betriebs installiert.
Für Stil und Zeilenenden gelten `.editorconfig` und `.gitattributes`.

Produktive Zugangsdaten, `.env`, Nutzerdaten und lokale Logs werden nicht eingecheckt. Die
versionierten Standard-Plugins liegen unter `pi-agent/plugins/`; lokale Importdateien und
Freigaben bleiben im Workspace. Keine Tests gegen produktive Dateien oder echte Telegram-
Empfänger ausführen. Commits und Pushes bleiben der lokalen Arbeitsweise des Nutzers überlassen.
