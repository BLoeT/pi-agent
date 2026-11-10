"""Single caller worker client; protected by the HTTP generation lock."""
import atexit
import json
import select
import subprocess
import sys
import time
from pathlib import Path


class ModelWorker:
    def __init__(self, worker_path=None):
        self.process = None
        self.key = None
        self.worker_path = worker_path or Path(__file__).with_name("model_worker.py")
        atexit.register(self.close)

    def close(self):
        if self.process:
            process, self.process = self.process, None
            process.stdin.close()
            if process.poll() is None:
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    process.terminate()
                    try:
                        process.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
            process.stdout.close()

    def generate(self, job, timeout=1200, cancel_event=None):
        if cancel_event is not None and cancel_event.is_set():
            raise RuntimeError("Generierung abgebrochen")
        key = (job["model"], job["quantize"])
        if self.process is None or self.process.poll() is not None or key != self.key:
            self.close()
            self.process = subprocess.Popen([sys.executable, "-u", str(self.worker_path)],
                                            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                            text=True, bufsize=1)
            self.key = key
        try:
            self.process.stdin.write(json.dumps(job) + "\n")
            self.process.stdin.flush()
            deadline = time.monotonic() + timeout
            while not select.select([self.process.stdout], [], [], .1)[0]:
                if cancel_event is not None and cancel_event.is_set():
                    raise RuntimeError("Generierung abgebrochen")
                if time.monotonic() > deadline:
                    raise TimeoutError("Bildgenerierung hat das Zeitlimit überschritten")
            line = self.process.stdout.readline()
            if not line:
                raise RuntimeError("Bild-Worker wurde beendet; bitte erneut versuchen")
            result = json.loads(line)
            if result.get("error"):
                self.close()
            return result
        except Exception:
            self.close()
            raise
