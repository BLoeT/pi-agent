# Webchat-Gestaltung – 9. November 2026

Schwarze/neutralgraue Oberfläche mit weißen Akzenten. Neue Seitenleiste,
Startkarten, großzügigeres Eingabefeld und kompakte Moduswahl. Auf schmalen
Bildschirmen ist die Seitenleiste ein ausklappbares Menü.

Antworten unterstützen sichere Grundformatierung: Überschriften, Absätze,
Listen, Hervorhebungen, Inline-Code und Codeblöcke mit Kopierfunktion.
Das ist ein bewusst begrenzter Markdown-Umfang, kein vollständiger HTML-Renderer.
Modelltext wird als DOM-Text eingefügt; keine Ausführung fremden HTMLs.
Links erlauben nur HTTP(S), Dateimarker bleiben über die vorhandene geschützte
Dateischnittstelle erreichbar. Keine zusätzlichen Pakete, externen Fonts oder CDNs.

Denkphase ist einklappbar. Werkzeuge werden mit verständlichen Bezeichnungen und
Status statt roher Parameter-/Ergebnis-JSON angezeigt. Vorschläge füllen die Eingabe,
führen aber nicht selbständig Aktionen aus. Bilder sind weiter auswählbar, zusätzlich
per Zwischenablage oder Drag-and-drop; maximal JPEG/PNG/WebP mit 10 MB.

Während einer Antwort können bis zu drei weitere Nachrichten vorgemerkt werden.
Abbruch wartet auf die Bestätigung, bevor vorgemerkte Arbeit weitermacht. Beim Lesen
älterer Nachrichten wird nicht ständig automatisch ans Ende gesprungen. Ein neuer Chat
fragt vor dem Zurücksetzen der sichtbaren Unterhaltung nach und behält Grundwissen.

Im Browser bei normaler Fenstergröße und 390×844 geprüft: Startbereich, mobile
Navigation, Hilfe, Moduswechsel, formatiertes Streaming, Codeblöcke, Vormerken,
Abbruch mit anschließender Bearbeitung, Fehlerzustand sowie Neuer-Chat-Dialog.
Verwendet wurde ein separater lokaler Testserver mit synthetischen Antworten;
keine Modell-/Geräteaktionen oder echten Nachrichten für diese UI-Tests.
97 bestehende Offline-Prüfungen bestanden. Nach der Farbänderung zusätzlich
Anmeldung, geschützte Dateipfade und API-/HTML-Prüfung bestanden. Laufende schwarze
Oberfläche per authentifiziertem Abruf bestätigt, Agent gesund. Testserver beendet.

Der Antwortmodus wird als einzelner Einstellungswert im Browser gespeichert;
Chatnachrichten und Bilddaten werden nicht neu im Browser dauerhaft archiviert.
