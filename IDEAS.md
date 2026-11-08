# Feature-Ideen für später

## Videogenerierung (Wan2.2 auf Apple Silicon)
- "Generier ein kurzes Video von einem Sonnenaufgang"
- Text-to-Video: Kurze Clips (3-5s) aus Text-Prompt
- Image-to-Video: Ein generiertes Bild zum Leben erwecken
- Video-to-Video: Bestehenden Clip mit neuem Stil versehen
- Technisch: mlx-gen mit Wan2.2-Modell (T2V/I2V)
- Separater Service (on-demand, nicht permanent im RAM)
- Generierungszeit: ~2-5 Minuten pro 3s Clip
- Via Telegram als Video-Nachricht zurückschicken

## Videoverständnis (Video-Analyse)
- Video via Telegram schicken → Ribo beschreibt was passiert
- Ansatz: ffmpeg extrahiert Frames (1/Sekunde) + Tonspur
- Frames → Vision-Modell (Qwen2.5VL) für Bildbeschreibungen
- Tonspur → MLX Whisper für Transkript
- Ribo kombiniert: "Das Video zeigt X, es wird gesagt Y"
- Kein echtes Bewegungsverständnis (Frame-basiert), aber praktisch
- Alternative (später): natives Video-VLM wenn auf Apple Silicon verfügbar
- Rechenintensiv — erst mit M5 Pro sinnvoll
- Via Telegram als Video-Nachricht zurückschicken

## Nachrichten nach Thema / Kategorie
- Aktuell filtert `news` nur nach Quelle (Feed-Name), nicht nach Thema oder Land ("aus Deutschland", "Sport", "Politik" haben keinen Effekt)
- Idee A (einfach, kein Code): thematische RSS-Feeds in `NEWS_FEEDS` ergänzen (z.B. `sport:...`, `wirtschaft:...`, `regional:...`) → dann "Nachrichten von sport" gezielt abrufbar
- Idee B (Code): Kategorie-Konzept im news-Tool — Feeds mit Kategorie taggen, `headlines` um `category`-Filter erweitern, SYSTEM.md-Beispiele ("Sport-Nachrichten", "Wirtschaft")
- Idee C: für flexible Themen/Länder das `search`-Tool nutzen statt RSS (Tavily-Websuche) — weniger kuratiert, dafür beliebige Themen
- Entscheidung offen: RSS-Kategorien (kuratiert, schnell) vs. Websuche (flexibel)

## PDF-Erstellung + Versand
- "Erstelle mir eine PDF mit dem und dem Inhalt und schick sie mir per Telegram"
- Neues `pdf`-Tool: Text/Markdown → PDF in den User-Workspace, dann via `[FILE:userId:relPath]`-Marker per Telegram schicken (Versand-Mechanik existiert bereits in sendResponseWithVoice)
- Technisch: `pdfkit` (pure-JS, kein native-build) als Dep ins pi-agent Dockerfile — mit `--ignore-scripts --save-exact` konsistent zur restlichen Härtung
- Als Core-Tool umsetzen (nicht Plugin), da die Lib im Image liegen muss
- Neue Permission `pdf` in users.json ergänzen + capabilities-Tool (Feature-Zeile wieder aufnehmen)
- Optional: einfache Layouts (Überschrift, Absätze, Listen); Bilder einbetten später
- SYSTEM.md: Nutzungs-Beispiele + Hinweis dass der file_marker ans Ende der Antwort muss

---

## Erledigt

### ~~Erinnerungen~~ ✅
Umgesetzt als Teil des Kalender-Tools + Reminder-Service.

### ~~Bildgenerierung~~ ✅
Umgesetzt als `imagegen-service` mit FLUX.1 auf Apple Silicon (mflux/MLX). Inkl. img2img.

### ~~Lernkarten / Spaced Repetition~~ ✅
Umgesetzt als `flashcards`-Tool im Agent.

### ~~Schnellnotiz via Telegram-Foto~~ ✅
Umgesetzt: Fotos werden via Vision analysiert, Ribo schlägt Aktionen vor.

### ~~Kochassistent~~ ✅
Umgesetzt als `cooking`-Tool. Rezeptsuche via Web + Zutaten auf Einkaufsliste.

### ~~Ausgaben-Tracker~~ ✅
Umgesetzt als `expenses`-Tool. Manuell oder via Foto, Kategorien, Monatsübersicht pro User.

### ~~Persönlichkeit pro User~~ ✅
Umgesetzt als `personality`-Tool. Beim ersten Kontakt fragt Ribo nach Kommunikationsstil.

### ~~Konversations-Zusammenfassung / Langzeitgedächtnis~~ ✅
Umgesetzt als `memory`-Tool. Speichert Fakten, Präferenzen, Session-Summaries. Selektives Vergessen.

### ~~Proaktive Nachrichten~~ ✅
Umgesetzt als Background-Service in pi-telegram. Zeitgesteuerte Regeln.

### ~~Gewohnheiten lernen~~ ✅
Umgesetzt: habits_log.json + tägliche Muster-Analyse + Vorschläge via Telegram.
