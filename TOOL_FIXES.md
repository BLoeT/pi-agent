# Tool- und Plugin-Korrekturen – 8. November 2026

## Telegram: eine Zustellung pro geplantem Auftrag

Die drei vorhandenen proaktiven Regeln enthalten Versandaufträge. Bisher konnte dadurch
zuerst ein Tool den vollständigen Text senden und danach der Scheduler die abschließende
Agent-Zusammenfassung. Der Scheduler kennzeichnet seine Aufträge jetzt intern. Direkte
Versand-Tools sammeln dabei ihre Texte in einem auf diesen Auftrag beschränkten Ausgang.

Der Scheduler verwendet den gesammelten vollständigen Inhalt, falls vorhanden, sonst die
Agent-Antwort. Die Zusammenfassung wird nicht zusätzlich verschickt. Mehrere identische
Texte werden zusammengeführt. Überlange Texte werden als eine Textdatei in einer einzelnen
Telegram-Nachricht gesendet. Interaktive, ausdrücklich angeforderte Nachrichten bleiben möglich.

Der Versandstatus wird vor der Ausführung reserviert und nach Erfolg abgeschlossen; bei
Fehlern wird die Reservierung freigegeben. Nutzer-ID und lokales Datum gehören zum Schlüssel.
Vorhandene Versandmarkierungen bleiben für eindeutig zuordenbare alte Regeln berücksichtigt.
Ein exakt einmaliger Versand trotz eines Prozessabsturzes unmittelbar nach Telegram-Annahme
kann ohne Unterstützung der Gegenstelle nicht garantiert werden; die bekannten doppelten
Versandwege und parallele normale Ausführungen sind jedoch abgefangen.

## Behobene Befunde

| Bereich | Korrektur |
| --- | --- |
| ZIP | API von Archiver 8 (`ZipArchive`), temporäre Ausgabedatei, atomarer Ersatz, Fehler-/Abbruchbehandlung. Auch der Zielpfad wird geprüft; fremde Symlinks werden abgelehnt. |
| Notizen/Gedächtnis | Beschädigte Dateien melden einen Fehler und bleiben erhalten. Kein Zurücksetzen auf leere Listen beim Lesen. Atomare Schreibvorgänge. |
| Datendateien | Pfadprüfung für feste Nutzerdateien und gemeinsame Gruppenpfade; bestehende Symlinks werden beim Speichern nicht verfolgt. |
| Proaktive Regeln | Neue Regeln erhalten eindeutige IDs. Alte gleiche IDs werden mit Nutzer-ID ausgewählt. Doppelte Namen innerhalb desselben Nutzers werden beim Anlegen abgelehnt. |
| Gemeinsame Änderungen | Agent und Telegram verwenden dieselbe Dateisperre und atomaren Dateiersatz. Gewohnheitsvorschläge werden in den aktuellen Stand eingefügt, statt einen veralteten Gesamtstand zurückzuschreiben. |
| Erinnerungs-Plugin | Einmalige, tägliche und wöchentliche Termine werden verbindlich geparst. Der Telegram-Scheduler verarbeitet diese Daten alle 30 Sekunden. Eigene Einträge können aufgelistet, abgebrochen oder mit `reschedule` neu angesetzt werden. |
| Kalender | Wiederholungen und Ausnahmen werden über die bereits vorhandene node-ical-Bibliothek aufgelöst. Echte Bearbeitung mit stabiler UID; mehrdeutige Treffer werden abgelehnt. Ganztagstermine berücksichtigen Tageswechsel bei Zeitumstellung. |
| Bild/Video | SDK-Abbruch plus Zeitlimit werden bis zum HTTP-Aufruf weitergereicht. Eine authentifizierte Job-Abbruchschnittstelle beendet den nativen Worker bzw. die CLI-Prozessgruppe. Abgebrochene eigene Ausgabedateien werden aufgeräumt. |
| Dateiübertragung | Fehlende, leere oder nicht übertragbare Generierungsdateien ergeben einen Fehler statt eines falschen Erfolgs ohne Datei-Marker. |
| Plugin-Rechte | Funktionsanzeige und Ausführung verwenden dieselbe Freigabeprüfung und Admin-Einschränkung. Leere Freigaben werden als „niemand“ angezeigt. |
| Ausgaben | Ungültige oder unlesbare Datumsangaben werden abgelehnt; beispielsweise wird 31.02. nicht mehr auf März verschoben. |
| Lernkarten | Normalisierte Duplikate werden auch innerhalb eines einzelnen Generierungsaufrufs erkannt. |
| HTTP | Suche, Rezepte, Witze, Telegram-Helfer und übrige Tool-Aufrufe haben begrenzte Laufzeiten einschließlich Antwortkörper; der SDK-Abbruch wird mitgeführt. |
| Kleine Eingabeprüfungen | Datei-Lesegrenzen und Zeilenbereiche, Nachrichtenlänge sowie Plugin-Dateinamen werden geprüft. Telegram-Text wird als einfacher Text gesendet. |
| Beschreibungen | Veraltete Freigabe-/Selbständerungsanweisungen entfernt, Bildgenerator-Standard und Kalenderparameter korrigiert, verfügbare Video-/Zeitregeln in der Funktionsübersicht ergänzt. |

