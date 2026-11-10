# Dritte Runde: Alltagsabläufe, Telegram und Modellplanung

9. November 2026. Fortsetzung von PERFORMANCE-ROUND2.md.

## Was sich für Nutzer ändert

| Einstellung | Wirkung |
| --- | --- |
| /audio an | Kurze Antworten zusätzlich als Sprachnachricht, wie bisher |
| /audio aus | Nur Text/Dateien als Antwort; eingehende Sprachnachrichten werden weiter verstanden |
| /vorschau an | Temporärer Antwortentwurf während der Erzeugung, nur im privaten Telegram-Chat |
| /vorschau aus | Nur die fertige Antwort anzeigen |
| /audio oder /vorschau | Aktuellen Zustand anzeigen |

Audio und Vorschau sind standardmäßig an. Einstellungen werden pro Nutzer atomar unter
workspace/users/<nutzer>/telegram-settings.json gespeichert; /reset und Neustarts ändern
sie nicht. Fremde/unberechtigte Chats dürfen sie nicht ändern. Die Datei enthält keine
Zugangsdaten. Beschädigte Einstellungen werden nicht still überschrieben.

Die Vorschau verwendet die bereits im installierten Paket vorhandene Telegram-Methode
sendMessageDraft. Der erste Entwurf wird frühestens nach 600 ms gesendet; Updates sind
auf höchstens eines je 1200 ms und nur eine gleichzeitig laufende Anfrage begrenzt.
Kurze Antworten benötigen dadurch normalerweise keinen Entwurf. Entwürfe sind temporär;
die vollständige Antwort wird über den bestehenden Versand einmal dauerhaft zugestellt.
Lange Antworten bleiben eine einzelne Textdatei; Anhänge und optionale Audioantworten
bleiben getrennte, angeforderte Bestandteile. Geplante Nachrichten bekommen keine Vorschau.

Nur Textdeltas werden gezeigt: keine Denkphase, Werkzeugargumente/-ergebnisse oder
Dateimarker. Bei nicht unterstützter Methode, Netzfehler oder Ratenlimit wird die Vorschau
für diese Antwort aufgegeben; die endgültige Antwort bleibt unabhängig davon möglich.
Offene Updates werden vor der finalen Nachricht beendet, Timer bei Abschluss/Fehler entfernt.
Telegram-Entwürfe laufen serverseitig nach kurzer Zeit aus. Der genaue Darstellungseffekt
hängt auch vom Telegram-Client ab; es wurden keine echten Chats für Vorschautests benutzt.

## Durchgängige Zeitmessung

Jede verarbeitete Telegram-Text-, Bild- oder Sprachanfrage erhält eine zufällige UUID.
Sie wird als X-Request-ID zum Agenten geschickt. Nur authentifizierte interne Dienste
dürfen eine gültige UUID übernehmen; Browser können die Log-Kennung nicht vorgeben.
Das ist keine neue Authentifizierung und gibt keine zusätzlichen Rechte.

telegram_duration enthält je nach tatsächlich durchlaufenen Phasen:

- incoming_age_ms: Abstand vom Telegram-Nachrichtendatum zum lokalen Handler-Eingang,
  nur eine grobe Sekundenauflösung und abhängig von Uhrabweichungen.
- download_ms, stt_ms: Download und Spracherkennung bei Foto-/Audioeingaben.
- agent_ms und first_text_delta_ms: gesamter Agent-Aufruf und erstes empfangenes Textdelta.
- first_visible_ms: erste bestätigte Entwurf- oder finale Textzustellung.
- text_sent_ms: Bestätigung der finalen Text-/Dateinachricht.
- attachment_download_ms: Downloads von Datei-/Bildanhängen.
- tts_ms und voice_sent_ms: Spracherzeugung und bestätigter Versand der Sprachantwort.
- total_ms und outcome: Handler-Gesamtdauer und Ergebnis.

Das sind lokale Zeitpunkte und API-Bestätigungen, keine Messung, wann der Nutzer die
Nachricht auf seinem Bildschirm tatsächlich gelesen oder gehört hat. Nicht durchlaufene
Phasen fehlen. Keine Nachrichteninhalte, Chat-/Nutzer-IDs, Audiodaten oder Bilder in diesen
Messmeldungen. Optionale Messprotokolle dürfen die Antwort nicht scheitern lassen.

Der Agent ergänzt http_duration vom HTTP-Middleware-Eingang bis zum Response-Finish;
damit werden unter anderem Body-Empfang, Validierung und Agent-Wartezeit sichtbar.
Gesundheits-/Datei-/Webanfragen können ebenfalls solche Messmeldungen erzeugen.
Die vorhandenen prompt_duration-Felder bleiben für Queue, Session, Denk-/Textbeginn
und Tool-Arbeit erhalten. Kennungen verbinden die Phasen über beide Dienste.

