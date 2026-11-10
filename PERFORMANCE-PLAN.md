# Vorbereitung: Ribo-Leistung und nächste Verbesserungen

Fortsetzung am 9. November: siehe PERFORMANCE-RESULTS.md für Messungen, vier umgesetzte Änderungen und verbleibende Prioritäten.

Stand: 8. November 2026. Vorbereitung durch Quellcodeprüfung, keine neuen Leistungsmessungen.
Keine Dienste neu gestartet, keine Modelle geladen, keine Pakete installiert und keine Nachrichten verschickt.
Dieser Plan ergänzt PERFORMANCE.md; dessen frühere Messungen sind keine neue Vergleichsbasis.

## Morgen hier anfangen

1. Aktive Ollama-Version, Modell-Metadaten/Quantisierung, GPU-Anteil, geladene Modelle,
   Speicher/Swap und tatsächlich wirksame Serverparameter erfassen. Keine vollständigen
   Umgebungen oder privaten Chatprotokolle exportieren.
2. Messung vom Eingang bis zur Antwort ergänzen: Warteschlange, Sitzungsaufbau,
   erstes Denkdelta, erstes Textdelta, Werkzeugzeit und Gesamtzeit getrennt.
3. Unveränderte Ausgangskonfiguration messen; dann genau einen Parameter pro Vergleich ändern.
4. Zuerst Kontextfenster und Speicher-Konkurrenz, danach Thinking und SDK-Aufwand untersuchen.
5. Nur Änderungen übernehmen, die Geschwindigkeit verbessern und die Qualitätsprüfung bestehen.

## Bereits belegter Ausgangsstand

| Bereich | Im Quellcode gefunden | Noch zu verifizieren |
| --- | --- | --- |
| Hardware | macOS meldet Apple M5 Pro, 48 GB gemeinsamen Speicher | Freier Speicher, Swap und Druck bei typischer Nutzung |
| Modell | Agent-Standard qwen3.8-27b-64k:latest, Thinking low | Laufend gewähltes Modell, Quantisierung, Modell-Digest |
| Kontext | Compose-Standard und Modelfile: 65536 | Persistierte Extension-Einstellung kann Vorrang haben; tatsächlicher Request |
| Ausgabe | Modelfile num_predict 16384; models.json maxTokens 8192 | Effektives Limit nach nativer Modellregistrierung und SDK-Request |
| Verlauf | trimHistory: 36000 geschätzte Tokens / 40 Nachrichten | Systemtext, Tools, aktueller Prompt und Bildanteil zusätzlich berücksichtigen |
| SDK | @earendil-works/pi-coding-agent 1.5.0 fest gepinnt | Tatsächliches Verhalten dieser installierten Version; kein blindes Update |
| Sessions | Eine laufende Session je Nutzer; Runtime wiederverwendet | Erster Aufbau vs. Folgerunden, langfristiger Speicherbedarf |
| Tools | Explizites Register, Ergebnisse auf 24000 Zeichen begrenzt | Schemakosten und tatsächliche Zahl der Modellrunden pro Aufgabe |
| Imagegen | Wiederverwendung optional; Worker-Idle standardmäßig 60 s | Aktive Einstellung und Speicher zusammen mit Ollama |
| Telegram | Agent-Antwort wird abgewartet, dann Text, dann optional TTS | Zeit bis sichtbarer Nachricht und Einfluss paralleler Anfragen |

Quellen im Projekt: pi-agent/config.js, settings.json, models.json, services/chat.js,
services/sessions.js, services/response.js, services/prompt-context.js, lib/context.js,
pi-telegram/handlers.js, messenger.js, docker-compose.yaml,
imagegen-service/service_config.py und model_worker.py.
Modelfile: /Users/enricostarke/Desktop/qwen/Modelfile.
Defaults sind keine Bestätigung der laufenden Konfiguration; Secrets wurden nicht in diese Liste übernommen.

## Priorisierte Verbesserungsliste

Alle Einträge sind Prüfkandidaten, keine zugesicherten Geschwindigkeitsgewinne.
Aufwand: klein = lokal begrenzte Änderung; mittel = mehrere Komponenten/Messreihen;
hoch = eigener Umbau mit umfassender Qualitätsprüfung.

