#!/usr/bin/env python3
"""
Wake-word listener + Music Player:
- Hört dauerhaft zu, erkennt "Roberto" und sendet den Satz an den Pi Agent
- Spricht die Antwort per Pocket TTS
- Steuert Musik/Radio via mpv
- Exponiert HTTP API für Remote-Steuerung (Telegram etc.)

Whisper läuft lokal via MLX (Apple Silicon optimiert).
"""
import sounddevice as sd
import numpy as np
import requests
import tempfile
import wave
import sys
import os
import time
import subprocess
import signal
import json
import threading
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from http.server import HTTPServer, BaseHTTPRequestHandler

import mlx_whisper
from pocket_tts import TTSModel

# === Konfiguration ===
SAMPLE_RATE = 16000
# Wake-Word-Varianten: "roberto" ist ein echter Name → Whisper trifft ihn zuverlässiger
# als das Kunstwort "ribo". Mehrere Schreibweisen abfangen (Whisper schwankt).
WAKE_WORDS = ["roberto", "hey roberto"]
AGENT_URL = os.getenv("AGENT_URL", "http://localhost:8080/prompt")
LISTEN_SECONDS = 1.5
COMMAND_SECONDS = 30
SILENCE_THRESHOLD = 0.01
SILENCE_DURATION = 1.5
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "mlx-community/whisper-large-v3-mlx")
TTS_VOICE = os.getenv("TTS_VOICE", "juergen")
TTS_LANGUAGE = os.getenv("TTS_LANGUAGE", "german_24l")
MUSIC_PORT = int(os.getenv("MUSIC_PORT", "8085"))
MAX_RETRIES = 3
RETRY_DELAY = 2

