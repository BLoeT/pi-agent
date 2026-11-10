# Modellwechsel ohne Stack-Neustart

Stand: 9. November 2026.

## Bedienung

Im Webchat steht in der Seitenleiste **Modell wechseln**. Die Auswahl zeigt die
verfügbaren Modelle mit Bildverständnis, Werkzeugunterstützung und Kontextgröße.
**Modell verwenden** schaltet auf das ausgewählte Modell um. Nach dem Update die
Webseite einmal neu laden.

In Telegram:

- `/modell`: aktuelles Modell und verfügbare Modelle anzeigen.
- `/modell aktualisieren`: Liste neu von Ollama einlesen.
- `/modell qwen3.8:27b-mlx`: auf den exakten Modellnamen wechseln.
- `/modell qwen3.8-27b-64k:latest`: auf diese Qwen-Variante wechseln.

Neue Modelle zuerst selbst in Ollama installieren. Danach reicht **Aktualisieren**
bzw. `/modell aktualisieren`; kein Image-Neubau und kein Dienstneustart nötig.
Die erste Antwort eines kalten Modells kann wegen des Ladens länger dauern.
Der Wechsel installiert, lädt aus dem Internet oder löscht keine Modelle.

## Welche Modelle angeboten werden

Die Liste stammt aus Ollamas `/api/tags` mit Metadaten aus `/api/show`, über den
bereits vorhandenen nativen pi-ollama-Adapter. Reine Embedding-/Bildgeneratoren
werden ausgeschlossen, wenn Ollama deren Fähigkeiten entsprechend ausweist.
Bei älteren Ollama-Versionen ohne explizite Fähigkeiten verwendet der vorhandene
Adapter konservative Ableitungen; nicht lesbare Metadaten liefern einen Eintrag
mit konservativen Fähigkeiten. Die Liste wird höchstens 30 Sekunden zwischengespeichert;
**Aktualisieren** und ein Wechsel fragen Ollama ausdrücklich neu ab.

Nur der konfigurierte Anbieter wird angeboten. Im aktuellen Setup ist dies Ollama.
Bei konfiguriertem Anthropic-Anbieter verwendet die Liste den vorhandenen SDK-Katalog.
Es gibt keine vom Browser übergebbaren Serveradressen oder API-Schlüssel.

Referenz: [Ollama API](https://github.com/ollama/ollama/blob/main/docs/api.md).

## Verlauf, Nutzer und Fähigkeiten

Die Auswahl gilt pro Nutzer gemeinsam für Web und Telegram. Sie wird privat (0600)
in `workspace/users/<Nutzer>/model-preference.json` gespeichert. Andere Nutzer behalten
ihre Auswahl. Ohne gespeicherte Auswahl gilt weiterhin `PI_MODEL` bzw. der bisherige
anbieterabhängige Standard. `/reset` behält die Auswahl bei; ein Dienstneustart ebenfalls.

Das SDK wechselt mit `session.setModel`, ohne die bestehende Sitzung zu verwerfen.
Der Chatverlauf bleibt beim Modellwechsel erhalten; das gespeicherte Gedächtnis und
Dateien bleiben erhalten. Ein normaler Dienstneustart persistiert weiterhin keinen
vollständigen Chatverlauf – die Modellauswahl ist davon unabhängig.

Während einer laufenden oder wartenden Antwort wird ein Wechsel mit 409 verweigert;
zuerst abwarten oder stoppen. Ein während des Wechsels eintreffender Prompt wartet in
derselben Nutzerwarteschlange. Der Wechsel beeinflusst keine bereits laufende Antwort
eines anderen Nutzers.

Textmodelle erhalten keine neuen Bildanfragen: Der Server meldet dies vor dem Speichern
des Uploads. Ohne Werkzeugunterstützung werden die aktiven Werkzeuge für diese Sitzung
deaktiviert und beim Zurückwechseln wiederhergestellt. Die vorhandenen Rechteprüfungen
bleiben erhalten. Der gewünschte Denkmodus wird vom SDK an die Modellfähigkeiten angepasst.

Die Kontextgröße überschreitet weder die gemeldete Modellgrenze noch das konfigurierte
Ollama-Kontextlimit. Das maximale Antwortlimit ist zusätzlich auf ein Viertel des
wirksamen Kontexts begrenzt (und weiterhin durch das globale Antwortlimit gedeckelt),
damit kleinere Modelle Platz für Eingabe und Werkzeuge behalten. Bei langen Verläufen
greift die vorhandene Kontextkürzung; ein kleineres Modell kann deshalb ältere Details
nicht mehr im vollständigen Kontext haben.

Ein nicht verfügbares gewähltes Modell erzeugt einen klaren Fehler, keinen stillen
Wechsel. Die Liste bleibt zur Wiederherstellung erreichbar. Fehlgeschlagene Auswahl
oder Speicherung lässt die bisherige gespeicherte Auswahl bestehen; beschädigte Dateien
werden nicht überschrieben.

## Umsetzung und Prüfungen

- `services/model-catalog.js`: native Ollama-Erkennung und sichere SDK-Registrierung;
  verwendet den bereits installierten TypeScript-Loader des SDK, keine neue Abhängigkeit.
- `services/model-selection.js`: private Nutzerpräferenz und SDK-Wechsel.
- `services/sessions.js`: laufende Sitzungen und Auswahl; `services/chat.js`: gemeinsame
  Nutzerwarteschlange, Wechselsperre und Bildfähigkeitsprüfung.
- `http/model-routes.js`: authentifizierte Endpunkte `/models`, `/models/list`, `/model`.
- Webdialog und Telegram-Transport/Handler verwenden denselben serverseitigen Zustand.

113 isolierte Tests bestanden (66 Agent, 25 Telegram, 22 Python). Neue Tests prüfen
HTTP-Authentifizierung/Ursprung, fremde Nutzer, neue/entfernte Modelle, echte SDK-Verträge
mit simuliertem Ollama, Verlaufserhalt, tatsächliche native Modell-ID und Kontextgrenzen,
Text-/Werkzeugfähigkeiten, private Persistenz sowie Rennen mit laufenden Antworten.

Zusätzlich: opt-in echter lokaler Ollama-/SDK-Test zwischen `qwen3.8-27b-64k:latest` und
`qwen3.8:27b-mlx`, mit leerem wegwerfbaren Workspace, ohne Werkzeuge und ohne Telegram-
Nachrichten. Die neue Variante beantwortete eine Rückfrage zur zuvor genannten Testzahl.
Die Testpräferenz wurde anschließend auf den Ausgangswert zurückgestellt.
Skript: `scripts/verify-model-switch.mjs`, nur mit den beiden expliziten Testfreigabe-
Umgebungsvariablen und einem isolierten Workspace starten.

Webdialog mit synthetischen Daten im Browser geprüft: Fähigkeiten, Auswahl,
Übernehmen und anschließend korrekt angezeigte aktive Auswahl. Vorschau-Testserver beendet.

Aktiviert: Agent und Telegram wurden einmalig für dieses Update neu erstellt. Die
laufende authentifizierte Modellliste antwortet mit HTTP 200 und den drei tatsächlich
installierten Chatmodellen. Die bestehende Standard-/Nutzerauswahl wurde nicht verändert.