| Rang | Verbesserung | Nutzen / Messkriterium | Aufwand | Grenze oder Nachteil |
| --- | --- | --- | --- | --- |
| 1 | Vollständige Zeitmessung mit Anfragekennung | Engpass zuordnen statt vermuten | klein | Keine Prompts, Bilder oder Tokenschlüssel protokollieren |
| 2 | Kontext 64k mit 32k vergleichen, 16k nur für kurze Aufgaben | Zeit bis Text, Prefill und Speicher vergleichen | mittel | Verlaufbudget/Systemtext/Tools/Antwortreserve müssen zum Fenster passen |
| 3 | Speicherstrategie für Qwen und Flux2 gemeinsam festlegen | Weniger Nachladen und Swap, stabilere Reaktionszeiten | mittel | Dauerhaftes Laden aller Modelle kann schaden |
| 4 | Wirksames Flash Attention / KV-Cache-Format prüfen | Speicherbedarf und Text-/Bildqualität vergleichen | mittel | Modell-, Backend- und Versionsunterstützung zuerst prüfen |
| 5 | Thinking low gegen unterstützten geringeren Modus vergleichen | Denkzeit und Aufgabenqualität | mittel | Extension kann Stufen umsetzen/begrenzen; off ist nicht garantiert wirksam |
| 6 | Ausgabegrenzen konsistent festlegen | Ausreißer und versehentlich sehr lange Antworten begrenzen | klein | Kürzeres Maximum beschleunigt keine bereits kurzen Antworten |
| 7 | SDK-Erstaufbau und Extension-Warmup messen | Schnellere erste Anfrage, weniger doppelte Initialisierung | mittel | ResourceLoader enthält nutzerspezifische Ressourcen; nicht blind gemeinsam nutzen |
| 8 | Systemprompt und Toolschemas verkleinern | Weniger Eingabetokens bei gleicher Funktion | mittel | Auswahl von Tools darf Fähigkeiten und Rechte nicht unbeabsichtigt ändern |
| 9 | Wiederholte Gedächtnis-/Stilbeigaben im Verlauf prüfen | Weniger redundanter Kontext | mittel | Frische Fakten, Nutzertrennung und Cache-Invalidierung erhalten |
| 10 | Ollama-Parallelität und Warteverhalten abstimmen | Interaktiver Chat bleibt bei Hintergrundaufgaben reaktionsfähig | mittel | Mehr parallele Slots sind nicht automatisch schneller und brauchen Speicher |
| 11 | Telegram optional mit gedrosselter Textvorschau | Früher sichtbare Antwort | mittel | API-Limits, Entwürfe, Abbruch und keine doppelten Nachrichten berücksichtigen |
| 12 | TTS pro Nutzer einstellbar machen | Weniger unnötige Audioarbeit | klein | Nutzerentscheidung; keine automatische Abschaltung gewünschter Sprachantworten |
| 13 | Bildgröße vor Analyse bedarfsgerecht reduzieren | Weniger Übertragung und Vision-Arbeit | mittel | Kleine Schrift/Details können verloren gehen; Original erhalten |
| 14 | Sessions bei langer Inaktivität begrenzen | Planbarer Node-Speicher bei vielen Nutzern | mittel | Gesprächsfortsetzung muss erhalten oder klar erkennbar sein |
| 15 | Sicherung und Wiederherstellung praktisch prüfen | Schutz vor Datenverlust | mittel | Verschlüsselung und keine ungeschützten Secrets in Git |
| 16 | Einheitliche Zustandsübersicht und Log-Aufbewahrung | Fehler schneller erkennen; begrenzter Plattenverbrauch | mittel | Keine privaten Inhalte in Diagnoseansichten |
| 17 | Regelmäßige geprüfte Abhängigkeitsaktualisierung | Wartbarkeit und Sicherheitskorrekturen | mittel | Keine ungeprüften Auto-Updates oder neue Pakete nur für Messungen |

## Konkrete Messlücken im aktuellen Code

- services/chat.js setzt started erst NACH queue.acquire: Warteschlangenzeit fehlt.
- services/response.js meldet onFirstDelta beim ersten Denk- ODER Textdelta.
  first_delta_ms ist damit keine verlässliche Zeit bis zur ersten sichtbaren Textantwort.
