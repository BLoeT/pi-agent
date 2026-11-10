# Ribo: Sicherheitskonfiguration

Die lokalen Sicherheitskorrekturen vom 8. November 2026 sind im Projekt umgesetzt.
Es wurden keine Commits, Pushes oder Pull Requests erstellt.

## Zugang

- Der Browser meldet sich mit `RIBO_WEB_USER` und `RIBO_WEB_PASSWORD` an. Die
  generierten Zugangsdaten stehen lokal in `.ribo-browser-access.txt`.
- HTTP Basic ist ohne HTTPS keine Transportverschlüsselung. Der Web-Chat ist für
  das vertrauenswürdige Heimnetz bestimmt; keine Router-Portweiterleitung verwenden.
- Telegram, Sprachdienst, Bilddienst und HA-Bridge verwenden einen getrennten
  internen Bearer-Token. Dieser Token darf nicht an Browser oder fremde Hosts gelangen.
- Die Browseridentität wird serverseitig festgelegt. Downloads und Resets sind auf
  diesen Nutzer begrenzt; beliebige vom Client übermittelte Nutzerkennungen genügen nicht.

## Dateien, Nutzer und Plugins

Tools erhalten einen asynchron isolierten Nutzerkontext. Pfade werden gegen den
jeweiligen Workspace geprüft, einschließlich bestehender und ungültiger Symlinks.
Listen-/Dateinamen dürfen keine Verzeichniswechsel enthalten.

Plugins mit fehlenden, ungültigen oder leeren Zugriffslisten werden nicht geladen.
Die vorhandenen Plugins sind auf den Administrator begrenzt; auch bei der Ausführung
wird geprüft. Das Datei-Leseplugin bleibt innerhalb des eigenen Workspace.
LLM-gesteuertes Ändern von Plugins ist standardmäßig gesperrt. Plugins werden nicht
in einer Prozess-Sandbox ausgeführt und müssen deshalb weiterhin manuell geprüft werden.

## Abhängigkeiten

Die eigenen Node-Dienste verwenden eingecheckte Manifeste und Lockfiles,
`npm ci --ignore-scripts`, eine Altersschwelle von fünf Tagen und einen per Digest
festgelegten Basis-Image-Stand. npm/npx sind aus den Laufzeit-Images entfernt.
Die Ollama-Erweiterung verwendet denselben Runtime-Paketbestand wie der Agent.
Updates erfolgen bewusst über einen neuen Build, nicht während des Betriebs.

Die drei eigenen Services laufen mit der Host-Nutzerkennung, ohne zusätzliche
Linux-Capabilities und mit `no-new-privileges`. Das Root-Dateisystem ist noch nicht
vollständig schreibgeschützt. Ein kompromittiertes Laufzeitpaket kann weiterhin die
dem jeweiligen Prozess zugänglichen Daten und Umgebungsvariablen gefährden.

## Regressionstests

Tests dürfen nicht auf dem produktiven Workspace laufen. Die Node-Tests verlangen
`RIBO_TEST_ISOLATED=1` und verwenden im folgenden Aufruf ausschließlich tmpfs-Daten:

```bash
docker run --rm --network none --read-only \
  --tmpfs /tmp --tmpfs /workspace:mode=1777 \
  -e RIBO_TEST_ISOLATED=1 --entrypoint node \
  pi-agent-pi-agent:latest --test \
  /app/tests/security.test.mjs /app/tests/api.integration.test.mjs \
  /app/tests/context.test.mjs /app/tests/tools-regression.test.mjs

python3 -m unittest discover -s tests
```

Der optionale lokale Modelltest in der API-Testsuite prüft zusätzlich Text,
Bildanalyse mit einem künstlichen roten Testbild und einen anschließenden Textturn.
Er benötigt absichtlich Netzwerkzugriff zum lokalen Ollama und einen beschreibbaren,
wegwerfbaren Container für SDK-Konfigurationen. Er darf keine produktiven Datenmounts
oder echten Dienst-/Telegram-Zugangsdaten bekommen.

## Beibehaltener Smart-Home-Aufbau

Home Assistant, govee2mqtt und Mosquitto bleiben auf ausdrücklichen Nutzerwunsch
erhalten; es wird keine VM eingerichtet. Die getesteten Leuchten H6004 und H6046
antworten lokal vom Mac. Die Multicast-Suche im Docker-Host-Netz blieb erfolglos.
Direkte Anfragen lieferten Antworten, deren ursprüngliche Absenderadressen jedoch
durch Docker ersetzt wurden. Die Bibliothek benötigt diese für Statuszuordnungen.
Die Direktanbindung wurde deshalb nicht als stabil übernommen.

MQTT verwendet eine Passwortanmeldung und eine ausdrückliche ACL;
anonyme Verbindungen werden abgewiesen. Home Assistant und Govee wurden gemeinsam
auf die neuen Zugangsdaten umgestellt. Die ACL erlaubt diesem einen Stack-Nutzer
derzeit alle Topics; sie trennt nicht einzelne Geräte. Port 1883 und Govees HTTP-API
8056 sind auf den Mac begrenzt. Vor einer weiteren Netzwerkfreigabe ist die Konfiguration
erneut zu prüfen. MQTT-Passwortdatei und Laufzeitdaten sind von Git ausgeschlossen.

Vor den Home-Assistant-/Open-WebUI-Updates wurden die angehaltenen Datenvolumes
vollständig archiviert. Die Archive enthalten private Daten und gehören nicht in Git.
Ein Zurücksetzen der Anwendungsversion erfordert gegebenenfalls auch das Wiederherstellen
des passenden Datenstands; die Datenbanken wurden durch Hersteller-Migrationen aktualisiert.

## Stand der Sicherheitsprüfungen

Der Agent-Paketbestand meldete nach den Updates keine bekannten npm-Schwachstellen;
238 Laufzeitpakete hatten geprüfte Registry-Signaturen. Das ist kein Malwarefreiheitsbeweis.

Der abschließende Grype-Scan der drei eigenen Images meldete keine High-/Critical-Treffer,
aber jeweils drei Medium-Matches derselben BusyBox-Meldung CVE-2025-60876 für drei
Alpine-Paketnamen. Grype nennt dafür aktuell keinen verfügbaren Fix. Die aktualisierten
Hersteller-Images von Home Assistant, Open WebUI und Mosquitto haben weitere gemeldete
Schwachstellen; sie sind nicht pauschal als sicher oder vollständig bereinigt bewertet.

## Tool-Korrekturen und gemeinsame Daten

Siehe `TOOL_FIXES.md`. Gemeinsame JSON-Änderungen verwenden eine Dateisperre und atomaren
Dateiersatz; beschädigte Dateien bleiben erhalten. Der ZIP-Export prüft auch seinen
Ausgabepfad. Gepflegte Plugin-Implementierungen liegen im versionierten Agent-Code.
Geplante Zustellungen reservieren ihren Versandstatus vor der Ausführung; die bekannten
Doppelversandwege über Tool und abschließende Antwort werden gebündelt.
