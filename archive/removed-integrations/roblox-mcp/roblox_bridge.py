#!/usr/bin/env python3
"""
Roblox Studio MCP Bridge
========================
HTTP-Server auf dem Mac-Host. Übersetzt HTTP-Requests in MCP-stdio-Requests
an den Roblox Studio MCP Server.

Starten:
    python3 roblox_bridge.py

Umgebungsvariablen:
    ROBLOX_MCP_CMD            Startbefehl (Default: StudioMCP-Pfad)
    ROBLOX_MCP_ARGS           Zusätzliche Argumente (optional)
    ROBLOX_BRIDGE_PORT        Port (Default: 8090)
    ROBLOX_MCP_TIMEOUT        Timeout in Sekunden (Default: 30)
    ROBLOX_MCP_PROTOCOL       Protocol-Version (Default: 2024-11-05)
    ROBLOX_MCP_STARTUP_DELAY  Sekunden warten vor initialize (Default: 0.5)
"""

import json
import os
import subprocess
import sys
import threading
import time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

# --- Konfiguration ----------------------------------------------------------

DEFAULT_MCP_CMD = "/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP"

MCP_CMD = os.environ.get("ROBLOX_MCP_CMD", DEFAULT_MCP_CMD)
MCP_ARGS = os.environ.get("ROBLOX_MCP_ARGS", "").split()
BRIDGE_PORT = int(os.environ.get("ROBLOX_BRIDGE_PORT", "8090"))
MCP_TIMEOUT = int(os.environ.get("ROBLOX_MCP_TIMEOUT", "30"))
MCP_PROTOCOL = os.environ.get("ROBLOX_MCP_PROTOCOL", "2024-11-05")
STARTUP_DELAY = float(os.environ.get("ROBLOX_MCP_STARTUP_DELAY", "0.5"))

# --- Zustand ----------------------------------------------------------------

mcp_process = None
mcp_initialized = False
mcp_start_time = None
last_error = None
stderr_lines = []
request_id_counter = 0

# RLock = reentrant, damit mcp_raw() -> ensure_mcp() -> mcp_mutex kein Deadlock macht
mcp_mutex = threading.RLock()
state_lock = threading.Lock()


def log(msg):
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] [roblox-bridge] {msg}", file=sys.stderr, flush=True)


def next_id():
    global request_id_counter
    request_id_counter += 1
    return request_id_counter


# --- stderr-Drain -----------------------------------------------------------

def _drain_stderr(proc):
    global stderr_lines
    try:
        for line in iter(proc.stderr.readline, ''):
            if line:
                text = line.rstrip() if isinstance(line, str) else line.decode('utf-8', errors='replace').rstrip()
                if text:
                    with state_lock:
                        stderr_lines.append(text)
                        if len(stderr_lines) > 50:
                            stderr_lines = stderr_lines[-50:]
                    log(f"[StudioMCP-stderr] {text}")
    except (ValueError, OSError):
        pass


# --- MCP-Verwaltung ---------------------------------------------------------

def start_mcp():
    """Startet den MCP-Server. Ruft _do_initialize NICHT auf."""
    global mcp_process, mcp_initialized, mcp_start_time, last_error

    with state_lock:
        if mcp_process and mcp_process.poll() is None:
            log("MCP-Prozess läuft bereits.")
            return True

        log(f"Starte MCP-Server: {MCP_CMD} {' '.join(MCP_ARGS)}")
        try:
            mcp_process = subprocess.Popen(
                [MCP_CMD] + MCP_ARGS,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
            )
        except Exception as e:
            log(f"Fehler beim Start: {e}")
            last_error = str(e)
            mcp_process = None
            return False

        mcp_initialized = False
        mcp_start_time = time.time()
        log(f"MCP-Server gestartet (PID: {mcp_process.pid}).")

        t = threading.Thread(target=_drain_stderr, args=(mcp_process,), daemon=True)
        t.start()

        log(f"Warte {STARTUP_DELAY}s...")
        time.sleep(STARTUP_DELAY)

        if mcp_process.poll() is not None:
            log(f"MCP-Server abgestürzt (exit: {mcp_process.returncode}).")
            last_error = f"Exit code {mcp_process.returncode}"
            with state_lock:
                if stderr_lines:
                    log("stderr: " + " | ".join(stderr_lines[-5:]))
            mcp_process = None
            mcp_start_time = None
            return False

        log("Startup ok, Prozess lebt.")
        return True


def ensure_mcp():
    """Stellt sicher dass MCP läuft und initialisiert ist."""
    with mcp_mutex:
        with state_lock:
            proc = mcp_process
        if proc is None or proc.poll() is not None:
            if proc and proc.poll() is not None:
                log(f"MCP abgestürzt (exit: {proc.returncode}), Neustart...")
            if not start_mcp():
                return False

        if not mcp_initialized:
            if not _do_initialize():
                return False

        return True