# === Radio-Sender ===
RADIO_STATIONS = {
    # Kinder
    "radio teddy": "https://irmedia.streamabc.net/irm-rtlive-mp3-192-772966", # geht nicht

    # Bundesweit / Öffentlich-Rechtlich
    "deutschlandfunk": "https://st01.sslstream.dlf.de/dlf/01/128/mp3/stream.mp3", # geht
    "dlf kultur": "https://st02.sslstream.dlf.de/dlf/02/128/mp3/stream.mp3", # geht
    "dlf nova": "https://st03.sslstream.dlf.de/dlf/03/128/mp3/stream.mp3", # geht

    # WDR (NRW)
    "1live": "https://wdr-1live-live.icecastssl.wdr.de/wdr/1live/live/mp3/256/stream.mp3", # geht nicht 
    "wdr2": "https://wdr-wdr2-rheinland.icecastssl.wdr.de/wdr/wdr2/rheinland/mp3/256/stream.mp3", # geht nicht 
    "wdr3": "https://wdr-wdr3-live.icecastssl.wdr.de/wdr/wdr3/live/mp3/256/stream.mp3", # geht
    "wdr4": "https://wdr-wdr4-live.icecastssl.wdr.de/wdr/wdr4/live/mp3/256/stream.mp3",# geht nicht 
    "wdr5": "https://wdr-wdr5-live.icecastssl.wdr.de/wdr/wdr5/live/mp3/256/stream.mp3",# geht nicht 
    "1live diggi": "https://wdr-1live-diggi.icecastssl.wdr.de/wdr/1live/diggi/mp3/256/stream.mp3",# geht nicht 

    # SWR (Baden-Württemberg / Rheinland-Pfalz)
    "swr1": "https://liveradio.swr.de/sw282p3/swr1bw/play.mp3", # geht
    "swr3": "https://liveradio.swr.de/sw282p3/swr3/play.mp3", # geht
    "dasding": "https://liveradio.swr.de/sw282p3/dasding/play.mp3", # geht

    # NDR (Norddeutschland)
    "ndr1": "https://icecast.ndr.de/ndr/ndr1niedersachsen/hannover/mp3/128/stream.mp3", # geht
    "ndr2": "https://icecast.ndr.de/ndr/ndr2/niedersachsen/mp3/128/stream.mp3", # geht
    "ndr info": "https://icecast.ndr.de/ndr/ndrinfo/niedersachsen/mp3/128/stream.mp3", # geht
    "n-joy": "https://icecast.ndr.de/ndr/njoy/live/mp3/128/stream.mp3", # geht

    # BR (Bayern)
    "bayern 1": "https://dispatcher.rndfnk.com/br/br1/franken/mp3/mid", # geht
    "bayern 3": "https://dispatcher.rndfnk.com/br/br3/live/mp3/mid", # geht
    "br klassik": "https://dispatcher.rndfnk.com/br/brklassik/live/mp3/mid", # geht
    "puls": "https://dispatcher.rndfnk.com/br/puls/live/mp3/mid",  # geht nicht

    # HR (Hessen)
    "hr1": "https://dispatcher.rndfnk.com/hr/hr1/live/mp3/mid", # geht nicht
    "hr3": "https://dispatcher.rndfnk.com/hr/hr3/live/mp3/mid", # geht nicht
    "you fm": "https://dispatcher.rndfnk.com/hr/youfm/live/mp3/mid", # geht nicht

    # RBB (Berlin / Brandenburg)
    "fritz": "https://dispatcher.rndfnk.com/rbb/fritz/live/mp3/mid",
    "radioeins": "https://dispatcher.rndfnk.com/rbb/radioeins/live/mp3/mid", # geht
    "antenne brandenburg": "https://dispatcher.rndfnk.com/rbb/antennebrandenburg/live/mp3/mid",

    # MDR (Mitteldeutschland)
    "mdr jump": "https://dispatcher.rndfnk.com/mdr/jump/live/mp3/mid", # geht nicht
    "mdr sputnik": "https://dispatcher.rndfnk.com/mdr/sputnik/live/mp3/mid", # geht nicht

    # Privatsender
    "radio bob": "https://streams.radiobob.de/bob-live/mp3-192/mediaplayer",
    "rock antenne": "https://stream.rockantenne.de/rockantenne/stream/mp3",
    "sunshine live": "https://stream.sunshine-live.de/live/mp3-192/stream.mp3",
    "bigfm": "https://streams.bigfm.de/bigfm-deutschland-128-mp3",
    "antenne bayern": "https://stream.antenne.de/antenne/stream/mp3",
    "radio energy": "https://scdn.nrjaudio.fm/adwz2/de/30001/mp3_128.mp3", # geht nicht
    "ffn": "https://player.ffn.de/ffn.mp3",
    "radio hamburg": "https://player.radiohamburg.de/radiohamburg.mp3", # geht nicht
    "kiss fm": "https://streams.kissfm.de/kissfm/mp3-192/internetradio", # geht nicht
    "delta radio": "https://streams.deltaradio.de/deltaradio/mp3-192/mediaplayerstream",
    "radio paloma": "https://pool.radiopaloma.de/RADIOPALOMA.mp3",
    "klassik radio": "https://stream.klassikradio.de/live/mp3-192/stream.mp3",
    "absolut relax": "https://stream.absolutradio.de/absolut-relax/mp3-192/stream.mp3", # geht nicht
    "jam fm": "https://streams.jam.fm/jam-nmr/mp3-192/konsole", # geht nicht
    "harmony fm": "https://dispatcher.rndfnk.com/hr/harmonyfm/live/mp3/mid", # geht nicht

    # Chill / Lounge
    "lounge radio": "https://streams.fluxfm.de/Chillhop/mp3-320/streams.fluxfm.de/",
    "flux fm": "https://streams.fluxfm.de/live/mp3-320/streams.fluxfm.de/",

    # Genre-Streams
    "charts": "https://scdn.nrjaudio.fm/adwz2/de/30009/mp3_128.mp3", # geht nicht
    "top 40": "https://scdn.nrjaudio.fm/adwz2/de/30009/mp3_128.mp3", # geht nicht
    "hits": "https://streams.bigfm.de/bigfm-charts-128-mp3",
    "90er": "https://streams.bigfm.de/bigfm-90s-128-mp3",
    "80er": "https://streams.bigfm.de/bigfm-80s-128-mp3",
    "70er": "https://streams.bigfm.de/bigfm-70s-128-mp3",
    "rock": "https://stream.rockantenne.de/rockantenne/stream/mp3",
    "hip hop": "https://streams.bigfm.de/bigfm-hiphop-128-mp3",
    "electro": "https://stream.sunshine-live.de/live/mp3-192/stream.mp3",
    "schlager": "https://streams.schlagerpiloten.de/schlagerpiloten/mp3-192", # geht nicht
    "jazz": "https://streaming.radio.co/s774887f7b/listen",
    "klassik": "https://stream.klassikradio.de/live/mp3-192/stream.mp3",
    "chill": "https://streams.fluxfm.de/Chillhop/mp3-320/streams.fluxfm.de/",
    "deutsch pop": "https://streams.bigfm.de/bigfm-deutschrap-128-mp3",
}


