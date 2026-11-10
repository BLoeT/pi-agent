"""Timer state and alarm playback, independent of the TTS model and HTTP API."""
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
import os
import subprocess
import threading
import time
from .music import AudioDucker

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

    def close(self) -> None:
        """Cancel outstanding callbacks before the service exits."""
        with self._lock:
            for entry in self._timers.values():
                entry.timer_ref.cancel()
            self._timers.clear()

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
        alarm_file = str(Path(__file__).resolve().parents[2] / "alarm.wav")

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