def _do_initialize():
    """Führt den MCP-Initialisierungshandshake durch.
    Muss innerhalb von mcp_mutex aufgerufen werden."""
    global mcp_initialized, last_error

    proc = mcp_process
    if not proc or proc.poll() is not None:
        last_error = "Prozess nicht verfügbar"
        return False

    log("Initialisiere MCP...")

    init_payload = {
        "jsonrpc": "2.0",
        "id": next_id(),
        "method": "initialize",
        "params": {
            "protocolVersion": MCP_PROTOCOL,
            "capabilities": {},
            "clientInfo": {"name": "roblox-bridge", "version": "1.0"},
            "_meta": {
                "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL,
                "io.modelcontextprotocol/clientCapabilities": {},
            },
        },
    }

    try:
        line = json.dumps(init_payload)
        log(f"-> initialize: {line[:200]}")
        proc.stdin.write(line + "\n")
        proc.stdin.flush()
        log("initialize gesendet, warte auf Antwort...")

        result = [None]
        err = [None]

        def _read():
            try:
                raw = proc.stdout.readline()
                if raw:
                    result[0] = raw.strip()
                else:
                    err[0] = "EOF von stdout"
            except Exception as e:
                err[0] = str(e)

        reader = threading.Thread(target=_read, daemon=True)
        reader.start()
        reader.join(timeout=15)

        if reader.is_alive():
            log("Initialize-Timeout (15s)")
            last_error = "Initialize-Timeout"
            return False

        if err[0]:
            log(f"Initialize-Read-Fehler: {err[0]}")
            last_error = err[0]
            return False

        raw = result[0]
        log(f"<- initialize Antwort: {raw[:300] if raw else 'leer'}")

        if not raw:
            last_error = "Leere Antwort"
            return False

        try:
            response = json.loads(raw)
        except json.JSONDecodeError:
            log(f"Ungültiges JSON: {raw[:200]}")
            last_error = f"Ungültiges JSON: {raw[:100]}"
            return False

        if "error" in response:
            log(f"Initialize-Fehler: {json.dumps(response['error'])}")
            last_error = json.dumps(response["error"])
            return False

        # "initialized"-Notification
        try:
            notif = json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"})
            proc.stdin.write(notif + "\n")
            proc.stdin.flush()
            log("notifications/initialized gesendet")
        except Exception as e:
            log(f"Notification-Fehler (nicht kritisch): {e}")

        mcp_initialized = True
        last_error = None
        log("MCP initialisiert.")
        return True

    except Exception as e:
        log(f"Initialize-Ausnahme: {e}")
        last_error = str(e)
        return False


def _mcp_send_receive(payload, timeout=None):
    """Sendet ein JSON-RPC-Objekt und liest die Antwort.
    Muss innerhalb von mcp_mutex aufgerufen werden."""
    if timeout is None:
        timeout = MCP_TIMEOUT

    proc = mcp_process
    if not proc or proc.poll() is not None:
        return {"error": "MCP-Prozess nicht verfügbar"}

    try:
        line = json.dumps(payload)
        log(f"-> {payload.get('method', '?')}: {line[:150]}")
        proc.stdin.write(line + "\n")
        proc.stdin.flush()

        result = [None]
        err = [None]

        def _read():
            try:
                raw = proc.stdout.readline()
                if raw:
                    result[0] = raw.strip()
                else:
                    err[0] = "EOF"
            except Exception as e:
                err[0] = str(e)

        reader = threading.Thread(target=_read, daemon=True)
        reader.start()
        reader.join(timeout=timeout)

        if reader.is_alive():
            log(f"Timeout ({timeout}s) bei {payload.get('method', '?')}")
            return {"error": f"Timeout nach {timeout}s"}

        if err[0]:
            return {"error": err[0]}

        raw = result[0]
        log(f"<- Antwort: {raw[:300] if raw else 'leer'}")

        if not raw:
            return {"error": "Leere Antwort"}

        response = json.loads(raw)
        if "error" in response:
            return response
        return response

    except Exception as e:
        log(f"Fehler: {e}")
        return {"error": str(e)}


def mcp_call(tool_name, arguments=None, timeout=None):
    """Ruft ein MCP-Tool auf."""
    with mcp_mutex:
        if not ensure_mcp():
            return {"error": "MCP nicht verfügbar", "detail": last_error}

        payload = {
            "jsonrpc": "2.0",
            "id": next_id(),
            "method": "tools/call",
            "params": {"name": tool_name, "arguments": arguments or {}},
        }
        response = _mcp_send_receive(payload, timeout)
        if "error" in response:
            return response
        return response.get("result", response)


def mcp_list_tools(timeout=None):
    """Listet MCP-Tools auf."""
    with mcp_mutex:
        if not ensure_mcp():
            return {"error": "MCP nicht verfügbar", "detail": last_error}

        payload = {"jsonrpc": "2.0", "id": next_id(), "method": "tools/list"}
        response = _mcp_send_receive(payload, timeout)
        if "error" in response:
            return response
        return response.get("result", response)


def mcp_raw(method, params=None, timeout=None):
    """Schickt einen rohen JSON-RPC-Request."""
    with mcp_mutex:
        if not ensure_mcp():
            return {"error": "MCP nicht verfügbar", "detail": last_error}

        payload = {
            "jsonrpc": "2.0",
            "id": next_id(),
            "method": method,
            "params": params or {},
        }
        return _mcp_send_receive(payload, timeout)


