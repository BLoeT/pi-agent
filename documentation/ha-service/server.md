# ha-service/server.js — Home Assistant Bridge

Eine schlanke Bridge zwischen dem pi-agent und Home Assistant. Der pi-agent (im Docker) spricht nicht direkt mit Home Assistant, sondern über diesen Service. Das kapselt die HA-Authentifizierung an einer Stelle.

## Konfiguration
- `HA_URL` — Adresse der Home-Assistant-Instanz (default: http://homeassistant:8123)
- `HA_TOKEN` — Long-Lived Access Token für die HA-API

## Funktionen

### `haFetch(path, options)`
Zentrale Hilfsfunktion für alle HA-API-Aufrufe. Setzt den Authorization-Header mit dem Token und wirft bei Fehlern eine aussagekräftige Exception.

## Endpoints

### `GET /health`
Prüft ob Home Assistant erreichbar ist (testet `/api`). Wird vom Docker-Healthcheck genutzt.

### `POST /call_service`
Führt einen HA-Service aus. Body: `{ domain, service, entity_id, data }`.
Beispiel: Licht anschalten → domain=light, service=turn_on, entity_id=light.wohnzimmer.
Wird vom `homeassistant`-Tool und von Routinen aufgerufen.

### `GET /states`
Gibt alle Geräte-Zustände zurück (vereinfacht: entity_id, state, friendly_name).

### `GET /states/:entity_id`
Gibt den vollen Zustand eines bestimmten Geräts zurück.

### `GET /services`
Listet alle verfügbaren HA-Services auf.

Läuft auf Port 8082 (intern, nur für andere Docker-Services erreichbar).