Die neuen Messungen sind bereit für echte Nutzung. Telegram-Netzlaufzeiten wurden
absichtlich nicht durch unaufgeforderte Testnachrichten an reale Nutzer ermittelt.

## Antwortlimits und Denkstufen

RIBO_MAX_OUTPUT_TOKENS setzt standardmäßig 8192 erzeugte Tokens je Modellaufruf.
Der gemeinsame ModelRuntime reicht dieses Limit ausdrücklich weiter; beim nativen
Ollama-Pfad erscheint es als options.num_predict. Ein kleineres SDK-/Modelllimit wird
beibehalten, negative/ungültige Anbieterlimits können die Grenze nicht umgehen.
Die bestehenden Warmup-Aufrufe benötigen weiter nur ein Token.

Es geht um Tokens je Modellschritt, nicht um eine feste Wortzahl oder ein Gesamtbudget
für alle Werkzeugrunden. Bei denkenden Modellen kann auch die Denkphase dieses Budget
verbrauchen. Kurze fertige Antworten werden durch ein kleineres Maximum nicht automatisch
schneller; der Nutzen liegt im Begrenzen langer Ausreißer. Bei tatsächlichem stopReason
length wird das Erreichen des Antwortlimits sichtbar gemeldet, statt still eine scheinbar
vollständige Antwort auszuliefern. Kein automatisches Wiederholen ausgeführter Aktionen.

Das Kontextbudget reserviert nun das kleinere tatsächliche Ausgabe-Limit statt pauschal
das größere Modellmaximum. Modelfile, Gewichte und globale Ollama-Einstellungen bleiben
unverändert. Das Laufzeitlimit muss über die Agent-Konfiguration geändert werden.

Denkmodi für das aktuelle Qwen:

| Oberfläche | Angeforderte Stufe |
| --- | --- |
| Schnell | off / Ollama think:false |
| Normal | low |
| Gründlich | medium |
| Sehr gründlich bzw. maximal | xhigh |

Qwen meldet medium, aber keine high-Stufe. Vorher konnte die SDK-Klemmung high auf xhigh
anheben. Neue Web-/Telegramauswahlen verwenden daher medium für Gründlich; ältere
Clients mit high werden weiterhin akzeptiert. Normal bleibt Standard. Telegram-Moduswahl
bleibt wie bisher bis zum Bot-Neustart gültig; Audio/Vorschau werden dagegen dauerhaft gespeichert.

## Hintergrundaufgaben und Wartezeiten

RequestQueue verwendet ausdrückliche Wartelisten statt nur Promise-Ketten. Normale
Nachrichten gehen vor wartenden Hintergrundaufträgen; nach drei Vordergrundfreigaben
bekommt eine wartende Hintergrundaufgabe ihren Platz, damit sie nicht dauerhaft verhungert.
FIFO bleibt innerhalb gleicher Priorität erhalten. Abgebrochene wartende Anfragen werden
sofort entfernt und geben ihre Kapazität frei. Shutdown lehnt wartende Arbeit sofort ab.

Dies gilt pro Nutzersitzung und zusätzlich am gemeinsamen Modellzugang. Letzterer lässt
jeweils eine Modellrunde laufen. Nach ihrem Ende kann ein normaler Chat vor einem
wartenden geplanten Auftrag drankommen. Während ein Tool auf Bild-/Geräte-/Dateiarbeit
wartet, hält es diese globale Modellfreigabe nicht fest. Tool-Aktionen werden dafür weder
wiederholt noch mitten in ihrer Ausführung unterbrochen. Die bestehenden SDK-Stream- und
Authentifizierungsfunktionen bleiben erhalten; die Kapselung erfolgt am gemeinsamen Runtime.

Eine bereits laufende Modellrunde oder ein laufender Auftrag derselben Nutzersitzung
wird nicht präemptiert. Daher ist das keine Garantie für sofortige Antworten während
langer eigener Aufgaben. Modellwartezeit wird mit model_queue_duration protokolliert.

## Gefundener Kalenderfehler

Kalendertermine konnten mit vollständigem Datum angelegt werden, die Tagesabfrage
verwendete jedoch einen Resolver für relative Wettertage und verstand das Datum nicht.
Im echten Modelltest fragte Qwen wiederholt erfolglos nach dem Tag und änderte nichts.
Das betraf auch den Normalmodus, also keine reine Schwäche des Schnellmodus.

