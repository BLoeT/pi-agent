#!/usr/bin/env python3
"""Start native Ribo services once; identify running services by their health API."""
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import time
from urllib.request import build_opener, ProxyHandler
from urllib.error import URLError

ROOT = Path(__file__).resolve().parents[1]
OPENER = build_opener(ProxyHandler({}))
SERVICES = [
    (8085, "hey-ribo.py", "voice", "Ribo Audio", {"ribo-audio", "hey-ribo"}),
    (8086, "imagegen-service/server.py", "imagegen", "Imagegen", {"imagegen"}),
]


def healthy(port, expected):
    try:
        with OPENER.open(f"http://127.0.0.1:{port}/health", timeout=2) as response:
            data = json.load(response)
            return data.get("status") == "ok" and data.get("service") in expected
    except URLError as error:
        if isinstance(error.reason, PermissionError):
            raise RuntimeError("Lokaler Netzwerkzugriff ist nicht erlaubt; Dienststatus kann nicht geprüft werden.") from error
        return False
    except (OSError, ValueError):
        return False


def occupied(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=1):
            return True
    except ConnectionRefusedError:
        return False
    except OSError as error:
        raise RuntimeError(f"Port {port} kann nicht zuverlässig geprüft werden: {error}") from error


def main():
    uv = shutil.which("uv")
    if not uv and Path("/opt/homebrew/bin/uv").is_file():
        uv = "/opt/homebrew/bin/uv"
    logs = ROOT / ".logs"
    logs.mkdir(exist_ok=True)
    for port, script, log_name, label, expected in SERVICES:
        if healthy(port, expected):
            print(f"✓ {label} läuft bereits (Port {port})", flush=True)
            continue
        if occupied(port):
            raise RuntimeError(f"Port {port} ist belegt, aber {label} meldet sich nicht bereit. Kein zweiter Prozess gestartet.")
        if not uv:
            raise RuntimeError("uv wurde nicht gefunden.")
        if not (ROOT / ".env").is_file():
            raise RuntimeError(".env fehlt. Zuerst die Sicherheitskonfiguration einrichten.")
        log_path = logs / (log_name + ".log")
        print(f"→ Starte {label} im Hintergrund …", flush=True)
        with log_path.open("ab") as log:
            child = subprocess.Popen(
                [uv, "run", "--env-file", str(ROOT / ".env"), "--locked", script],
                cwd=ROOT, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                start_new_session=True, env={**os.environ, "PYTHONUNBUFFERED": "1"})
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            if child.poll() is not None:
                raise RuntimeError(f"{label} wurde beendet. Details: {log_path}")
            if healthy(port, expected):
                print(f"✓ {label} bereit (Port {port}); Log: {log_path}", flush=True)
                break
            time.sleep(.5)
        else:
            raise RuntimeError(f"{label} ist noch nicht bereit. Prozess bleibt zur Diagnose aktiv; Log: {log_path}")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError) as error:
        print(f"❌ {error}", flush=True)
        raise SystemExit(1)
