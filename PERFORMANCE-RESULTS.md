# Ribo: Messungen und Verbesserungen vom 9. November 2026

## Ergebnis

Vier konkrete Änderungen sind umgesetzt:

1. Systemanweisungen von 21.515 auf 7.176 Bytes gekürzt; doppelte Anwendungsbeispiele
   entfernt, Funktions-, Datei-, Rechte- und Zustellregeln zusammengeführt.
   Vorherige Fassung: documentation/pi-agent/SYSTEM-before-performance-2026-11-09.md.
2. Optionaler Schnellmodus ohne Denkphase: Webauswahl „Schnell“, Telegram `/modus schnell`.
   `/modus normal` kehrt zum bisherigen low zurück; Bot-Neustart setzt Telegram zurück.
   Normal/low bleibt Standard. Bei schwierigen Aufgaben weiter gründlich denken lassen.
3. Gewohnheiten nach zurückgegebenen Werkzeugausführungen serverseitig protokollieren:
   nur Tool-Name und Zeitpunkt, höchstens 500 Einträge, atomar und mit Dateisperre.
   Kein eigener memory/log_interaction-Modellaufruf mehr nötig. Memory selbst, geworfene
   Fehler, isError-Ergebnisse und abgebrochene Ausführungen werden nicht automatisch geloggt.
   Legacy-Aufrufe von memory/log_interaction bleiben kompatibel. Ein Fehler im optionalen
   Protokoll darf keine bereits ausgeführte Aktion wiederholen oder als Fehler beantworten.
4. Zeitmessung umfasst nun Queue, Session, Denk-/Textbeginn, Tool-Zeiten und Modellrunden.
   Protokolle enthalten keine Inhalte, Nutzer-ID oder Tool-Argumente.

## Verifizierte Laufzeit

- Ollama API-Version: 0.40.13.
- Modell: qwen3.8-27b-64k:latest, 27.8B, safetensors, nvfp4, Runner mlx.
- Modell meldet thinking-Werte false, low, medium, xhigh; Standard medium.
  Der Agent setzt low. Der Schnellmodus sendet nachweislich false an die native API.
- Mac: Apple M5 Pro mit 48 GiB gemeinsamem Speicher. API/ps meldete Modellgröße
  26.93 GB (dezimal) und denselben size_vram-Wert, Kontext 65536.
- SDK 1.5.0, 24 Core-Tools im isolierten Benchmark; freigeschaltete Nutzerplugins
  können die Promptgröße im Alltag zusätzlich erhöhen.
- launchctl meldete keine gesetzten Overrides für Flash Attention, KV-Cache,
  Parallelität, maximale Modellanzahl, keep_alive und Kontext. Das beweist keine
  effektiven Serverdefaults: Prozess-/App-Konfiguration und Backend bleiben separat zu prüfen.
- Swap-Momentaufnahme unter Modelllast: 8.17 GiB von 9 GiB belegt. Vorherwerte fehlen;
  daraus folgt weder aktuelle starke Auslagerung noch ein durch Qwen verursachter Engpass.
  Als nächstes Speicher-/Swap-Veränderung beim gemeinsamen Chat-/Imagegen-Betrieb messen.

Keine Ollama-Serverflags, Modellgewichte, Quantisierung, Standardkontext oder
Modelfile geändert. Keine Pakete installiert, echten Telegram-Nachrichten oder Geräteaktionen ausgelöst.

## Reproduzierbare kleine Stichproben

Synthetische Frage „17 plus 25“, erwartete Antwort 42, je ein separater Erst-/Aufwärmlauf
und fünf gewertete Wiederholungen. Direkte API: Temperatur 0, Seed 42, max. 256 Tokens.
SDK: echte Anweisungen/24 Tools, normale Modellparameter, gleiche Frage mit
„keine Werkzeuge“, derselbe Nutzer mit fortgesetztem Verlauf. Daher sind direkte
API und SDK keine identischen Requests und ihre Differenz kein reiner SDK-Aufwand.

| Pfad / Konfiguration | Median Gesamtzeit | Richtige Antworten |
| --- | ---: | ---: |
| Direkte API, low, 64k | 962 ms | 5/5 |
| Direkte API, low, 32k | 936 ms | 5/5 |
| Direkte API, off, 64k | 168 ms | 5/5 |
| SDK, bisheriger Systemtext, low | 1210 ms | 5/5 |
| SDK, gekürzter Systemtext, low | 1034 ms | 5/5 |
| SDK, gekürzter Systemtext, off | 181 ms | 5/5 |

