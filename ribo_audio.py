#!/usr/bin/env python3
"""Ribo audio service: TTS, Telegram transcription, music and timers.
No microphone recording or wake-word listener is started.
"""
import sounddevice as sd
import numpy as np
import tempfile
import wave
import sys
import os
import signal
from ribo_service_security import authorize, validate_length, configure
configure()
import time
import subprocess
import json
import threading
from http.server import BaseHTTPRequestHandler
from ribo_runtime import BoundedHTTPServer, SpeechQueue

import mlx_whisper
from pocket_tts import TTSModel

# === Konfiguration ===
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "mlx-community/whisper-large-v3-mlx")
TTS_VOICE = os.getenv("TTS_VOICE", "juergen")
TTS_LANGUAGE = os.getenv("TTS_LANGUAGE", "german_24l")
MUSIC_PORT = int(os.getenv("MUSIC_PORT", "8085"))
audio_lock = threading.Lock()
control_lock = threading.Lock()
speech_queue = None

from ribo_services.audio.stations import RADIO_STATIONS
from ribo_services.audio.music import MusicPlayer, AudioDucker
from ribo_services.audio.timers import TimerService

player = MusicPlayer()
ducker = AudioDucker(player)
timer_service = TimerService(ducker)


# === HTTP API für Remote-Steuerung ===
class MusicAPIHandler(BaseHTTPRequestHandler):
    """HTTP Handler für die Music API."""

    def log_message(self, format, *args):
        # Suppress default logging
        pass

    def _send_json(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def _read_body(self):
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length:
            body = json.loads(self.rfile.read(content_length))
            if not isinstance(body, dict):
                raise ValueError("JSON object required")
            return body
        return {}

    def do_GET(self):
        if self.path != "/health" and not authorize(self):
            return
        if self.path == "/music/status":
            self._send_json(player.status())
        elif self.path == "/music/stations":
            self._send_json({"stations": RADIO_STATIONS})
        elif self.path == "/timer/list":
            self._send_json(timer_service.list_timers())
        elif self.path == "/health":
            timer_data = timer_service.list_timers()
            active_timers = len(timer_data.get("timers", []))
            self._send_json({
                "status": "ok",
                "service": "ribo-audio",
                "active_timers": active_timers
            })
        else:
            self._send_json({"error": "not found"}, 404)

    def do_POST(self):
        if not authorize(self) or not validate_length(self):
            return
        needs_model = self.path in ("/tts", "/transcribe")
        request_lock = audio_lock if needs_model else control_lock
        if not request_lock.acquire(blocking=False):
            self._send_json({"error": "Audio-Service beschäftigt; bitte erneut versuchen"}, 503)
            return
        started = time.monotonic()
        try:
            self._post()
        except (ValueError, TypeError):
            self._send_json({"error": "Ungültige Anfrage"}, 400)
        finally:
            request_lock.release()
            if needs_model:
                print(json.dumps({"event": "audio_duration", "route": self.path,
                                  "ms": round((time.monotonic() - started) * 1000)}))

    def _post(self):
        if self.path == "/tts":
            # TTS endpoint: Text → .ogg audio file
            body = self._read_body()
            text = body.get("text")
            if not isinstance(text, str) or not text.strip() or len(text) > 4000:
                self._send_json({"error": "text required"}, 400)
                return
            try:
                with tempfile.TemporaryDirectory(prefix="ribo-tts-") as tmp:
                    wav_path = os.path.join(tmp, "speech.wav")
                    ogg_path = os.path.join(tmp, "speech.ogg")
                    audio = tts_model.generate_audio(voice_state, text)
                    audio_np = audio.numpy()
                    with wave.open(wav_path, "w") as wf:
                        wf.setnchannels(1)
                        wf.setsampwidth(2)
                        wf.setframerate(tts_model.sample_rate)
                        wf.writeframes((audio_np * 32767).astype(np.int16).tobytes())
                    subprocess.run(
                        ["ffmpeg", "-y", "-i", wav_path, "-c:a", "libopus", "-b:a", "64k", "-ar", "48000", ogg_path],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True, timeout=60)
                    with open(ogg_path, "rb") as file:
                        ogg_data = file.read()
                self.send_response(200)
                self.send_header("Content-Type", "audio/ogg")
                self.send_header("Content-Length", str(len(ogg_data)))
                self.end_headers()
                self.wfile.write(ogg_data)
            except Exception as e:
                self._send_json({"error": f"TTS-Fehler: {e}"}, 500)
            return

        if self.path == "/transcribe":
            # Transcribe endpoint: Audio file → text
            content_type = self.headers.get("Content-Type", "")
            content_length = int(self.headers.get("Content-Length", 0))

            if content_length == 0:
                self._send_json({"error": "No audio data"}, 400)
                return

            audio_data = self.rfile.read(content_length)

            try:
                with tempfile.TemporaryDirectory(prefix="ribo-stt-") as tmp:
                    tmp_path = os.path.join(tmp, "upload.audio")
                    wav_path = os.path.join(tmp, "audio.wav")
                    with open(tmp_path, "wb") as file:
                        file.write(audio_data)
                    subprocess.run(
                        ["ffmpeg", "-y", "-i", tmp_path, "-ar", "16000", "-ac", "1", "-f", "wav", wav_path],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True, timeout=60)
                    result = mlx_whisper.transcribe(wav_path, path_or_hf_repo=WHISPER_MODEL, language="de")
                self._send_json({"text": result.get("text", "").strip()})
            except Exception as e:
                self._send_json({"error": f"Transkription-Fehler: {e}"}, 500)
            return

        body = self._read_body()

        if self.path == "/music/play":
            station = body.get("station")
            url = body.get("url")
            result = player.play(station_name=station, url=url)
            status = 200 if "error" not in result else 400
            self._send_json(result, status)
        elif self.path == "/music/stop":
            self._send_json(player.stop())
        elif self.path == "/music/volume":
            volume = body.get("volume")
            if volume is None:
                self._send_json({"error": "volume required"}, 400)
            else:
                self._send_json(player.set_volume(volume))
        elif self.path == "/timer/create":
            name = body.get("name")
            duration_seconds = body.get("duration_seconds")
            if duration_seconds is None:
                self._send_json({"error": "duration_seconds required"}, 400)
            else:
                result = timer_service.create_timer(name=name, duration_seconds=duration_seconds)
                status = 200 if "error" not in result else 400
                self._send_json(result, status)
        elif self.path == "/timer/cancel":
            name = body.get("name")
            if not name:
                self._send_json({"error": "name required"}, 400)
            else:
                result = timer_service.cancel_timer(name=name)
                status = 200 if "error" not in result else 404
                self._send_json(result, status)
        elif self.path == "/tts/speak":
            text = body.get("text")
            if not isinstance(text, str) or not text.strip() or len(text) > 4000:
                self._send_json({"error": "text required"}, 400)
            else:
                if speech_queue and speech_queue.submit(text):
                    self._send_json({"status": "ok", "message": "Speaking..."})
                else:
                    self._send_json({"error": "Sprachausgabe-Warteschlange voll"}, 503)
        else:
            self._send_json({"error": "not found"}, 404)


def start_music_api():
    """Startet den Music HTTP Server in einem Thread."""
    server = BoundedHTTPServer(("0.0.0.0", MUSIC_PORT), MusicAPIHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(f"🎵 Music API auf Port {MUSIC_PORT}")
    return server


# === Audio / Whisper / TTS ===
print(f"🧠 Whisper wird bei Bedarf geladen ({WHISPER_MODEL})")
print("🔊 Lade Pocket TTS...")
tts_model = TTSModel.load_model(language=TTS_LANGUAGE)
voice_state = tts_model.get_state_for_audio_prompt(TTS_VOICE)


def speak(text):
    """Spricht Text via Pocket TTS (ohne Ducking)."""
    if not isinstance(text, str) or not text.strip() or len(text) > 4000:
        return
    try:
        audio = tts_model.generate_audio(voice_state, text)
        sd.play(audio.numpy(), samplerate=tts_model.sample_rate)
        sd.wait()
    except Exception as e:
        print(f"⚠️  TTS-Fehler: {e}")


def speak_with_ducking(text):
    """Spricht Text via Pocket TTS mit automatischem Audio Ducking.
    
    Reduziert die Musiklautstärke vor dem Sprechen und stellt sie danach wieder her.
    Ducking wird nur aktiviert wenn Musik gerade spielt.
    """
    if not isinstance(text, str) or not text.strip() or len(text) > 4000:
        return
    ducker.duck()
    try:
        speak(text)
    finally:
        ducker.restore()


def check_ffmpeg():
    """Prüft ob ffmpeg installiert ist (benötigt für /tts und /transcribe Endpoints)."""
    try:
        subprocess.run(["ffmpeg", "-version"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True, timeout=60)
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        print("⚠️  ffmpeg nicht gefunden — /tts und /transcribe Endpoints werden nicht funktionieren")
        print("   Installieren mit: brew install ffmpeg")
        return False


def main():
    global speech_queue
    def stop_on_signal(_signum, _frame):
        raise KeyboardInterrupt
    previous = signal.signal(signal.SIGTERM, stop_on_signal)
    speech_queue = SpeechQueue(speak_with_ducking, audio_lock)

    check_ffmpeg()

    # Music API starten
    server = start_music_api()

    print("🔊 Ribo Audio-Service bereit (kein Mikrofon-Listener)")
    print(f"   Whisper: {WHISPER_MODEL} (MLX/Metal)")
    print(f"   Stimme: {TTS_VOICE} ({TTS_LANGUAGE})")
    print(f"   Sender: {', '.join(RADIO_STATIONS.keys())}")
    print("   (Strg+C zum Beenden)\n")

    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        print("\nTschüss!")
        player.stop()
    finally:
        signal.signal(signal.SIGTERM, previous)
        timer_service.close()
        player.stop()
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
