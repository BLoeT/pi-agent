"""Authenticated HTTP adapter for native image/video generation."""
import json
import os
from http.server import BaseHTTPRequestHandler
from pathlib import Path
import sys
import signal
import time
from threading import Event
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ribo_service_security import authorize, validate_length, validate_generation, configure
from ribo_runtime import BoundedHTTPServer
from engines import ENGINES
from jobs import generation_lock, job_lock, jobs, early_cancels, job_context, run_generation, cleanup_outputs
from pipeline import ImagePipeline
from service_config import ImagegenConfig

configure()
config = ImagegenConfig.from_env()
pipeline = ImagePipeline(config)
# Explicit injectable callables for HTTP integration tests and compatibility.
generate_image = pipeline.generate_image
generate_video = pipeline.generate_video

class Handler(BaseHTTPRequestHandler):

    def _send_json(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Vary", "Origin")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path != "/health" and not authorize(self):
            return
        if self.path == "/health":
            self._send_json(200, {"status": "ok", "service": "imagegen", "port": config.port})
        elif self.path == "/engines":
            self._send_json(200, {
                "default": config.default_engine,
                "engines": {name: cfg["label"] for name, cfg in ENGINES.items()},
            })
        elif self.path == "/models":
            self._send_json(200, {
                name: cfg.get("models", []) for name, cfg in ENGINES.items()
            })
        else:
            self._send_json(404, {"error": "Nicht gefunden"})

    def do_POST(self):
        if not authorize(self) or not validate_length(self):
            return
        if self.path not in ("/generate", "/generate-video", "/cancel"):
            self._send_json(404, {"error": "Nicht gefunden"})
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length)
            body = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            self._send_json(400, {"error": "Ungültiges JSON"})
            return

        if not isinstance(body, dict):
            self._send_json(400, {"error":"JSON-Objekt erforderlich"})
            return
        if self.path == "/cancel":
            try:
                cancel_id = str(uuid.UUID(body.get("job_id", "")))
            except (ValueError, TypeError, AttributeError):
                self._send_json(400, {"error":"Ungültige Job-ID"})
                return
            with job_lock:
                cancel = jobs.get(cancel_id)
                if cancel is not None: cancel.set()
                else:
                    for key in list(early_cancels):
                        if time.monotonic()-early_cancels[key]>60: early_cancels.pop(key,None)
                    if len(early_cancels)<1024: early_cancels[cancel_id]=time.monotonic()
            self._send_json(200, {"cancelled":cancel is not None})
            return
        try:
            job_id = str(uuid.UUID(body.get("job_id", str(uuid.uuid4()))))
        except (ValueError, TypeError, AttributeError):
            self._send_json(400, {"error":"Ungültige Job-ID"})
            return
        try:
            validate_generation(body, video=self.path == "/generate-video")
        except (ValueError, TypeError, OSError) as error:
            self._send_json(400, {"error": str(error)})
            return
        if not generation_lock.acquire(blocking=False):
            self._send_json(503, {"error": "Bild-/Videogenerierung läuft bereits"})
            return
        started = time.monotonic()
        job_context.cancel = Event()
        job_context.outputs = []
        with job_lock:
            jobs[job_id] = job_context.cancel
            if early_cancels.pop(job_id,0)>time.monotonic()-60: job_context.cancel.set()
        try:
            if self.path == "/generate-video":
                path, error = generate_video(
                    prompt=body.get("prompt", ""),
                    frames=body.get("frames"),
                    fps=body.get("fps"),
                    width=body.get("width"),
                    height=body.get("height"),
                    steps=body.get("steps"),
                    guidance=body.get("guidance"),
                    guidance_2=body.get("guidance_2"),
                    seed=body.get("seed"),
                    negative_prompt=body.get("negative_prompt"),
                    init_image=body.get("init_image"),
                )
            else:
                path, error = generate_image(
                    prompt=body.get("prompt", ""),
                    width=body.get("width"),
                    height=body.get("height"),
                    steps=body.get("steps"),
                    seed=body.get("seed"),
                    model=body.get("model"),
                    guidance=body.get("guidance"),
                    init_image=body.get("init_image"),
                    negative_prompt=body.get("negative_prompt"),
                    engine=body.get("engine"),
                    image_strength=body.get("image_strength"),
                )
        except Exception as failure:
            path, error = None, str(failure)
        finally:
            try:
                with job_lock:
                    jobs.pop(job_id, None)
                if job_context.cancel.is_set():
                    cleanup_outputs(job_context.outputs)
            finally:
                job_context.outputs = None
                job_context.cancel = None
                generation_lock.release()
            print(json.dumps({"event": "generation_duration", "route": self.path,
                              "ms": round((time.monotonic() - started) * 1000)}))

        if error:
            self._send_json(500, {"error": error})
        else:
            self._send_json(200, {"path": path})

    def log_message(self, fmt, *args):
        print(f"[http] {self.address_string()} - {fmt % args}")


def main():
    print(f"ImageGen Service auf Port {config.port}")
    print(f"Output: {config.output_dir}")
    print(f"Video-Output: {config.video_output_dir}")
    print(f"Default-Engine: {config.default_engine}")
    print(f"Engines: {list(ENGINES.keys())}")
    print(f"Video: {config.video_cmd} generate | t2v={config.video_t2v_model} | i2v={config.video_i2v_model}")
    server = BoundedHTTPServer(("0.0.0.0", config.port), Handler)
    def stop_on_signal(_signum, _frame):
        raise KeyboardInterrupt
    previous = signal.signal(signal.SIGTERM, stop_on_signal)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nGestoppt.")
    finally:
        signal.signal(signal.SIGTERM, previous)
        with job_lock:
            for cancel in jobs.values():
                cancel.set()
        if generation_lock.acquire(timeout=5):
            try:
                pipeline.worker.close()
            finally:
                generation_lock.release()
        server.server_close()


if __name__ == "__main__":
    main()