Das ist kein allgemeiner Geschwindigkeits- oder Qualitätsnachweis für reale Aufgaben.
Unterschiedliche Cachezustände, Verlauf und generierte Denktexte beeinflussen die Werte;
keine p95- oder allgemeine Prozent-Prognose aus diesen Stichproben ableiten.
Rohdaten ohne Prompts/Antworten: documentation/performance/2026-11-09/.

Im ersten bisherigen SDK-Prompt: 12071 Eingabetokens, davon 25.31 s Promptverarbeitung
und 0.374 s Sessionaufbau im beobachteten Lauf. Nach Kürzung: 7554 Eingabetokens
bei gleichem Tool-Satz, also rund 37 % weniger. Ein erster kompakter Lauf meldete
15.45 s Promptverarbeitung. Die danach ausgeführte saubere Wiederholung traf bereits
auf warmen Cache; ihre 1.575 s Erstaufruf sind kein fairer Kaltvergleich.
Eine zusätzliche kompakte Messreihe wurde wegen überlappender Modelltests nicht
in die Ergebnistabelle übernommen. Modell nicht für einen Kaltvergleich entladen.

Die SDK-Folgerunden benötigen im Test praktisch keinen Sessionaufbau mehr.
Ein Frameworkwechsel oder pauschales Deaktivieren der bestehenden Session-Wiederverwendung
ist durch diese Messungen nicht begründet. Der große Prompt war der klarere Ansatzpunkt.
Auch 32k statt 64k zeigt bei dieser kurzen Frage keinen ausreichenden Nutzen für eine Änderung.

## Bedeutung der neuen Messfelder

`prompt_duration` behält `ms` und `first_delta_ms` in ihrer bisherigen Bedeutung
(Zeit nach Queue-Freigabe; erstes Denk- oder Textdelta). Neu:

- total_ms: ab Eintritt in den Chat-Service einschließlich Queue; nicht HTTP-Upload/Auth
  oder die spätere Telegram-Zustellung/TTS.
- queue_ms und session_ms: Warteschlange bzw. sessions.get einschließlich Erstaufbau.
- first_thinking_ms und first_text_ms: getrennt ab Eintritt in den Chat-Service;
  null, wenn die entsprechende Ausgabe fehlt.
- tool_calls, model_rounds: beobachtete Tool-Starts und Assistant-Message-Starts.
- tool_ms: Summe abgeschlossener Tool-Zeiten; bei parallelen Tools keine reine Wandzeit.
- outcome: ok, error oder cancelled; request_id verknüpft eine Anfrage ohne Inhalte.

Vor Queue-Aufnahme abgewiesene Requests und HTTP-/Telegram-Ende-zu-Ende-Zeiten
sind damit noch nicht vollständig vermessen. Optionales Logging beeinflusst das Ergebnis nicht.

## Prüfung und Grenzen

- 38 Agent-, 12 Telegram- und 21 Python-Tests bestanden: insgesamt 71.
- Zusätzliche Regressionen für getrennte Zeiten/Queue, ausfallsicheres Logging,
  nutzergebundenes und begrenztes Gewohnheitenprotokoll sowie beschädigte Originaldateien.
- Echter API-/Qwen-Test: Text, geplanter Plugin-Aufruf mit abgefangener Zustellung,
  rote Testgrafik, Bild-Streaming und Anschlussfrage erfolgreich.
- Ein erster echter Modelllauf wählte den ausdrücklich verlangten send_message-Aufruf
  nicht (0 statt 1 Zustellungen). Zwei anschließende vollständige Läufe bestanden.
  Der Ablauf enthält nichtdeterministische Modellentscheidungen; die Ursache des
  ersten Ausreißers ist nicht bewiesen. Zustellmechanik und Schutz vor Doppelversand
  sind zusätzlich deterministisch getestet. Weitere Tool-Auswahl-Qualitätstests bleiben sinnvoll.
- Normalmodus und alle Werkzeuge bleiben vorhanden; die Kürzung der Anweisungen
  ist eine Verhaltensänderung und noch keine umfassende Prüfung jedes Alltagsszenarios.

## Nächste sinnvolle Arbeit

