# Zweite Runde: Gedächtnis, Kontext und Bildspeicher

9. November 2026. Ergänzt PERFORMANCE-RESULTS.md.

## Gedächtnis bleibt über Sessions hinweg erhalten

Alle Erinnerungen liegen weiterhin im jeweiligen Nutzer-Workspace unter
memory/long_term.json. Es wurde keine Produktivdatei migriert, gelöscht oder nach
vermeintlicher Wichtigkeit umsortiert. Alte Array- und {facts:[...]}-Formate werden gelesen.

Neu sind zwei Ebenen:

- Festes Grundwissen: ausdrücklich mit core:true gespeichert oder mit pin markiert.
  Höchstens 20 Fakten und zusammen 12000 Zeichen; alle werden unabhängig von ihrem
  Alter bei jeder Anfrage berücksichtigt. Name, Sprache, Haushalt, wichtige Vorlieben
  und Technik sind typische Kandidaten; keine automatische Deutung alter Texte.
- Weitere Erinnerungen: dauerhaft gespeichert, passend zur Frage mit einfacher lokaler
  Wortsuche ausgewählt (maximal fünf zusätzliche Treffer) oder mit memory/recall abrufbar.
  Keine Vektordatenbank, Embeddings, externen Dienste oder zusätzlichen Pakete.

Solange noch kein Grundwissen festgelegt wurde, werden zur Kompatibilität bis zu zehn
letzte unmarkierte Einträge außerhalb von Session-Zusammenfassungen mitgegeben. Erstes
explizites Grundwissen ersetzt diesen Übergangsmodus. Bestehende andere Einträge bleiben
durchsuchbar. Auch unpin löscht nichts, kann aber einen Eintrag wieder als passenden
Suchtreffer liefern. Einfacher Wortabgleich versteht nicht alle Synonyme; bei unklaren
Bezügen muss Ribo gezielt nachlesen/nachfragen und darf keine Erinnerung erfinden.

memory unterstützt remember/core, recall, profile, update/id, pin/id, unpin/id,
forget/id oder Suchtext, forget_all und die bisherigen Zusammenfassungen/Log-Aufrufe.
Gleicher normalisierter Text wird nicht doppelt angelegt. Korrekturen ersetzen den
bestehenden Eintrag über seine ID. Schreibvorgänge sind gesperrt und atomar.
Normale Fakten werden beim Überschreiten der früheren 100 Einträge nicht mehr still
entfernt: Die neue Obergrenze ist 2000, danach wird eine bewusste Bereinigung verlangt.
Automatische Session-Zusammenfassungen behalten die bisherige Begrenzung auf fünf;
als Grundwissen markierte Zusammenfassungen werden davon ausgenommen.

Beispiele für Ribo:

- „Merke dir als Grundwissen: Mein Hauptrechner ist ein Windows-PC.“
- „Was hast du als Grundwissen über mich gespeichert?“
- „Aktualisiere meinen Hauptrechner: Ich nutze jetzt …“
- „Nimm diese Information aus dem Grundwissen, behalte sie aber als Erinnerung.“
- „Vergiss die Information über meinen alten Rechner.“

Die Ausführung dieser Wünsche bleibt eine Modellentscheidung, keine neue starre
Chat-Befehlssprache. Speichern wird erst nach erfolgreichem Werkzeugergebnis bestätigt.
Ein Vergessen löscht die dauerhafte Erinnerung, nicht automatisch bereits sichtbare
Nachrichten im aktuellen Chat oder andere Nutzerdokumente.

## Keine Kopien der Grundinformationen in jedem Gesprächsschritt

services/prompt-context.js projiziert aktuelle Fakten und Kommunikationsstil über den
unterstützten before_agent_start-Hook der installierten SDK-Version in den ausgehenden
Systemkontext. Der Verlauf enthält die normalen Nutzernachrichten; das Grundwissen wird
nicht jedem User-Turn erneut vorangestellt. Änderungen werden bei der nächsten Anfrage
frisch gelesen. Nutzer- und Rechtekontext bleiben getrennt; Facts erteilen keine Rechte.

Der echte SDK-/Qwen-Test prüft: Fakt kommt an, zweite Frage erzeugt keine zweite Kopie,
frische Session kennt denselben Fakt, Korrektur wird frisch gelesen, gelöschter Fakt fehlt
im aktuellen Zusatzkontext und ein anderer Nutzer erhält ihn nicht.
Das ist keine Garantie, dass ein Modell Inhalte aus bereits geführten Unterhaltungen
ignoriert; nach Vergessen kann für den aktuellen Gesprächskontext ein neuer Chat sinnvoll sein.

## Kontextbudget

Die ausgehende Anfrage wird nach der SDK-Projektion beurteilt: Systemtext, aktuelle
Tool-Deklarationen, neueste Nachricht und Bilder zählen mit. Budget = tatsächliches
Modellkontextfenster minus Modell-Antwortmaximum und 1024 Tokens Reserve.
Die Schätzung ersetzt weiterhin keinen modellgenauen Tokenizer.