- prompt_duration umfasst Sitzungsaufbau und Generierung zusammen; Tool-Runden und
  Ollama-Ladezeit lassen sich daraus nicht getrennt erklären.
- trimHistory schätzt nur die vorhandenen Nachrichten. Ein kleineres num_ctx ohne
  angepasstes Gesamtbudget kann neue Überläufe erzeugen.
- preparePrompt hängt pro Runde bis zu zehn Fakten und den Kommunikationsstil an.
  Prüfen, wie oft diese Beigaben im SDK-Verlauf erneut gespeichert werden.

## Vergleichsplan

Synthetische Texte und Bilder, isolierte Testnutzer und separates Ergebnisverzeichnis verwenden.
Keine echten Telegram-Nachrichten und keine Geräteaktionen. Tool-Aufgaben mit simulierten Werkzeugen.
Eine synthetische Grafik mit großer und kleiner Beschriftung dient als Vision-Qualitätsprobe.

| Fall | Zweck | Qualitätsbedingung |
| --- | --- | --- |
| Kurze deutsche Frage, kurze Antwort | Alltag und erster Text | Korrekt, verständlich, keine internen Denktexte |
| Drei Folgerunden mit Bezug | Verlauf und Wiederverwendung | Vorherige Angaben korrekt behalten |
| Langer synthetischer Kontext mit Kontrollfakten | Prefill, Kürzung, Kontextfenster | Abgefragte Fakten korrekt; Kürzung nachvollziehbar |
| Eine simulierte Werkzeugabfrage | SDK- und Tool-Runden | Genau erforderliche Aufrufe, keine erfundenen Ergebnisse |
| Synthetisches Bild mit Beschriftung | Vision-Zeit und Qualität | Große Schrift und vereinbarte Details korrekt |
| Zwei Nutzer plus Hintergrundauftrag | Queue und Fairness | Nutzertrennung, keine doppelten Zustellungen |
| Chat zusammen mit kleiner Bilderzeugung | Gemeinsamer Speicher | Keine Fehler, keine starke Swap-Zunahme, Abbruch bleibt nutzbar |

Warmer Vergleich: ein markierter Aufwärmlauf, dann fünf Wiederholungen je Kandidat.
Kaltes Laden separat messen; kein Modell auf dem laufenden System nur für eine Messung ungefragt entladen.
Identische Prompts, Ausgabelimits, Seed falls unterstützt und gleiche Testreihenfolge verwenden.
Thinking- und Antworttokens getrennt zählen. Median und Spannweite angeben;
bei fünf Läufen keine belastbaren p95-Aussagen ableiten. Modellwechsel und Hardwarelast festhalten.

Ergebnisfelder: Testfall, Konfiguration/Modell-Digest, Datum, warm/kalt,
Queue-ms, Session-ms, erstes-Denken-ms, erster-Text-ms, Gesamt-ms,
Ollama load/prompt_eval/eval-Dauer und Tokenzahlen soweit verfügbar,
Tool-Aufrufe/Modellrunden, Speicher/Swap und Qualitätsurteil.
Unterschied zwischen direkter Ollama-Anfrage und SDK nicht pauschal als SDK-Aufwand werten:
Systemtext, Tools, Verlauf und Modelloptionen müssen dafür vergleichbar sein.

## Fertig, wenn

- Eine Ausgangsmessung und nachvollziehbare Vorher/Nachher-Vergleiche vorliegen.
- Empfohlene Änderungen Nutzen, Nachteil und Rückweg enthalten.
- Übernommene Änderungen die vorhandenen Prüfungen bestehen (make verify).
- Laufende Dienste nach einem nötigen Neustart gesund sind.
- Unbewiesene oder aufwendige Ideen als spätere Optionen dokumentiert bleiben.

## Offizielle Referenz für morgen

Ollama FAQ: https://docs.ollama.com/faq (am 8. November 2026 konsultiert).
Enthält GPU-Prüfung, Serverkonfiguration, Modell-Ladezeit/keep_alive,
Parallelität, Flash Attention und KV-Cache-Optionen. Die Unterstützung im tatsächlich
installierten Ollama und im gewählten Qwen-Modell muss lokal bestätigt werden.
Die Agent-Containerumgebung konfiguriert nicht automatisch den nativen Ollama-Server.