| Priorität | Verbesserung | Warum / nächster Schritt |
| --- | --- | --- |
| Hoch | Speicherbudget Qwen + Imagegen | Zeitreihen mit Swap/Memory Pressure, Modellhaltezeiten und Bildjob vergleichen |
| Hoch | Werkzeug-Qualitätssuite | Kalender, Listen, Lernkarten, Marker und geplante Aufträge mit simulierten Aktionen prüfen |
| Hoch | End-to-End-Zeiten | Telegram-Eingang bis Text/TTS sowie Upload und HTTP mit Anfragekennung verbinden |
| Mittel | Kontextbudget dynamisch | Systemtext, Tools, aktuellen Prompt, Bilder und Antwortreserve einbeziehen |
| Mittel | Langzeitgedächtnis im Verlauf | Wiederholte Beigaben untersuchen, Frische und Nutzertrennung erhalten |
| Mittel | Ausgabelimits vereinheitlichen | Im Benchmark sendet SDK kein num_predict; Modelfile setzt 16384, models.json 8192 |
| Mittel | Tool-Schemata verkleinern | Unveränderte 24 Tools kosten ca. 19k JSON-Zeichen; keine Rechte oder Funktionen entfernen |
| Mittel | Hintergrundaufgaben priorisieren | Wartezeit bei mehreren Nutzern und proaktiven Aufträgen messen |
| Mittel | TTS pro Nutzer wählbar | Unnötige Audioarbeit vermeiden; gewünschte Sprachausgabe erhalten |
| Mittel | Telegram-Textvorschau | Optional, gedrosselt und ohne doppelte Zustellungen |
| Später | Bildvorverarbeitung | Für Fotos Übertragung reduzieren, OCR-/Detailqualität dagegen prüfen |
| Später | Session-Lebensdauer | Nur mit Plan für Gesprächsfortsetzung und Messung des tatsächlichen Speicherbedarfs |
| Separat | Backups, Zustandsübersicht, geprüfte Updates | Weiterhin sinnvolle Betriebsverbesserungen aus PERFORMANCE-PLAN.md |

Flash-/KV-Cache-/Parallelitätsoptionen erst für den tatsächlichen MLX-Backend bestätigen.
Ollama-Speicherparameter nicht einfach dauerhaft erhöhen und nicht alle Modelle unbegrenzt laden.
Der vollständige ursprüngliche Kandidatenkatalog steht in PERFORMANCE-PLAN.md.

## Erneut messen

Direkte API, explizit modellladend, Ergebnisdatei darf noch nicht existieren:

```sh
python3 scripts/benchmark-ollama.py --output /private/tmp/ribo-ollama-new.json
python3 scripts/benchmark-ollama.py --contexts 65536 --thinking off --output /private/tmp/ribo-ollama-off-new.json
```

SDK-Harness scripts/benchmark-agent.mjs nur in einem Wegwerfcontainer mit tmpfs
/workspace ausführen. Testnutzer perflab, keine Produktiv-Workspace-Mounts oder Tokens.
Beispiel (Projektordner als aktuelles Verzeichnis):

```sh
docker run --rm --tmpfs /tmp --tmpfs /workspace:mode=1777 \
  -e RIBO_TEST_ISOLATED=1 \
  -e RIBO_INTERNAL_TOKEN=synthetic-test-token-0000000000000000000000 \
  -e RIBO_WEB_PASSWORD=synthetic-test-password-0000 \
  -e LLM_PROVIDER=ollama -e PI_MODEL=qwen3.8-27b-64k:latest \
  -e OLLAMA_HOST=http://host.docker.internal:11434 \
  -e OLLAMA_BASE_URL=http://host.docker.internal:11434 \
  -e OLLAMA_CONTEXT_LENGTH=65536 \
  -v "$PWD/scripts/benchmark-agent.mjs:/app/benchmark.mjs:ro" \
  --entrypoint node pi-agent-pi-agent:latest /app/benchmark.mjs
```

Modell-Benchmarks nacheinander ausführen; währenddessen keine parallelen Bild-/Modelltests.
Die Benchmark-Harnesses sind explizite Diagnoseprogramme und gehören nicht in die Offline-CI.
Die alte Systemdatei wird für einen Rückvergleich ausschließlich in einen isolierten
Testcontainer über dessen /home/node/.pi/agent/SYSTEM.md gemountet.

Offizielle Referenzen (9. November 2026):
[Ollama Chat API](https://docs.ollama.com/api/chat) für think und Zeit-/Tokenfelder;
[Ollama FAQ](https://docs.ollama.com/faq) für Speicher-, Kontext- und Serverparameter.
Lokal installierte SDK-Schnittstellen und Extension-Quellcode wurden direkt geprüft.

Fortsetzung: [Zweite Runde – Gedächtnis, Kontext und Bildspeicher](PERFORMANCE-ROUND2.md). Die oben genannten nächsten Schritte sind der Stand vor dieser Fortsetzung.

Weitere Fortsetzung: [Dritte Runde – Telegram, Alltagsabläufe und Modellplanung](PERFORMANCE-ROUND3.md).