Nur vollständige ältere User-/Tool-Runden werden entfernt; Systemnachrichten und
Werkzeugdeklarationen bleiben erhalten. Die neueste Runde bleibt auch dann zusammen,
wenn sie allein zu groß ist: SDK-Kompaktion/Überlaufbehandlung bleibt zuständig.
Die vorherige grobe Speicherbegrenzung des Sitzungsverlaufs bleibt zusätzlich aktiv.
Die Berechnung erfolgt nun mit einem linearen Durchlauf statt wiederholt alle möglichen
Verlaufsausschnitte neu zu serialisieren. Textfelder namens data werden gezählt;
nur echte Bildbytes werden durch eine pauschale Bildschätzung ersetzt.

## Bildmodell: ungenutzte Metal-Puffer freigeben

Nach dem Speichern eines Bildes entfernt der Worker das Bildobjekt, wartet auf GPU-Arbeit,
sammelt unreferenzierte Python-Objekte und gibt mit mlx.core.clear_cache nur ungenutzte
Allocator-Puffer frei. Lebende Modellgewichte bleiben geladen; Wiederverwendung und
60-Sekunden-Leerlaufende bleiben erhalten. Ein optionaler Bereinigungsfehler macht ein
bereits gespeichertes Bild nicht unbrauchbar. Speicherzahlen werden ohne Prompts protokolliert.

Bei einem echten 768×768-Testbild meldete der Worker 14.61 GB freien Allocator-Cache
vor der Bereinigung, danach 0; aktive MLX-Belegung danach 3.41 GB (dezimal).
Das ist eine direkt gemeldete Cache-Freigabe, keine Reduktion der Modellgröße.

Je ein Lauf mit Qwen geladen, Bildauftrag und 65 Sekunden Nachbeobachtung:

| Beobachtung | Vorher | Mit Bereinigung |
| --- | ---: | ---: |
| Bild 768×768, vier Schritte | 9.47 s | 8.37 s |
| Chat während des Bildauftrags, kurze Testfrage | 263 ms | 258 ms |
| Zunahme Swapouts (16-KiB-Seiten) | 197452 | 2760 |
| Belegter Swap am Laufende | 11329 MiB | 11252 MiB |

Rohdaten: documentation/performance/2026-11-09/memory-before.json und memory-after.json.
Der zweite Lauf beginnt bereits mit dem Swapbestand aus dem ersten Lauf. Cachezustände
und Systemlast unterscheiden sich; daraus keine allgemeine Prozentsteigerung oder
kausale Garantie für Swap ableiten. Die einmalige starke Cache-Freigabe ist dagegen direkt
belegt. Bereits ausgelagerte Seiten verschwinden nicht zwangsläufig sofort aus dem Swap.
Ollama wird weder automatisch entladen noch neu konfiguriert.

Offizielle Referenz: [MLX clear_cache](https://ml-explore.github.io/mlx/build/html/python/_autosummary/mlx.core.clear_cache.html).

## Prüfungen

79 Offline-Tests bestanden (45 Agent, 12 Telegram, 22 Python). Neue Regressionen betreffen
Grundwissen, alte Suchtreffer, Korrekturen/Löschen, Limits, beschädigte Dateien, Nutzertrennung,
neue Sessions, Kontextbudgets und MLX-Pufferbereinigung mit erhaltener aktiver Belegung.
Zusätzliche echte Qwen-/SDK-Prüfung der Session-Fortsetzung und Gedächtnisprojektion bestanden.
Bildmodell-Wiederverwendung nach Bereinigung ebenfalls real geprüft: gleicher Worker-Prozess,
identische dekodierte RGB-Pixel bei gleichem Seed/Prompt (0 mittlere Pixelabweichung),
3.62 s erster und 1.91 s zweiter kleiner 256×256-Aufruf. Die PNG-Dateibytes unterscheiden
sich trotz identischer Pixel; der erste zu strikte Dateihash-Test wurde deshalb durch
Pixelvergleich ersetzt. Daraus wird keine umfassende Bildqualitätsgarantie abgeleitet.

## Rückweg und Grenzen

Keine Gewichtedateien oder Modelfile-Einstellungen geändert. Das neue core-Feld ist
zusätzliche JSON-Metadaten; die bisherigen Erinnerungen bleiben als Texte lesbar.
Bei Rückkehr zum früheren Server entfällt die garantierte bevorzugte Berücksichtigung
markierter Grundinformationen. Die neue Version begrenzt promptseitig das Grundwissen;
eine richtige Auswahl kann dem Nutzer nicht allein durch Stichwortsuche abgenommen werden.

## Abschlussprüfung

Echter HTTP-/Qwen-Test nach allen Gedächtnisänderungen bestanden: Text, geplanter
Plugin-Aufruf mit abgefangener Zustellung, Bildanalyse, Bild-Streaming und Anschlussfrage.
Nativer Bildabbruch nach 2.78 s beendet; unmittelbar danach wieder erfolgreich ein Bild
erzeugt. Agent mit neuer Fassung lokal gestartet; Bildworker führt die neue Bereinigung
bereits aus. Keine echten Nachrichten versendet und keine Produktiv-Erinnerungen umsortiert.