# === Music Player ===
class MusicPlayer:
    """Steuert mpv als Subprocess für Musik/Radio-Wiedergabe."""

    def __init__(self):
        self.process = None
        self.current_station = None
        self.volume = 80

    def play(self, station_name=None, url=None):
        """Spielt einen Sender oder eine URL ab."""
        self.stop()

        if station_name:
            station_key = station_name.lower().strip()
            # Fuzzy match
            matched_url = None
            for name, stream_url in RADIO_STATIONS.items():
                if station_key in name or name in station_key:
                    matched_url = stream_url
                    self.current_station = name
                    break
            if not matched_url:
                return {"error": f"Sender '{station_name}' nicht gefunden", "available": list(RADIO_STATIONS.keys())}
            url = matched_url
        elif url:
            self.current_station = url
        else:
            return {"error": "Kein Sender oder URL angegeben"}

        try:
            # DIAGNOSE: stderr in Datei statt DEVNULL, --really-quiet raus → mpv-Fehler sichtbar.
            err_log = open("/tmp/mpv-ribo.log", "ab", buffering=0)
            err_log.write(f"\n=== play {url} @ {time.strftime('%H:%M:%S')} ===\n".encode())
            self.process = subprocess.Popen(
                ["mpv", "--no-video", f"--volume={self.volume}", url],
                stdout=subprocess.DEVNULL,
                stderr=err_log,
                preexec_fn=os.setsid,
            )
            # Kurz warten und prüfen ob mpv sofort stirbt
            time.sleep(2)
            rc = self.process.poll()
            if rc is not None:
                # mpv ist schon tot → Fehler aus dem Log lesen und ausgeben
                try:
                    with open("/tmp/mpv-ribo.log", "r") as f:
                        tail = "".join(f.readlines()[-15:])
                except Exception:
                    tail = "(Log nicht lesbar)"
                print(f"❌ mpv sofort beendet (exit={rc}). mpv-Ausgabe:\n{tail}", flush=True)
                self.process = None
                self.current_station = None
                return {"error": f"mpv beendete sich sofort (exit={rc}). Siehe /tmp/mpv-ribo.log"}
            return {"status": "playing", "station": self.current_station, "volume": self.volume}
        except FileNotFoundError:
            return {"error": "mpv nicht installiert – bitte 'brew install mpv' ausführen"}
        except Exception as e:
            return {"error": f"Wiedergabe fehlgeschlagen: {e}"}

    def stop(self):
        """Stoppt die aktuelle Wiedergabe."""
        if self.process:
            try:
                os.killpg(os.getpgid(self.process.pid), signal.SIGTERM)
            except (ProcessLookupError, OSError):
                pass
            self.process = None
            station = self.current_station
            self.current_station = None
            return {"status": "stopped", "was_playing": station}
        return {"status": "already_stopped"}

    def set_volume(self, volume):
        """Setzt die Lautstärke (0-100)."""
        self.volume = max(0, min(100, int(volume)))
        # Wenn gerade was spielt, neu starten mit neuer Lautstärke
        if self.process and self.current_station:
            station = self.current_station
            # Finde URL für aktuellen Sender
            url = RADIO_STATIONS.get(station, station)
            self.stop()
            self.play(url=url)
        return {"status": "volume_set", "volume": self.volume}

    def status(self):
        """Gibt den aktuellen Status zurück."""
        is_playing = self.process is not None and self.process.poll() is None
        if not is_playing and self.process:
            self.process = None
            self.current_station = None
        return {
            "playing": is_playing,
            "station": self.current_station,
            "volume": self.volume,
            "available_stations": list(RADIO_STATIONS.keys()),
        }


# === Audio Ducker ===
class AudioDucker:
    """Reduziert Musiklautstärke während TTS/Alarm und stellt sie danach wieder her."""

    def __init__(self, player: MusicPlayer, duck_level: float = 0.2):
        """
        Args:
            player: MusicPlayer instance to control volume on
            duck_level: fraction of current volume to duck to (0.05–0.50, default 0.2)
        """
        self.player = player
        self.duck_level = max(0.05, min(0.50, duck_level))
        self._pre_duck_volume = None
        self._ducked = False
        self._restore_timer = None
        self._lock = threading.Lock()

    def duck(self) -> None:
        """Reduce volume to duck_level. Must complete in <200ms.
        
        Only ducks if music is currently playing. If a restore is in progress,
        cancels it and re-ducks from current volume.
        """
        with self._lock:
            # Cancel any pending restoration (Req 3.6: re-duck if TTS starts during restoration)
            if self._restore_timer is not None:
                self._restore_timer.cancel()
                self._restore_timer = None

            # Check if music is actually playing (Req 3.3: no ducking when stopped)
            if not self._is_music_playing():
                return

            # If already ducked, don't re-store the pre-duck volume
            if not self._ducked:
                self._pre_duck_volume = self.player.volume

            # Calculate ducked volume
            ducked_volume = int(self._pre_duck_volume * self.duck_level)
            ducked_volume = max(1, ducked_volume)  # Ensure at least volume 1

            # Apply ducked volume via mpv restart (existing pattern)
            self._set_volume_fast(ducked_volume)
            self._ducked = True

    def restore(self) -> None:
        """Restore volume to pre-duck level. Must complete in <500ms.
        
        If music stopped during TTS, cancels restoration (Req 3.4).
        """
        with self._lock:
            if not self._ducked:
                return

            # Req 3.4: If music stopped during TTS, cancel restoration
            if not self._is_music_playing():
                self._ducked = False
                self._pre_duck_volume = None
                return

            # Restore original volume
            if self._pre_duck_volume is not None:
                self._set_volume_fast(self._pre_duck_volume)

            self._ducked = False
            self._pre_duck_volume = None

    def is_ducked(self) -> bool:
        """Returns True if currently in ducked state."""
        return self._ducked

    def _is_music_playing(self) -> bool:
        """Check if mpv process is running."""
        return (
            self.player.process is not None
            and self.player.process.poll() is None
        )

    def _set_volume_fast(self, volume: int) -> None:
        """Set volume by restarting mpv with new volume flag (existing pattern).
        
        This restarts the current stream at the new volume level.
        Designed to complete quickly for sub-200ms ducking.
        """
        volume = max(0, min(100, int(volume)))
        self.player.volume = volume

        # If currently playing, restart with new volume
        if self._is_music_playing() and self.player.current_station:
            station = self.player.current_station
            # Find URL for current station
            url = RADIO_STATIONS.get(station, station)

            # Kill current process
            try:
                os.killpg(os.getpgid(self.player.process.pid), signal.SIGTERM)
            except (ProcessLookupError, OSError):
                pass
            self.player.process = None

            # Restart with new volume
            try:
                self.player.process = subprocess.Popen(
                    ["mpv", "--no-video", f"--volume={volume}", "--really-quiet", url],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    preexec_fn=os.setsid,
                )
                # Preserve current_station (it was already set)
                self.player.current_station = station
            except (FileNotFoundError, Exception):
                pass


