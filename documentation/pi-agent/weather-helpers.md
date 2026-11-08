# pi-agent/weather-helpers.js — Wetter-Hilfsfunktionen

Unterstützt das `weather`-Tool mit Wetter-Code-Übersetzung, Tagesberechnung und Geocoding.

## Funktionen

### `mapWmoCodeToCondition(code)`
Übersetzt einen WMO-Wettercode (von der Open-Meteo API) in eine deutsche Beschreibung. Z.B. Code 0 → "klar", Code 61 → "Regen", Code 71 → "Schnee".

### `resolveTargetDayIndex(day)`
Wandelt eine Tagesangabe ("heute", "morgen", "montag", ...) in einen Index um (0 = heute, 1 = morgen, ...). Gibt -1 zurück bei ungültiger Eingabe. Wird genutzt um den richtigen Tag aus der 7-Tage-Vorhersage zu wählen.

### `formatDayLabel(dayIndex, day)`
Erzeugt eine lesbare Tagesbezeichnung für die Ausgabe (z.B. "morgen", "Freitag").

### `geocodeLocation(locationName)`
Wandelt einen Ortsnamen (z.B. "München") in Koordinaten um, via Open-Meteo Geocoding API. Gibt `{ lat, lon, name }` zurück oder `{ error: "not_found" }`. Ermöglicht Wetterabfragen für beliebige Orte, nicht nur den Standard-Standort.
