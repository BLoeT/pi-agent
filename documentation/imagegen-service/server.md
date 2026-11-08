# imagegen-service/server.py — Bildgenerierung

Ein nativer Python-HTTP-Server der Bilder mit FLUX generiert (via `mflux`, Apple-Silicon-optimiert). Läuft nicht im Docker, sondern direkt auf macOS wegen der Metal-Beschleunigung.

## Konfiguration
- `IMAGEGEN_PORT` — Port (default: 8086)
- `IMAGEGEN_OUTPUT_DIR` — Wo Bilder gespeichert werden
- `IMAGEGEN_MODEL` — "schnell" (schnell) oder "dev" (beste Qualität)
- `IMAGEGEN_WIDTH` / `IMAGEGEN_HEIGHT` — Standard-Auflösung (default 1024x1024)
- `IMAGEGEN_STEPS` — Diffusion-Schritte (schnell: 4, dev: 20)
- `IMAGEGEN_QUANTIZE` — 4 oder 8 Bit (spart RAM)

## Funktionen

### `generate_image(prompt, width, height, steps, seed, model, init_image, strength)`
Die Kernfunktion. Baut einen `mflux-generate`-Kommandozeilenaufruf zusammen und führt ihn aus:
- Erzeugt einen eindeutigen Dateinamen (Zeitstempel + UUID)
- **Text-to-Image:** Nur Prompt → neues Bild
- **Image-to-Image:** Wenn `init_image` gesetzt ist, wird `--init-image` + `--strength` genutzt (bestehendes Bild bearbeiten). Strength 0.0 = kaum Änderung, 1.0 = komplett neu
- Timeout: 5 Minuten
- Gibt Pfad, Dimensionen und Generierungszeit zurück

## HTTP-Handler (`ImageGenHandler`)

### `GET /health`
Prüft ob `mflux-generate` verfügbar ist, meldet Modell und Ausgabeverzeichnis.

### `GET /models`
Listet die verfügbaren Modelle (schnell, dev).

### `GET /images/<filename>`
Liefert ein generiertes Bild als Binärdaten. Path-Traversal-Schutz (kein `/` oder `..` im Namen).

### `POST /generate`
Nimmt einen JSON-Body mit `prompt` (+ optionalen Parametern `width`, `height`, `model`, `init_image`, `strength`), validiert die Werte und ruft `generate_image()` auf. Gibt das Ergebnis als JSON zurück.

## Startup (`main`)
Meldet die Konfiguration, prüft ob `mflux-generate` installiert ist, und startet den Server auf `127.0.0.1` (nur lokal erreichbar).

## Zusammenspiel
Der pi-agent (`imagegen`-Tool) ruft `POST /generate` auf, kopiert das Bild in den User-Ordner, und gibt einen `[FILE:...]`-Marker zurück. pi-telegram/Web-Chat holen das Bild dann über den Proxy im pi-agent.