# === Timer Service ===
@dataclass
class TimerEntry:
    """Represents an active countdown timer."""
    name: str                    # User-given or auto-generated name
    duration_seconds: int        # 1–86400
    start_time: float            # time.time() at creation
    timer_ref: threading.Timer   # Reference to cancel

    @property
    def remaining_seconds(self) -> float:
        elapsed = time.time() - self.start_time
        return max(0, self.duration_seconds - elapsed)

    @property
    def expires_at(self) -> str:
        return (datetime.now() + timedelta(seconds=self.remaining_seconds)).isoformat()


class TimerService:
    """Manages countdown timers with alarm playback on expiry."""

    MAX_TIMERS = 10
    MIN_DURATION = 1
    MAX_DURATION = 86400  # 24 hours in seconds
    ALARM_DURATION = 10  # seconds to play alarm

    def __init__(self, ducker: AudioDucker):
        self._ducker = ducker
        self._timers: dict[str, TimerEntry] = {}
        self._lock = threading.Lock()
        self._counter = 0  # For auto-generating timer names

    def create_timer(self, name: str = None, duration_seconds: int = 0) -> dict:
        """Create a new countdown timer.

        Args:
            name: Optional timer name. Auto-generated if not provided.
            duration_seconds: Duration in seconds (1–86400).

        Returns:
            dict with status, name, and expires_at on success, or error message.
        """
        # Validate duration
        if not isinstance(duration_seconds, (int, float)):
            return {"error": "Ungültiges Zeitformat"}
        duration_seconds = int(duration_seconds)
        if duration_seconds < self.MIN_DURATION or duration_seconds > self.MAX_DURATION:
            return {"error": "Ungültiges Zeitformat. Erlaubt: 1 Sekunde bis 24 Stunden."}

        with self._lock:
            # Check max timer limit
            if len(self._timers) >= self.MAX_TIMERS:
                return {"error": "Maximale Anzahl an Timern erreicht (10). Bitte einen bestehenden Timer abbrechen."}

            # Auto-generate name if not provided
            if not name or not name.strip():
                self._counter += 1
                name = f"Timer {self._counter}"
            else:
                name = name.strip()

            # Check for duplicate name
            if name in self._timers:
                return {"error": f"Ein Timer mit dem Namen '{name}' existiert bereits."}

            # Create the timer thread
            timer_ref = threading.Timer(duration_seconds, self._on_timer_expired, args=[name])
            timer_ref.daemon = True

            entry = TimerEntry(
                name=name,
                duration_seconds=duration_seconds,
                start_time=time.time(),
                timer_ref=timer_ref,
            )
            self._timers[name] = entry
            timer_ref.start()

        return {"status": "created", "name": name, "expires_at": entry.expires_at}

    def cancel_timer(self, name: str) -> dict:
        """Cancel an active timer by name.

        Args:
            name: The name of the timer to cancel.

        Returns:
            dict with status and cancelled_name, or error message.
        """
        if not name or not name.strip():
            return {"error": "Kein Timer-Name angegeben."}
        name = name.strip()

        with self._lock:
            if name not in self._timers:
                active_names = list(self._timers.keys())
                if active_names:
                    return {"error": f"Kein Timer mit dem Namen '{name}' gefunden. Aktive Timer: {', '.join(active_names)}"}
                return {"error": f"Kein Timer mit dem Namen '{name}' gefunden. Es sind keine Timer aktiv."}

            entry = self._timers.pop(name)
            entry.timer_ref.cancel()

        return {"status": "cancelled", "cancelled_name": name}

    def list_timers(self) -> dict:
        """List all active timers with remaining time.

        Returns:
            dict with list of timers (name and remaining_seconds).
        """
        with self._lock:
            # Clean up expired timers that haven't been removed yet
            expired = [name for name, entry in self._timers.items() if entry.remaining_seconds <= 0]
            for name in expired:
                self._timers.pop(name, None)

            timers = [
                {"name": entry.name, "remaining_seconds": round(entry.remaining_seconds, 1)}
                for entry in self._timers.values()
            ]

        return {"timers": timers}

    def _on_timer_expired(self, name: str) -> None:
        """Called when a timer expires. Plays alarm sound with ducking."""
        # Remove from active timers
        with self._lock:
            self._timers.pop(name, None)

        print(f"⏰ Timer '{name}' abgelaufen!")

        # Check if music is playing and duck if so
        music_playing = (
            self._ducker.player.process is not None
            and self._ducker.player.process.poll() is None
        )

        if music_playing:
            self._ducker.duck()

        try:
            self._play_alarm()
        finally:
            if music_playing:
                self._ducker.restore()

    def _play_alarm(self) -> None:
        """Play alarm sound via mpv subprocess.

        Uses alarm.wav if available, otherwise generates a sine wave tone.
        """
        alarm_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "alarm.wav")

        try:
            if os.path.exists(alarm_file):
                # Play alarm.wav via mpv
                proc = subprocess.Popen(
                    ["mpv", "--no-video", "--really-quiet", alarm_file],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                # Wait for alarm to finish (max ALARM_DURATION seconds)
                try:
                    proc.wait(timeout=self.ALARM_DURATION)
                except subprocess.TimeoutExpired:
                    proc.terminate()
            else:
                # Fallback: generate sine wave tone via mpv's lavfi
                # Generate a beeping pattern for ALARM_DURATION seconds
                proc = subprocess.Popen(
                    [
                        "mpv",
                        "--no-video",
                        "--really-quiet",
                        f"--length={self.ALARM_DURATION}",
                        "av://lavfi/sine=frequency=880:duration=" + str(self.ALARM_DURATION),
                    ],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                try:
                    proc.wait(timeout=self.ALARM_DURATION + 2)
                except subprocess.TimeoutExpired:
                    proc.terminate()
        except FileNotFoundError:
            # mpv not installed - fallback to system beep via numpy/sounddevice
            print("⚠️  mpv nicht gefunden für Alarm-Ton. Verwende System-Fallback.")
            self._play_fallback_tone()
        except Exception as e:
            print(f"⚠️  Alarm-Fehler: {e}")
            self._play_fallback_tone()

    def _play_fallback_tone(self) -> None:
        """Fallback alarm using sounddevice if mpv is unavailable."""
        try:
            import sounddevice as sd
            import numpy as np
            sr = 16000
            duration = self.ALARM_DURATION
            # Generate beeping pattern: 0.3s tone, 0.2s silence
            samples = np.array([], dtype=np.float32)
            t_tone = np.arange(int(0.3 * sr)) / sr
            tone = (np.sin(2 * np.pi * 880 * t_tone) * 0.5).astype(np.float32)
            silence = np.zeros(int(0.2 * sr), dtype=np.float32)
            pattern = np.concatenate([tone, silence])
            repeats = int(duration / 0.5)
            samples = np.tile(pattern, repeats)
            sd.play(samples, samplerate=sr)
            sd.wait()
        except Exception as e:
            print(f"⚠️  Fallback-Alarm fehlgeschlagen: {e}")


# Globale Instanzen
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
            return json.loads(self.rfile.read(content_length))
        return {}

    def do_GET(self):
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
                "service": "hey-ribo",
                "active_timers": active_timers
            })
        else:
            self._send_json({"error": "not found"}, 404)

    def do_POST(self):
        if self.path == "/tts":
            # TTS endpoint: Text → .ogg audio file
            content_length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(content_length)) if content_length else {}
            text = body.get("text")
            if not text:
                self._send_json({"error": "text required"}, 400)
                return
            try:
                audio = tts_model.generate_audio(voice_state, text)
                audio_np = audio.numpy()
                # Write WAV to temp file, then convert to OGG via ffmpeg
                with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as wav_f:
                    wav_path = wav_f.name
                    with wave.open(wav_f.name, "w") as wf:
                        wf.setnchannels(1)
                        wf.setsampwidth(2)
                        wf.setframerate(tts_model.sample_rate)
                        wf.writeframes((audio_np * 32767).astype(np.int16).tobytes())

                ogg_path = wav_path.replace(".wav", ".ogg")
                subprocess.run(
                    ["ffmpeg", "-y", "-i", wav_path, "-c:a", "libopus", "-b:a", "64k", "-ar", "48000", ogg_path],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True
                )
                os.unlink(wav_path)

                # Send OGG file as binary response
                with open(ogg_path, "rb") as f:
                    ogg_data = f.read()
                os.unlink(ogg_path)

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
                # Save uploaded audio to temp file
                suffix = ".ogg" if "ogg" in content_type else ".wav"
                with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp_f:
                    tmp_path = tmp_f.name
                    tmp_f.write(audio_data)

                # Convert to WAV if not already WAV (ffmpeg handles ogg, opus, etc.)
                wav_path = tmp_path + ".wav"
                subprocess.run(
                    ["ffmpeg", "-y", "-i", tmp_path, "-ar", "16000", "-ac", "1", "-f", "wav", wav_path],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True
                )
                os.unlink(tmp_path)

                # Transcribe via MLX Whisper
                result = mlx_whisper.transcribe(
                    wav_path,
                    path_or_hf_repo=WHISPER_MODEL,
                    language="de",
                )
                os.unlink(wav_path)

                text = result.get("text", "").strip()
                self._send_json({"text": text})
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
            if not text:
                self._send_json({"error": "text required"}, 400)
            else:
                # Run TTS in a background thread to avoid blocking the HTTP response
                tts_thread = threading.Thread(
                    target=speak_with_ducking, args=(text,), daemon=True
                )
                tts_thread.start()
                self._send_json({"status": "ok", "message": "Speaking..."})
        else:
            self._send_json({"error": "not found"}, 404)


