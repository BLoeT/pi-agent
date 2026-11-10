# Eigene Bilder: Web und Telegram

9. November 2026.

## Behobene Ursache

Der Webchat übergab Bilder bisher nur als Base64 an die Vision-Session. Für imagegen
oder videogen fehlte ein Dateipfad zum aktuellen Bild. Ein Modell konnte deshalb einen
älteren bekannten Pfad aus telegram-inbox auswählen. Es gab keinen technischen Schutz
gegen diese Verwechslung.

Neue eingehende Bilder werden jetzt vor der Modellverarbeitung mit exakt denselben
Bytes im authentifizierten Nutzer-Workspace unter uploads/ gespeichert. Der aktuelle
relative Pfad wird der Anfrage mitgegeben und über AsyncLocalStorage an deren Tools
gebunden. Es gibt keinen globalen „letztes Bild“-Zeiger. Imagegen und Videogen verwenden
standardmäßig diese Anfragequelle. Ein abweichender alter source_image-Pfad wird vor
dem Generierungsaufruf abgewiesen. use_uploaded_image:false erlaubt ausdrücklich neue
Textgenerierung ohne Vorlage, aber keine Kombination mit einem anderen Quellpfad.

Ohne neuen Anhang sind bewusst gewählte bestehende Bilder weiterhin nutzbar; vor der
erneuten Nutzung sollen aktuelle Namen mit uploads/list geprüft werden. Nach Umbenennen
oder Löschen sind alte Pfade keine gültige Quelle mehr. Die Bild-/Video-Dienste dürfen
nicht ersatzweise eine beliebige andere Inbox-Datei wählen.

## Namen und Ablage

Physisch liegen neue Uploads unter:
/Users/enricostarke/Desktop/pi-agent/workspace/users/<Nutzer>/uploads/

Ein Konto teilt seinen Ordner über Web und Telegram. Unterschiedliche Nutzer haben
getrennte Ordner. Die Webidentität kommt aus der Anmeldung, die Telegramidentität aus
der autorisierten Chat-Zuordnung. Dateinamen oder Bildtexte können keinen Nutzer wählen.

Ohne Namen wird eine UUID verwendet. Mit test1 wird je nach echtem Format test1.png,
test1.jpg oder test1.webp angelegt. Namen dürfen Buchstaben/Zahlen sowie übliche
Leerzeichen, Punkte, Unter- und Bindestriche enthalten; keine Pfade. Bereits vorhandene
Namen werden mit 409 abgewiesen, nicht überschrieben. Veröffentlichung erfolgt atomar
über eine fertige private Temporärdatei und einen exklusiven Hardlink.

Im Web: Bild anhängen, optional „Speichern unter“ ausfüllen, Nachricht senden. In der
Nachricht wird der tatsächliche gespeicherte Name angezeigt. Über „Meine Bilder“ lassen
sich eigene Uploads ansehen, umbenennen und nach Bestätigung löschen. Die Liste ist
seitenweise auf 20 Einträge begrenzt, mit „Weitere Bilder laden“.

In Telegram: Foto z.B. mit folgender Bildunterschrift senden:
„Speichere das unter dem Namen test1“ oder „Speicher das als test1“.
Das speichert direkt über die zentrale Upload-API ohne einen unnötigen Modellaufruf.
Normale Fotoanalysen werden ebenfalls im eigenen uploads/-Ordner abgelegt.

Als normale Nachricht kann man anschließend z.B. sagen:
„Benenne mein hochgeladenes Bild test1.png in Urlaub um.“
„Lösche mein hochgeladenes Bild Urlaub.png.“

Das neue uploads-Tool darf ausschließlich eigene hochgeladene Fotos auflisten,
umbenennen oder löschen. Es benötigt dafür keine breiten Rechte auf andere Dateien.
Der bestehende files/rename-Weg unterstützt eigene uploads/-Bilder ebenfalls.

## Sicherheit und Grenzen

- JPEG, PNG und WebP, maximal 10 MB; kanonisches Base64 und Formatkennung werden geprüft.
- Liste, Ansicht, Umbenennen und Löschen verwenden ausschließlich den serverseitigen Nutzer.
- Fremde Identitäten, Pfadtraversierung und aus dem Nutzerverzeichnis führende Symlinks
  werden abgewiesen; CSRF-/Origin-Schutz bleibt für Änderungen aktiv.
- Gleiche Namen bei verschiedenen Nutzern sind unabhängig voneinander.
- Aktives Umbenennen aktualisiert die aktuelle Tool-Quelle; aktives Löschen macht sie
  ungültig. Ein anderer Dateiname wird nicht automatisch als Ersatz eingesetzt.
- Umbenennen/Löschen während einer in dieser Webansicht laufenden Antwort ist gesperrt.
  Eine gleichzeitige Änderung auf einem anderen Gerät kann eine laufende Verarbeitung
  fehlschlagen lassen, darf aber keine andere Bildquelle substituieren.
- Löschen entfernt die gespeicherte Datei. Schon gesendete Nachrichten/Bildkopien im
  aktuellen Chat oder in Telegram werden dadurch nicht rückwirkend entfernt.
- Frühere Webbilder waren nicht als Dateien gespeichert und werden nicht rückwirkend
  rekonstruiert. Betroffenes Bild nach dem Update bitte erneut hochladen.
- Bestehende telegram-inbox-Dateien werden nicht automatisch migriert oder gelöscht.

## Prüfungen

108 Offline-Tests bestanden: 63 Agent, 23 Telegram, 22 Python. Neue Tests prüfen
Byte-Gleichheit, alte Inbox-Quelle, Namenskollision, Nutzertrennung, sichere Dateipfade,
aktive Quellen nach Umbenennen/Löschen, HTTP-Authentifizierung/Origin und Telegram-Captions.

Echter Qwen-/SDK-Test mit einem alten blauen Telegram-Testbild und einem neuen roten
Web-Testbild: Nur der neue eigene Upload ging an den simulierten Generierungsdienst.
Die Bytes stimmten exakt. Normale Anweisungen zum Umbenennen und Löschen des Originals
wurden anschließend erfolgreich ausgeführt. Keine echten Nutzerbilder oder Geräteaktionen.

Die Webverwaltung wurde mit isolierten Testdaten im Browser geprüft: Vorschau, Namen
ändern, Löschrückfrage und Entfernen; außerdem 390px Breite ohne horizontalen Überlauf.
Testserver beendet. Bildbearbeitungsqualität selbst ist kein Teil dieses Routing-Tests.
