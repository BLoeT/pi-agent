# Ribo: Laufzeitverbesserungen vom 8. November 2026

Fortsetzung: [Messungen und Änderungen vom 9. November](PERFORMANCE-RESULTS.md). Die Werte unten gehören zur früheren Prüfung.

## Umgesetzt

- Denkstandard `low` in lokaler Umgebung, Compose und SDK-Konfiguration vereinheitlicht.
  Webchat: Normal, Gründlich, Sehr gründlich. Telegram: `/modus normal`,
  `/modus gruendlich`, `/modus maximal` (bis zum Bot-Neustart).
- Text und Bilder verwenden dieselbe native Ollama-/SDK-Session, Streaming,
  Werkzeuge und Abbruchfunktion. Der separate Vision-Aufruf und seine manuell
  zusammengesetzten Nachrichten entfallen. Das bestehende 64k-Modell bleibt erhalten.
- Kontext wird zusätzlich zur Nachrichtenanzahl anhand einer konservativen
  Tokenschätzung begrenzt. Schnitt nur an User-Runden; Werkzeugaufruf und Ergebnis
  bleiben zusammen. Text eines Werkzeugergebnisses: insgesamt maximal 24.000 Zeichen.
- Audio-Code in `ribo_audio.py`; `hey-ribo.py` bleibt kompatibler Startpunkt.
  Unbenutzter Mikrofon-/Wake-Word-Code entfernt. TTS-Modell bleibt geladen.
  Begrenzte HTTP-Parallelität, eine Modellarbeit zur Zeit, begrenzte Warteschlange
  für lokale Sprachausgabe. Musik, Timer und Status müssen nicht auf TTS/STT warten.
  Temporäre Audiodateien werden bei Verarbeitungsfehlern aufgeräumt.
- Telegram-Scheduler in `pi-telegram/scheduler.js`, Überlappungsschutz in
  `background.js`. Fehlgeschlagene Erinnerungen/proaktive Sendungen werden nicht
  mehr als erfolgreich gespeichert; gemeinsamer Versandstatus wird zusammengeführt.
  Anfrage-Zeitgeber werden auch nach Verbindungsfehlern aufgeräumt.
- Flux2-Textbilder: eigener wiederverwendbarer Modellprozess, maximal ein Modell.
  Modellwechsel beendet alten Prozess. Nach 60 Sekunden Leerlauf beendet sich der
  Worker und gibt seinen Metal-Speicher frei. Andere Engines, Bildbearbeitung und
  Video behalten ihre CLI-Aufrufe. Bild/Video bleiben untereinander serialisiert.
  Statusabfragen sind parallel möglich; zusätzliche Generierungsaufträge erhalten 503.
- Neue Laufzeitmessungen für Chat, Audio und Generierung. Chat erfasst auch die
  Zeit bis zum ersten Text-/Denkdelta. Diese Messmeldungen enthalten keine Prompts.
- Keine zusätzlichen Pakete für diese Verbesserungen installiert.

## Messungen am lokalen Mac

Identischer synthetischer Prompt/Seed, Flux2 Klein 4B, 8 Bit, 256×256, vier Schritte:

| Test | Erster Aufruf | Weiterer Aufruf mit geladenem Modell |
| --- | ---: | ---: |
| Direkter Worker | 7,29 s | 1,54 s |
| Laufende HTTP-Schnittstelle | 3,63 s | 1,51 s |

Kleine Stichprobe, keine belastbare Prozentangabe und keine Prognose für 1024px oder
andere Engines. TTS über HTTP: gültiges OGG, 17.723 Bytes in 0,52 s bei kurzem Testtext.
Imagegen-Status während Generierung: etwa 1 ms. Paralleler zweiter Auftrag: 503.
TTS→STT-Rundlauf: erfolgreiche Transkription des synthetischen Testtexts; STT 3,84 s.

## Prüfung

- 14 Node-Tests für Agent, API, Sicherheitsgrenzen und Kontextbehandlung bestanden.
- 3 Telegram-Tests mit simuliertem Bot bestanden (keine Testnachricht verschickt).
- 10 Python-Tests für Sicherheitsgrenzen, HTTP-Parallelität, Warteschlangen,
  Audio-Fehlerbereinigung und Worker-Wiederverwendung/-Zeitlimit bestanden.
- Zusätzlich echter lokaler Qwen-Test: Text, Bildanalyse, Bild-SSE und Text danach bestanden.
- Audio- und Bilddienst sowie Agent und Telegram neu gestartet; geschützte APIs erreichbar.
  Agent gesund, Telegram-Start bestätigt, beide Container ohne Neustartschleife.
- Browser-Anmeldung und Schutz gegen Dateipfad-Ausbruch erneut geprüft.

## Grenzen und Rückfalloption

`IMAGEGEN_REUSE_MODEL=0` in `.env` und Neustart des Bilddienstes schalten Flux2 wieder
auf den bisherigen CLI-Aufruf pro Bild. Der neue Worker hält Speicher bis zum Idle-
Zeitlimit; parallele Qwen-Nutzung kann diesen Speicher ebenfalls benötigen. Das Limit
ist bewusst kurz. Automatische Entladung des Chat-Modells wurde nicht eingeführt.

Die Kontextschätzung ersetzt keinen modellgenauen Tokenizer. Ein einzelner zu großer
letzter Gesprächsschritt bleibt der Kontextbehandlung des SDK überlassen. Sessions
bleiben im Arbeitsspeicher; Neustarts verwerfen den laufenden Gesprächsverlauf.
Langzeitgedächtnis und Nutzerdaten werden davon unabhängig auf Dateien gespeichert.

Das Modelfile unter `~/Desktop/qwen` wurde bei diesen Laufzeitänderungen nicht geändert.