Die Kalenderabfrage verwendet jetzt dieselbe Datumsverarbeitung wie Anlage/Bearbeitung.
TT.MM.JJJJ und streng geprüftes YYYY-MM-DD werden unterstützt. day ist klar als
Abfragedatum beschrieben; date wird bei einer Tagesabfrage zusätzlich als kompatibler
Fallback akzeptiert. Ein Test verschiebt einen Termin anhand seiner UID und prüft, dass
UID, Zielzeit und der zweite, unveränderte Termin erhalten bleiben. Ungültige Daten wie
2030-02-30 werden zurückgewiesen.

## Prüfungen und Modellqualität

Die Offline-Suite umfasst Alltagsabläufe für Kalender, Listenkorrekturen, Lernkarten,
Dateimarker, echte Reminder-Zeitpunkte und einmalige geplante Zustellung. Zusätzliche
Tests decken Stream-Chunking/UTF-8, Abbruch, Vorrang/Fairness, fehlerhafte Streams,
Antwortlimits, Vorschau-Timer, Rechte, gespeicherte Einstellungen und vollständige
simulierte Telegram-Verarbeitung mit gemeinsamer Anfragekennung ab.

scripts/evaluate-tools.mjs ist eine explizite echte Qwen-Prüfung in einem Wegwerfcontainer.
Sie verwendet neue Testnutzer und tmpfs /workspace. Erlaubte lokale Tools arbeiten auf
Testdateien; Geräte-, Web-, Audio-, Bild- und sonstige externe Tools sind durch Sperr-Stubs
ersetzt. Globale fetch-Aufrufe sind auf den lokalen Ollama-Endpunkt begrenzt; keine
Bot-Tokens oder Produktiv-Workspace-Mounts. Geplantes send_message landet nur im Outbox-Test.

Sieben Fälle werden je in off und low geprüft: Liste anlegen/korrigieren, ausgewählten
Termin verschieben, Grundwissen speichern/korrigieren/vergessen, Lernkarte stellen und
Antwort verbuchen, Dateimarker erhalten, Erinnerung wirklich terminieren und geplanten
Inhalt einmal zur Zustellung übergeben. Es werden Zustandsänderungen geprüft, nicht nur
sprachliche Erfolgsmeldungen. Alle 14 Fälle der abschließenden Reihe bestanden, sieben im Schnell- und sieben im
Normalmodus. Rohdaten: documentation/performance/2026-11-09/tool-eval-after.json.
Erfasste echte Ollama-Requests tragen num_predict:8192 (Warmup:1).
Zusätzlich bestanden 97 Offline-Tests: 55 Agent, 20 Telegram und 22 Python.

Die erste Reihe vor der Kalenderkorrektur hatte zwei echte Kalenderfehler und einen
fehlerhaften Lernkarten-Test: Dieser antwortete unabhängig von der zufälligen Abfragerichtung
immer mit Gracias. Der Test folgt nun der tatsächlich gestellten Frage. Vergleichsdaten
liegen unter documentation/performance/2026-11-09/tool-eval-before-calendar-fix.json.
Ein erfolgreicher Durchlauf ist eine Stichprobe, keine Garantie für jede Formulierung.

## Erneut prüfen

make verify führt die isolierten Offline-Prüfungen aus. Echte Modellprüfungen gehören
nicht zur normalen Offline-CI. `make evaluate-tools` startet die isolierte echte Tool-Prüfung nach einem Build. Alternativ den vorhandenen Wegwerfcontainer-Aufruf
für SDK-Tests verwenden, scripts/evaluate-tools.mjs nach /app/evaluate-tools.mjs mounten
und zusätzlich RIBO_TOOL_EVAL=1 setzen. /workspace muss tmpfs sein; keine echten Tokens.
Optional filtern RIBO_EVAL_MODES=off,low und RIBO_EVAL_CASES=<Fallname> die Läufe.

Offizielle Referenzen:
[Telegram sendMessageDraft](https://core.telegram.org/bots/api#sendmessagedraft),
[Ollama Chat API](https://docs.ollama.com/api/chat).
Die vorhandenen Paket-Schnittstellen wurden zusätzlich im installierten Code geprüft.
Keine neuen Pakete installiert.

## Lokal aktiviert

Agent und Telegram nach Abschluss der Prüfungen neu erstellt und gestartet. Agent gesund,
beide Dienste mit Bereitschaftsmeldung und ohne Neustartschleife; keine Start- oder
Plugin-Ladefehler beobachtet. Browser-Anmeldung, verweigerter fremder Dateipfad sowie
authentifizierte Audio-/Bildschnittstellen erneut geprüft. Der echte HTTP-/Qwen-Test mit
Text, abgefangener geplanter Zustellung, Bildanalyse, Bild-Streaming und Anschlussfrage
bestand ebenfalls. Änderungen nur lokal; keine Commits, Pushes oder PRs erstellt.