# --- HTTP-Server ------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    def _send(self, code, data):
        body = json.dumps(data, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:
            return {}

    def do_GET(self):
        with state_lock:
            running = mcp_process is not None and mcp_process.poll() is None
            pid = mcp_process.pid if running else None
            exit_code = mcp_process.returncode if mcp_process and not running else None
            uptime = round(time.time() - mcp_start_time, 1) if mcp_start_time else 0
            s_err = list(stderr_lines[-15:])
            s_last_err = last_error

        if self.path in ("/health", "/"):
            self._send(200, {
                "status": "ok" if running else "mcp_down",
                "mcp_running": running,
                "mcp_initialized": mcp_initialized,
                "mcp_pid": pid,
                "mcp_cmd": MCP_CMD,
                "protocol": MCP_PROTOCOL,
                "uptime_seconds": uptime,
                "last_error": s_last_err,
            })

        elif self.path == "/status":
            self._send(200, {
                "mcp_running": running,
                "mcp_pid": pid,
                "mcp_exit_code": exit_code,
                "mcp_initialized": mcp_initialized,
                "cmd": MCP_CMD,
                "args": MCP_ARGS,
                "path_exists": os.path.exists(MCP_CMD),
                "path_executable": os.access(MCP_CMD, os.X_OK) if os.path.exists(MCP_CMD) else False,
                "uptime_seconds": uptime,
                "last_error": s_last_err,
                "stderr_tail": s_err,
            })

        elif self.path == "/debug":
            self._send(200, {
                "bridge": "running",
                "mcp_running": running,
                "mcp_pid": pid,
                "mcp_exit_code": exit_code,
                "mcp_initialized": mcp_initialized,
                "cmd": MCP_CMD,
                "args": MCP_ARGS,
                "path_exists": os.path.exists(MCP_CMD),
                "path_executable": os.access(MCP_CMD, os.X_OK) if os.path.exists(MCP_CMD) else False,
                "uptime_seconds": uptime,
                "protocol": MCP_PROTOCOL,
                "timeout": MCP_TIMEOUT,
                "startup_delay": STARTUP_DELAY,
                "last_error": s_last_err,
                "stderr_tail": s_err,
                "stderr_count": len(stderr_lines),
            })

        elif self.path == "/tools":
            result = mcp_list_tools()
            self._send(200 if "error" not in result else 500, result)

        else:
            self._send(404, {"error": "Nicht gefunden"})

    def do_POST(self):
        body = self._body()

        if self.path == "/call":
            tool = body.get("tool_name") or body.get("name")
            args = body.get("arguments") or body.get("args") or {}
            if not tool:
                self._send(400, {"error": "tool_name erforderlich"})
                return
            result = mcp_call(tool, args, body.get("timeout"))
            self._send(200 if "error" not in result else 500, result)

        elif self.path == "/raw":
            method = body.get("method")
            params = body.get("params", {})
            if not method:
                self._send(400, {"error": "method erforderlich"})
                return
            result = mcp_raw(method, params, body.get("timeout"))
            self._send(200 if "error" not in result else 500, result)

        elif self.path == "/restart":
            global mcp_process, mcp_initialized, mcp_start_time
            with state_lock:
                if mcp_process:
                    try:
                        mcp_process.terminate()
                        mcp_process.wait(timeout=3)
                    except Exception:
                        try:
                            mcp_process.kill()
                        except Exception:
                            pass
                mcp_process = None
                mcp_initialized = False
                mcp_start_time = None
            time.sleep(0.5)
            ok = start_mcp()
            if ok:
                with mcp_mutex:
                    _do_initialize()
            self._send(200 if ok else 500, {"status": "restarted" if ok else "failed"})

        else:
            self._send(404, {"error": "Nicht gefunden"})

    def do_DELETE(self):
        if self.path == "/shutdown":
            self._send(200, {"status": "shutting_down"})
            threading.Thread(target=lambda: (time.sleep(0.5), sys.exit(0)), daemon=True).start()
        else:
            self._send(404, {"error": "Nicht gefunden"})

    def log_message(self, fmt, *args):
        log(f"HTTP: {args[0] if args else ''}")


def main():
    log(f"Roblox MCP Bridge auf Port {BRIDGE_PORT}")
    log(f"CMD: {MCP_CMD}")
    log(f"Timeout: {MCP_TIMEOUT}s, Protocol: {MCP_PROTOCOL}, Delay: {STARTUP_DELAY}s")

    if os.path.exists(MCP_CMD):
        log(f"Pfad ok: {MCP_CMD}")
    else:
        log(f"Pfad NICHT gefunden: {MCP_CMD}")

    server = ThreadingHTTPServer(("0.0.0.0", BRIDGE_PORT), Handler)
    log(f"Lauscht auf 0.0.0.0:{BRIDGE_PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        if mcp_process:
            try:
                mcp_process.terminate()
            except Exception:
                pass
        server.server_close()
        log("Gestoppt.")


if __name__ == "__main__":
    main()
