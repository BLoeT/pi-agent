"""Bounded native process execution and request-scoped cancellation state."""
import os
import json
import signal
import subprocess
import tempfile
import time
from threading import Lock, local

generation_lock = Lock()
job_lock = Lock()
jobs = {}
early_cancels = {}
job_context = local()

def run_generation(command, timeout, cwd):
    cancel = getattr(job_context, "cancel", None)
    started = time.monotonic()
    if cancel is not None and cancel.is_set():
        raise RuntimeError("Generierung abgebrochen")
    with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
        process = subprocess.Popen(command, cwd=cwd, stdout=stdout, stderr=stderr, start_new_session=True)
        try:
            while process.poll() is None:
                if cancel is not None and cancel.wait(.1):
                    raise RuntimeError("Generierung abgebrochen")
                if cancel is None:
                    time.sleep(.1)
                if time.monotonic()-started > timeout:
                    raise subprocess.TimeoutExpired(command, timeout)
            stdout.seek(0); stderr.seek(0)
            return subprocess.CompletedProcess(command,process.returncode,stdout.read(65536).decode(errors="replace"),stderr.read(65536).decode(errors="replace"))
        finally:
            if process.poll() is None:
                os.killpg(process.pid,signal.SIGTERM)
                try: process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid,signal.SIGKILL);process.wait()




def cleanup_outputs(outputs):
    """Best-effort cleanup must never retain the generation lock on a file error."""
    failures = 0
    for output in outputs:
        try:
            os.unlink(output)
        except FileNotFoundError:
            pass
        except OSError as error:
            failures += 1
            print(json.dumps({"event": "output_cleanup_failed", "code": error.errno}))
    return failures
