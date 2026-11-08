# pi-agent/lib/helpers.js — Shared Helpers

Sammlung von Hilfsfunktionen die von mehreren Tools genutzt werden: Datum/Zeit-Parsing (deutsch), Kalender/ICS-Erzeugung, Notizen- und Listen-Dateizugriff, und Pfad-Auflösung pro User.

## Deutsche Datums-Verarbeitung

### `parseGermanDate(dateStr)`
Wandelt deutsche Datumsangaben in ein `Date`-Objekt um. Versteht:
- Schlüsselwörter: "heute", "morgen", "übermorgen"
- Wochentage: "montag", "dienstag", ... (nimmt den nächsten passenden Tag)
- `TT.MM.YYYY` (z.B. "15.03.2026")
- `TT.MM.` (z.B. "15.03." — nimmt das nächste Vorkommen, dieses oder nächstes Jahr)

Gibt `null` zurück wenn nichts passt. Enthält Validierung (z.B. 31.02. wird abgelehnt).

### `parseGermanTime(timeStr)`
Wandelt Uhrzeiten in `{ hours, minutes }` um. Versteht:
- `HH:MM` (z.B. "14:30")
- "um X Uhr" (z.B. "um 14 Uhr")
- "um halb X" (z.B. "um halb 3" → 2:30)

Gibt `null` zurück wenn nichts passt.

## Kalender-Helpers

### `getCalendarFilePath()`
Pfad zum persönlichen Kalender des aktuellen Users: `.../users/<name>/calendar.ics`.

### `getAllCalendarFiles()`
Liste aller Kalender die ein User sehen darf: sein persönlicher + alle Gruppen-Kalender (Familie, Eltern). Wird für Terminabfragen genutzt (zeigt persönliche + geteilte Termine zusammen).

### `generateEventUID()`
Erzeugt eine eindeutige ID für einen Kalendereintrag (Zeitstempel + Zufallsstring).

### `generateVEvent({ title, startDate, endDate, allDay, reminders })`
Erzeugt einen VEVENT-Block im ICS-Format (iCalendar-Standard). Behandelt:
- Ganztägige Termine (`allDay`) vs. Termine mit Uhrzeit
- **Erinnerungen** (`reminders` als Array von Minuten): Erzeugt VALARM-Blöcke mit korrekter TRIGGER-Duration (`-P1D` = 1 Tag vorher, `-PT1H` = 1 Stunde vorher etc.)

### `appendEventToIcs(filePath, veventStr)`
Fügt einen Termin in eine ICS-Datei ein. Legt die Datei neu an falls sie nicht existiert, sonst wird der neue Termin vor `END:VCALENDAR` eingefügt.

## Notizen-Helpers

### `getNotesFilePath()`
Pfad zur Notizen-Datei des aktuellen Users.

### `readNotes()`
Liest die Notizen (JSON-Array). Selbstheilend: bei korrupter Datei wird sie zurückgesetzt statt abzustürzen.

### `writeNotes(notes)`
Speichert das Notizen-Array als JSON.

## Listen-Helpers

### `getListsDir()`
Verzeichnis der persönlichen Listen des aktuellen Users.

### `deriveFilename(listName)`
Wandelt einen Listennamen in einen Dateinamen um (kleingeschrieben, Leerzeichen → Bindestriche). "Einkaufsliste" → "einkaufsliste".

### `getSharedListPath(listName)`
Prüft ob eine Liste zu einer Gruppe gehört (z.B. "Einkaufsliste" = Familien-Liste). Gibt den geteilten Pfad zurück oder `null`.

### `getListPath(listName)`
Ermittelt den Dateipfad einer Liste: erst prüfen ob geteilt (dann Gruppen-Pfad), sonst persönlicher Pfad. So landen geteilte Listen automatisch im gemeinsamen Ordner.

### `ensureListsDir()`, `readList()`, `writeList()`, `listExists()`, `deleteListFile()`
Standard-Dateioperationen für Listen (Verzeichnis anlegen, lesen, schreiben, prüfen, löschen).

### `getAllListNames()`
Alle Listennamen die ein User sieht: persönliche + geteilte Gruppen-Listen (ohne Duplikate).

## Pfad-Helpers für andere Tools

### `getGodotProjectDir()`
Godot-Projektverzeichnis des aktuellen Users.

### `getImagegenOutputDir()`
Verzeichnis für generierte Bilder des aktuellen Users.

### `getFlashcardsDir()`
Verzeichnis für Lernkarten-Decks des aktuellen Users.

Alle drei leiten aus `getCurrentUserId()` + `getUserWorkspacePath()` ab — so ist alles automatisch pro User getrennt.
