"""Music playback and volume ducking; no TTS or HTTP dependencies."""
import os
import signal
import subprocess
import threading
import time
from urllib.parse import urlparse
from .stations import RADIO_STATIONS

class MusicPlayer:
    """Steuert mpv als Subprocess für Musik/Radio-Wiedergabe."""

    def __init__(self):
        self.process = None
        self.current_station = None
        self.volume = 80

    def play(self, station_name=None, url=None):
        """Spielt einen Sender oder eine URL ab."""
        if station_name is not None and not isinstance(station_name, str):
            return {"error": "Sendername muss Text sein"}
        if url is not None and (not isinstance(url, str) or urlparse(url).scheme not in ("http", "https")):
            return {"error": "Nur HTTP(S)-Stream-Adressen sind erlaubt"}
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
            with open("/tmp/mpv-ribo.log", "ab", buffering=0) as err_log:
                err_log.write(f"\n=== play {url} @ {time.strftime('%H:%M:%S')} ===\n".encode())
                self.process = subprocess.Popen(
                    ["mpv", "--no-video", f"--volume={self.volume}", url],
                    stdout=subprocess.DEVNULL,
                    stderr=err_log,
                    start_new_session=True,
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
                    start_new_session=True,
                )
                # Preserve current_station (it was already set)
                self.player.current_station = station
            except (FileNotFoundError, Exception):
                pass