def start_music_api():
    """Startet den Music HTTP Server in einem Thread."""
    server = HTTPServer(("0.0.0.0", MUSIC_PORT), MusicAPIHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(f"🎵 Music API auf Port {MUSIC_PORT}")
    return server


# === Audio / Whisper / TTS ===
print(f"🧠 Lade Whisper ({WHISPER_MODEL})...")
print("🔊 Lade Pocket TTS...")
tts_model = TTSModel.load_model(language=TTS_LANGUAGE)
voice_state = tts_model.get_state_for_audio_prompt(TTS_VOICE)


def check_audio_device():
    """Prüft ob ein Eingabegerät verfügbar ist."""
    try:
        default_input = sd.query_devices(kind="input")
        print(f"🎙️  Mikrofon: {default_input['name']}")
        return True
    except sd.PortAudioError as e:
        print(f"❌ Kein Mikrofon gefunden: {e}")
        print("   Bitte USB-Mikrofon anschließen und erneut starten.")
        return False


def record_chunk(duration):
    audio = sd.rec(int(duration * SAMPLE_RATE), samplerate=SAMPLE_RATE, channels=1, dtype="float32")
    sd.wait()
    return audio.flatten()


def record_until_silence(max_duration=COMMAND_SECONDS):
    print("🎤 Höre zu...")
    chunks = []
    silent_chunks = 0
    chunk_dur = 0.5
    max_chunks = int(max_duration / chunk_dur)
    silence_chunks_needed = int(SILENCE_DURATION / chunk_dur)

    for _ in range(max_chunks):
        chunk = record_chunk(chunk_dur)
        chunks.append(chunk)
        if np.abs(chunk).mean() < SILENCE_THRESHOLD:
            silent_chunks += 1
            if silent_chunks >= silence_chunks_needed and len(chunks) > silence_chunks_needed:
                break
        else:
            silent_chunks = 0

    return np.concatenate(chunks)


def transcribe(audio):
    """Transkribiert Audio via MLX Whisper (Apple Silicon Metal)."""
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            tmp_path = f.name
            with wave.open(f.name, "w") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(SAMPLE_RATE)
                wf.writeframes((audio * 32767).astype(np.int16).tobytes())
        result = mlx_whisper.transcribe(
            tmp_path,
            path_or_hf_repo=WHISPER_MODEL,
            language="de",
        )
        text = result.get("text", "")
        return text.strip().lower()
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


def send_to_agent(text):
    """Sendet an den Agent mit Retry-Logik."""
    for attempt in range(MAX_RETRIES):
        try:
            resp = requests.post(AGENT_URL, json={"message": text}, timeout=120)
            resp.raise_for_status()
            return resp.json().get("response", "")
        except requests.exceptions.ConnectionError:
            if attempt < MAX_RETRIES - 1:
                print(f"⚠️  Agent nicht erreichbar, Versuch {attempt + 2}/{MAX_RETRIES}...")
                time.sleep(RETRY_DELAY)
            else:
                print("❌ Agent nicht erreichbar nach mehreren Versuchen.")
                return "Entschuldigung, ich kann den Agent gerade nicht erreichen."
        except requests.exceptions.Timeout:
            print("⏱️  Timeout – Agent antwortet nicht.")
            return "Entschuldigung, die Anfrage hat zu lange gedauert."
        except requests.exceptions.RequestException as e:
            print(f"❌ Request-Fehler: {e}")
            return "Entschuldigung, es gab einen Fehler bei der Kommunikation."


def speak(text):
    """Spricht Text via Pocket TTS (ohne Ducking)."""
    if not text:
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
    if not text:
        return
    ducker.duck()
    try:
        speak(text)
    finally:
        ducker.restore()


def play_tone(frequency, duration=0.15, volume=0.3):
    """Spielt einen Signalton ab."""
    tone = np.sin(2 * np.pi * frequency * np.arange(int(duration * SAMPLE_RATE)) / SAMPLE_RATE).astype(np.float32) * volume
    sd.play(tone, samplerate=SAMPLE_RATE)
    sd.wait()


def check_ffmpeg():
    """Prüft ob ffmpeg installiert ist (benötigt für /tts und /transcribe Endpoints)."""
    try:
        subprocess.run(["ffmpeg", "-version"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        print("⚠️  ffmpeg nicht gefunden — /tts und /transcribe Endpoints werden nicht funktionieren")
        print("   Installieren mit: brew install ffmpeg")
        return False


def main():
    check_audio_device()

    check_ffmpeg()

    # Music API starten
    start_music_api()

    print(f"🤖 Roberto wartet auf 'Roberto'...")
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
        sys.exit(0)


def parse_german_duration(text):
    """
    Parst deutsche Zeitangaben und gibt die Dauer in Sekunden zurück.
    Unterstützt: "5 Minuten", "30 Sekunden", "eine Stunde", "in 10 Minuten",
    "eineinhalb Stunden", "anderthalb Minuten", etc.
    Gibt None zurück wenn nichts erkannt wurde.
    """
    import re

    text = text.lower().strip()

    # Zahlwörter auf Deutsch
    number_words = {
        "eine": 1, "ein": 1, "eins": 1, "einer": 1,
        "zwei": 2, "drei": 3, "vier": 4, "fünf": 5,
        "sechs": 6, "sieben": 7, "acht": 8, "neun": 9,
        "zehn": 10, "elf": 11, "zwölf": 12, "dreizehn": 13,
        "vierzehn": 14, "fünfzehn": 15, "zwanzig": 20,
        "dreißig": 30, "dreissig": 30, "vierzig": 40,
        "fünfzig": 50, "sechzig": 60, "halbe": 0.5, "halb": 0.5,
        "eineinhalb": 1.5, "anderthalb": 1.5,
    }

    # Einheiten-Multiplikatoren
    unit_map = {
        "sekunde": 1, "sekunden": 1, "sek": 1,
        "minute": 60, "minuten": 60, "min": 60,
        "stunde": 3600, "stunden": 3600,
    }

    total_seconds = 0
    found = False

    # Pattern: Zahl + Einheit (z.B. "5 Minuten", "30 Sekunden")
    # Auch: Zahlwort + Einheit (z.B. "eine Stunde", "fünf Minuten")
    pattern = r'(\d+(?:[.,]\d+)?|' + '|'.join(re.escape(w) for w in number_words.keys()) + r')\s*(sekunden?|minuten?|stunden?|sek|min)'

    matches = re.findall(pattern, text)
    for num_str, unit_str in matches:
        # Zahl ermitteln
        if num_str in number_words:
            number = number_words[num_str]
        else:
            try:
                number = float(num_str.replace(',', '.'))
            except ValueError:
                continue

        # Einheit ermitteln
        unit_key = unit_str.lower()
        multiplier = None
        for key, mult in unit_map.items():
            if unit_key.startswith(key) or key.startswith(unit_key):
                multiplier = mult
                break

        if multiplier is not None:
            total_seconds += number * multiplier
            found = True

    if found and total_seconds > 0:
        return int(total_seconds)

    return None


def format_remaining_time(seconds):
    """Formatiert verbleibende Sekunden als deutsche Zeitangabe."""
    seconds = int(seconds)
    if seconds <= 0:
        return "abgelaufen"

    parts = []
    if seconds >= 3600:
        hours = seconds // 3600
        seconds %= 3600
        parts.append(f"{hours} Stunde{'n' if hours != 1 else ''}")
    if seconds >= 60:
        minutes = seconds // 60
        seconds %= 60
        parts.append(f"{minutes} Minute{'n' if minutes != 1 else ''}")
    if seconds > 0:
        parts.append(f"{seconds} Sekunde{'n' if seconds != 1 else ''}")

    return " und ".join(parts) if len(parts) <= 2 else ", ".join(parts[:-1]) + " und " + parts[-1]


def handle_local_timer_command(prompt):
    """
    Verarbeitet Timer-Befehle direkt lokal (ohne Agent-Roundtrip).
    Gibt True zurück wenn der Befehl erkannt wurde.
    """
    prompt_lower = prompt.lower().strip()

    # --- Timer abbrechen / stoppen ---
    cancel_patterns = ["timer stopp", "timer stop", "timer abbrechen", "timer aus",
                       "stopp den timer", "stop den timer", "timer löschen",
                       "breche den timer ab", "timer beenden"]
    for pattern in cancel_patterns:
        if pattern in prompt_lower:
            # Versuche Timer-Name aus dem Befehl zu extrahieren
            timers = timer_service.list_timers()
            active = timers.get("timers", [])
            if not active:
                speak_with_ducking("Es läuft gerade kein Timer.")
                return True
            if len(active) == 1:
                # Nur ein Timer aktiv → den abbrechen
                result = timer_service.cancel_timer(active[0]["name"])
                if "error" not in result:
                    speak_with_ducking(f"Okay, Timer {result['cancelled_name']} abgebrochen.")
                else:
                    speak_with_ducking(result["error"])
            else:
                # Mehrere Timer → den letzten abbrechen oder nach Name suchen
                # Versuche Name zu finden
                result = timer_service.cancel_timer(active[-1]["name"])
                if "error" not in result:
                    speak_with_ducking(f"Okay, Timer {result['cancelled_name']} abgebrochen.")
                else:
                    speak_with_ducking(result["error"])
            return True

    # --- Timer-Status abfragen ---
    status_patterns = ["welche timer laufen", "timer status", "wie lange noch",
                       "welche timer gibt es", "aktive timer", "timer liste",
                       "wie viele timer"]
    for pattern in status_patterns:
        if pattern in prompt_lower:
            result = timer_service.list_timers()
            active = result.get("timers", [])
            if not active:
                speak_with_ducking("Es läuft gerade kein Timer.")
            elif len(active) == 1:
                t = active[0]
                remaining = format_remaining_time(t["remaining_seconds"])
                speak_with_ducking(f"{t['name']} läuft noch {remaining}.")
            else:
                parts = []
                for t in active:
                    remaining = format_remaining_time(t["remaining_seconds"])
                    parts.append(f"{t['name']} noch {remaining}")
                speak_with_ducking(f"Es laufen {len(active)} Timer: " + ". ".join(parts) + ".")
            return True

    # --- Timer erstellen ---
    create_patterns = [
        "stell einen timer", "stell ein timer", "stelle einen timer", "stelle ein timer",
        "timer auf", "timer für", "timer stellen",
        "weck mich in", "wecke mich in", "erinner mich in",
        "in "  # "in 5 Minuten" am Anfang
    ]

    is_timer_create = False
    duration_text = prompt_lower

    for pattern in create_patterns:
        if pattern in prompt_lower:
            is_timer_create = True
            # Text nach dem Pattern als Dauer-Text verwenden
            idx = prompt_lower.find(pattern)
            duration_text = prompt_lower[idx + len(pattern):].strip()
            break

    # Auch einfache Muster: "5 Minuten Timer", "Timer 10 Minuten"
    if not is_timer_create:
        import re
        if re.search(r'\d+\s*(minuten?|sekunden?|stunden?)\s*timer', prompt_lower):
            is_timer_create = True
            duration_text = prompt_lower
        elif re.search(r'timer\s*\d+\s*(minuten?|sekunden?|stunden?)', prompt_lower):
            is_timer_create = True
            duration_text = prompt_lower

    if is_timer_create:
        duration = parse_german_duration(duration_text)
        if duration is None:
            # Versuche nochmal mit dem vollen prompt
            duration = parse_german_duration(prompt_lower)

        if duration is None:
            speak_with_ducking("Ich habe die Zeitangabe nicht verstanden. Sag zum Beispiel: Stell einen Timer auf 5 Minuten.")
            return True

        if duration < 1 or duration > 86400:
            speak_with_ducking("Die Dauer muss zwischen einer Sekunde und 24 Stunden liegen.")
            return True

        result = timer_service.create_timer(duration_seconds=duration)
        if "error" in result:
            speak_with_ducking(result["error"])
        else:
            formatted = format_remaining_time(duration)
            speak_with_ducking(f"Okay, Timer gestellt auf {formatted}.")
        return True

    return False


def handle_local_music_command(prompt):
    """
    Verarbeitet Musik-Befehle direkt lokal (ohne Agent-Roundtrip).
    Gibt True zurück wenn der Befehl erkannt wurde.
    """
    prompt_lower = prompt.lower().strip()

    # Stopp-Befehle
    stop_words = ["stopp", "stop", "musik aus", "radio aus", "aufhören", "sei still", "ruhe"]
    if any(word in prompt_lower for word in stop_words):
        result = player.stop()
        if result.get("was_playing"):
            speak_with_ducking(f"Okay, {result['was_playing']} gestoppt.")
        else:
            speak_with_ducking("Es läuft gerade nichts.")
        return True

    # Play-Befehle
    play_prefixes = ["spiel", "spiele", "play", "starte"]
    for prefix in play_prefixes:
        if prompt_lower.startswith(prefix):
            rest = prompt_lower[len(prefix):].strip()
            # "spiel radio teddy" → "radio teddy"
            result = player.play(station_name=rest)
            if "error" in result:
                # Fuzzy: probiere ohne "radio" prefix
                if rest.startswith("radio "):
                    result = player.play(station_name=rest)
                if "error" in result:
                    available = ", ".join(RADIO_STATIONS.keys())
                    speak_with_ducking(f"Den Sender kenne ich nicht. Verfügbar sind: {available}")
            else:
                speak_with_ducking(f"Okay, ich spiele {result['station']}.")
            return True

    # Lautstärke
    if "lauter" in prompt_lower or "volume up" in prompt_lower:
        player.set_volume(player.volume + 20)
        speak_with_ducking(f"Lautstärke auf {player.volume} Prozent.")
        return True
    if "leiser" in prompt_lower or "volume down" in prompt_lower:
        player.set_volume(player.volume - 20)
        speak_with_ducking(f"Lautstärke auf {player.volume} Prozent.")
        return True

    # Status
    if "was läuft" in prompt_lower or "was spielt" in prompt_lower:
        status = player.status()
        if status["playing"]:
            speak_with_ducking(f"Es läuft {status['station']} mit Lautstärke {status['volume']}.")
        else:
            speak_with_ducking("Es läuft gerade nichts.")
        return True

    return False


if __name__ == "__main__":
    main()