## Gepflegte Plugins und gemeinsamer Code

Die vier gepflegten Plugin-Implementierungen liegen jetzt unter `pi-agent/plugins/` und
werden mit dem Projekt versioniert. Die bestehenden Workspace-Dateien importieren diese
Implementierungen; die bisherigen lokalen `.meta.json`-Freigaben bleiben erhalten.
Eigene Plugins bleiben möglich und müssen wegen ihrer Rechte im Agent-Prozess geprüft werden.

Für Neuinstallationen: `python3 scripts/install-default-plugins.py --admin <Nutzername>`.
Der Nutzer muss bereits Administrator sein. Das Skript überschreibt weder eigene Plugins
noch vorhandene Freigaben und genehmigt vorhandenen fremden Plugin-Code nicht automatisch.

`shared/` enthält gemeinsame Speicher-, Zeit- und Versandhilfen. Beide Compose-Builds nutzen
nun das Projekt als Build-Kontext. Eine Positivliste in `.dockerignore` nimmt nur die
benötigten Codeordner auf; Workspace und Geheimnisse werden nicht in den Kontext übernommen.
Für diese Korrekturen wurden keine neuen Paketabhängigkeiten installiert.

## Prüfungen

- 28 Agent-Tests: bestehende Sicherheits-/API-/Kontexttests und neue Tool-Regressionen.
- 8 Telegram-Tests: Zustellung ohne zusätzliche Zusammenfassung, parallele Reservierungen,
  Nutzertrennung, ausgebliebener Versand, gemeinsame Regeländerungen und Plugin-Erinnerungen.
- 15 Python-Tests: vorhandene Sicherheit und Audio, native Job-Abbrüche, sichere
  Standard-Plugin-Einrichtung. Zusammen **51 Tests bestanden**.
- Zusätzlich echter lokaler Qwen-Test über die API: Text, abgefangener Plugin-Versand in
  einer geplanten Sitzung, Bildanalyse, Bild-Streaming und weitere Textantwort.
  Künstlicher Workspace und keine echten Telegram-Zugangsdaten.
- Native GPU-Generierung: laufender Testauftrag nach etwa **2,47 Sekunden** abgebrochen;
  anschließende PNG-Generierung erfolgreich (66.366 Bytes).
- Browser-Anmeldung, abgewiesener Dateipfad-Ausbruch und geschützte native APIs erneut geprüft.

Die absichtlichen Fehlerfälle erzeugen im Test entsprechende Fehlermeldungen; sie bedeuten
bei bestandenem Test keinen Fehler des produktiven Dienstes. Es wurden keine echten
Telegram-Testnachrichten oder Geräteaktionen ausgelöst.

## Bestehende alte Erinnerung

Eine aktive alte Plugin-Erinnerung bezieht sich auf den **17. Oktober 2026, 14:00** und hat
keinen gespeicherten Ausführungszeitpunkt. Sie bleibt unverändert erkennbar und wird nicht
nachträglich als neue Nachricht verschickt. Über `reminders list` lässt sie sich erkennen
und bei Bedarf mit `reschedule` unter ihrer bestehenden ID neu terminieren.

## Betriebliche Hinweise

Agent und Telegram laufen weiter in Docker; der Bilddienst läuft nativ am Mac. Der
bestehende MQTT-/Home-Assistant-Aufbau bleibt bestehen. JSON-Sperren sind für kurze synchrone
Änderungen auf diesem lokalen Dateisystem gedacht, nicht für verteilte Netzlaufwerke.
Neue Pakete und neue ungeprüfte Plugins werden nicht automatisch installiert.
