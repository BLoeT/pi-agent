# Nativer Audio-Service

`hey-ribo.py` ist der kompatible Starter für `ribo_audio.main()`. Es wird kein Mikrofon-
oder Wake-Word-Listener betrieben.

`ribo_audio.py` stellt TTS/STT, Musik und Timer über die authentifizierte HTTP-API bereit.
Der wiederverwendete TTS-Zustand und begrenzte Audio-Arbeiten bleiben dort; Musik, Lautstärke-
absenkung, Timerzustand und Senderkatalog sind unter `ribo_services/audio/` getrennt testbar.

Die Dienste behalten Port 8085, die vorhandenen Endpunkte und die Logdatei `.logs/voice.log`.
Bei normalem Beenden werden Listener, Musikprozess und Timer-Callbacks aufgeräumt.
Details: [ARCHITECTURE.md](../../ARCHITECTURE.md).
