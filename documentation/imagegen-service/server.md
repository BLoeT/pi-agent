# Nativer Bild-/Video-Service

- `server.py`: authentifizierte HTTP-Schnittstelle, Health und Job-Zuordnung.
- `service_config.py`: explizite typisierte Konfiguration.
- `engines.py`: unterstützte Engines/Aliase als reine Metadaten.
- `pipeline.py`: Bild-/Video-Generierung und Besitz des Modell-Workers.
- `jobs.py`: Prozessgruppen, Zeitlimits und auftragsbezogener Abbruch.
- `worker_client.py` / `model_worker.py`: begrenzter wiederverwendbarer Flux2-Prozess.

`/generate` und `/generate-video` bleiben erhalten. Eine optionale UUID `job_id` erlaubt den
Abbruch über `/cancel`; alle drei Endpunkte benötigen den internen Bearer-Token. Es läuft
weiterhin höchstens eine Generierung. Der Modell-Worker wird vor einer anderen CLI-Pipeline
geschlossen und nach dem konfigurierten Leerlauf beendet.

Startpfad und Port 8086 bleiben kompatibel. Details und Grenzen:
[ARCHITECTURE.md](../../ARCHITECTURE.md), [TOOL_FIXES.md](../../TOOL_FIXES.md).
