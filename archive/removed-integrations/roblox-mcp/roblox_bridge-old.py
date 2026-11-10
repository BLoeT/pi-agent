#!/usr/bin/env python3
"""
Roblox Studio MCP Bridge
========================
HTTP-Server auf dem Mac-Host. Übersetzt HTTP-Requests in MCP-stdio-Requests
an den Roblox Studio MCP Server.

Der Roblox Studio MCP Server läuft als lokaler Prozess und kommuniziert über
stdin/stdout (JSON-RPC). Diese Bridge macht daraus einen HTTP-Endpunkt,
den das Ribo-Plugin (roblox.js) im Docker-Container erreichen kann.

Starten:
    python3 roblox_bridge.py

Umgebungsvariablen:
    ROBLOX_MCP_CMD            Startbefehl des MCP Servers
                              (Default: /Applications/RobloxStudio.app/Contents/MacOS/StudioMCP)
    ROBLOX_MCP_ARGS           Zusätzliche Argumente (optional, Whitespace-getrennt)
    ROBLOX_BRIDGE_PORT        Port für den HTTP-Server (Default: 8090)
    ROBLOX_MCP_TIMEOUT        Timeout in Sekunden für MCP-Calls (Default: 60)
    ROBLOX_MCP_PROTOCOL       MCP Protocol-Version (Default: 2024-11-05)
    ROBLOX_MCP_CONTENT_LENGTH Wenn "true": LSP-Style Content-Length-Framing
                              (Default: false = newline-delimited JSON)
    ROBLOX_MCP_CHECK_PATH     Wenn "false": Existenzprüfung des Pfads überspringen
                              (Default: true)
"""

import json
import os
import signal
import subprocess
import sys
import threading
import time
from http.server import HTTPServer, BaseHTTPRequestHandler

# --- Konfiguration ----------------------------------------------------------

# Default-Pfad: Roblox Studio MCP Server Binary auf dem Mac.
# Kann per Umgebungsvariable ROBLOX_MCP_CMD überschrieben werden.
DEFAULT_MCP_CMD = "/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP"

MCP_CMD = os.environ.get("ROBLOX_MCP_CMD", DEFAULT_MCP_CMD)
MCP_ARGS = os.environ.get("ROBLOX_MCP_ARGS", "").split()
BRIDGE_PORT = int(os.environ.get("ROBLOX_BRIDGE_PORT", "8090"))
MCP_TIMEOUT = int(os.environ.get("ROBLOX_MCP_TIMEOUT", "60"))
MCP_PROTOCOL = os.environ.get("ROBLOX_MCP_PROTOCOL", "2024-11-05")
USE_CONTENT_LENGTH = os.environ.get("ROBLOX_MCP_CONTENT_LENGTH", "false").lower() == "true"
CHECK_PATH = os.environ.get("ROBLOX_MCP_CHECK_PATH", "true").lower() != "false"

# --- Zustandsverwaltung -----------------------------------------------------

mcp_process = None
mcp_lock = threading.Lock()
request_id = 0
request_id_lock = threading.Lock()
mcp_initialized = False
mcp_init_lock = threading.Lock()


def log(msg):
    """Loggt mit Zeitstempel auf stderr (stdout gehört dem MCP-Protokoll)."""
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] [roblox-bridge] {msg}", file=sys.stderr, flush=True)


def next_request_id():
    global request_id
    with request_id_lock:
        request_id += 1
        return request_id


# --- Pfad-Prüfung -----------------------------------------------------------

def check_mcp_cmd():
    """Prüft ob der MCP-Command existiert und ausführbar ist.

    Gibt True zurück wenn ok, False wenn nicht. Bei False wird eine klare
    Fehlermeldung ausgegeben.
    """
    if not CHECK_PATH:
        return True

    cmd = MCP_CMD

    # Shell-Befehle (z.B. "cmd.exe", "sh") prüfen wir nicht statisch.
    shell_cmds = {"cmd.exe", "cmd", "sh", "bash", "zsh", "pwsh", "powershell"}
    base = os.path.basename(cmd).lower()
    if base in shell_cmds:
        log(f"Pfad-Check übersprungen für Shell-Command: {cmd}")
        return True

    # Existiert der Pfad?
    if not os.path.exists(cmd):
        log(f"FEHLER: MCP-Command existiert nicht: {cmd}")
        log("Mögliche Ursachen:")
        log("  - Roblox Studio ist nicht installiert.")
        log("  - Der Pfad ist falsch. Standard: /Applications/RobloxStudio.app/Contents/MacOS/StudioMCP")
        log("  - Prüfe mit: ls -la " + cmd)
        log("  - Oder setze ROBLOX_MCP_CMD auf den korrekten Pfad.")
        log("  - Um diesen Check abzuschalten: ROBLOX_MCP_CHECK_PATH=false")
        return False

    # Ist er ausführbar?
    if not os.access(cmd, os.X_OK):
        log(f"FEHLER: MCP-Command ist nicht ausführbar: {cmd}")
        log("Rechte setzen mit: chmod +x " + cmd)
        return False

    log(f"Pfad-Check bestanden: {cmd}")
    return True


# --- MCP-Subprozess-Verwaltung ----------------------------------------------

def start_mcp():
    """Startet den MCP-Server als Subprozess."""
    global mcp_process, mcp_initialized
    with mcp_lock:
        if mcp_process and mcp_process.poll() is None:
            log("MCP-Prozess läuft bereits.")
            return True

        if not MCP_CMD:
            log("Fehler: ROBLOX_MCP_CMD ist nicht gesetzt.")
            return False

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
        except FileNotFoundError:
            log(f"Fehler: Befehl nicht gefunden: {MCP_CMD}")
            log("Prüfe den Pfad oder setze ROBLOX_MCP_CMD korrekt.")
            return False
        except PermissionError:
            log(f"Fehler: Keine Ausführungsrechte für: {MCP_CMD}")
            log("Rechte setzen mit: chmod +x " + MCP_CMD)
            return False
        except Exception as e:
            log(f"Fehler beim Start: {e}")
            return False

        mcp_initialized = False
        log("MCP-Server gestartet (PID: {}).".format(mcp_process.pid))
        return True


def stop_mcp():
    """Stoppt den MCP-Server."""
    global mcp_process
    with mcp_lock:
        if mcp_process:
            log("Stoppe MCP-Server...")
            try:
                mcp_process.terminate()
                mcp_process.wait(timeout=5)
            except Exception:
                try:
                    mcp_process.kill()
                except Exception:
                    pass
            mcp_process = None
            log("MCP-Server gestoppt.")


def ensure_mcp_running():
    """Stellt sicher, dass der MCP-Server läuft."""
    with mcp_lock:
        if mcp_process is None or mcp_process.poll() is not None:
            if mcp_process and mcp_process.poll() is not None:
                log(f"MCP-Server ist abgestürzt (exit code: {mcp_process.returncode}). Neustart...")
            return start_mcp()
    return True


# --- MCP-Kommunikation (JSON-RPC über stdio) --------------------------------

def _mcp_send(payload):
    """Sendet ein JSON-RPC-Objekt an den MCP-Server."""
    with mcp_lock:
        if not mcp_process or mcp_process.poll() is not None:
            raise RuntimeError("MCP-Server läuft nicht.")

        data = json.dumps(payload)

        if USE_CONTENT_LENGTH:
            # LSP-Style Framing
            header = f"Content-Length: {len(data.encode('utf-8'))}\r\n\r\n"
            mcp_process.stdin.write(header)
            mcp_process.stdin.write(data)
        else:
            # Newline-delimited JSON
            mcp_process.stdin.write(data + "\n")

        mcp_process.stdin.flush()


def _mcp_receive():
    """Liest eine JSON-RPC-Antwort vom MCP-Server."""
    with mcp_lock:
        if not mcp_process or mcp_process.poll() is not None:
            raise RuntimeError("MCP-Server läuft nicht.")

        if USE_CONTENT_LENGTH:
            # Lese Content-Length-Header
            content_length = 0
            while True:
                line = mcp_process.stdout.readline()
                if not line:
                    raise RuntimeError("MCP-Server hat Verbindung geschlossen.")
                line = line.strip()
                if line == "":
                    break  # Leerzeile = Ende der Header
                if line.lower().startswith("content-length:"):
                    content_length = int(line.split(":", 1)[1].strip())

            if content_length == 0:
                raise RuntimeError("Kein Content-Length-Header erhalten.")

            body = mcp_process.stdout.read(content_length)
        else:
            # Newline-delimited JSON
            line = mcp_process.stdout.readline()
            if not line:
                raise RuntimeError("MCP-Server hat Verbindung geschlossen.")
            body = line.strip()

        if not body:
            raise RuntimeError("Leere Antwort vom MCP-Server.")

        try:
            return json.loads(body)
        except json.JSONDecodeError:
            log(f"Ungültiges JSON vom MCP-Server: {body[:200]}")
            raise


def _mcp_initialize():
    """Führt den MCP-Initialisierungshandshake durch."""
    global mcp_initialized
    with mcp_init_lock:
        if mcp_initialized:
            return True

        log("MCP-Initialisierung...")
        init_payload = {
            "jsonrpc": "2.0",
            "id": next_request_id(),
            "method": "initialize",
            "params": {
                "protocolVersion": MCP_PROTOCOL,
                "capabilities": {},
                "clientInfo": {
                    "name": "roblox-bridge",
                    "version": "1.0",
                },
                "_meta": {
                    "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL,
                    "io.modelcontextprotocol/clientCapabilities": {},
                },
            },
        }

        try:
            _mcp_send(init_payload)
            response = _mcp_receive()
            log(f"Initialize-Antwort: {json.dumps(response)[:300]}")

            # Manche Server erwarten eine "initialized"-Nachricht
            try:
                _mcp_send({
                    "jsonrpc": "2.0",
                    "method": "notifications/initialized",
                })
            except Exception:
                pass  # Nicht alle Server brauchen das

            mcp_initialized = True
            return True
        except Exception as e:
            log(f"Initialisierung fehlgeschlagen: {e}")
            return False


def mcp_call_tool(tool_name, arguments=None, timeout=None):
    """Ruft ein MCP-Tool auf."""
    if timeout is None:
        timeout = MCP_TIMEOUT

    if not ensure_mcp_running():
        return {"error": "MCP-Server konnte nicht gestartet werden."}

    if not _mcp_initialize():
        return {"error": "MCP-Initialisierung fehlgeschlagen."}

    payload = {
        "jsonrpc": "2.0",
        "id": next_request_id(),
        "method": "tools/call",
        "params": {
            "name": tool_name,
            "arguments": arguments or {},
        },
    }

    log(f"Tool-Call: {tool_name} {json.dumps(arguments or {})}")

    try:
        _mcp_send(payload)

        # Timeout-Handling
        result = [None]
        error = [None]

        def _read():
            try:
                result[0] = _mcp_receive()
            except Exception as e:
                error[0] = e

        reader = threading.Thread(target=_read, daemon=True)
        reader.start()
        reader.join(timeout=timeout)

        if reader.is_alive():
            log(f"Timeout beim Tool-Call: {tool_name}")
            return {"error": f"Timeout nach {timeout}s beim Tool-Call: {tool_name}"}

        if error[0]:
            return {"error": str(error[0])}

        response = result[0]
        log(f"Tool-Antwort: {json.dumps(response)[:300]}")

        if "error" in response:
            return {"error": response["error"]}

        return response.get("result", response)

    except Exception as e:
        log(f"Fehler beim Tool-Call: {e}")
        return {"error": str(e)}


def mcp_list_tools():
    """Listet alle verfügbaren MCP-Tools auf."""
    if not ensure_mcp_running():
        return {"error": "MCP-Server konnte nicht gestartet werden."}

    if not _mcp_initialize():
        return {"error": "MCP-Initialisierung fehlgeschlagen."}

    payload = {
        "jsonrpc": "2.0",
        "id": next_request_id(),
        "method": "tools/list",
    }

    try:
        _mcp_send(payload)

        result = [None]
        error = [None]

        def _read():
            try:
                result[0] = _mcp_receive()
            except Exception as e:
                error[0] = e

        reader = threading.Thread(target=_read, daemon=True)
        reader.start()
        reader.join(timeout=MCP_TIMEOUT)

        if reader.is_alive():
            return {"error": "Timeout bei tools/list"}

        if error[0]:
            return {"error": str(error[0])}

        response = result[0]
        if "error" in response:
            return {"error": response["error"]}

        return response.get("result", response)

    except Exception as e:
        return {"error": str(e)}


# --- HTTP-Server ------------------------------------------------------------

class RobloxBridgeHandler(BaseHTTPRequestHandler):
    """HTTP-Handler für die Roblox MCP Bridge."""

    def _send_json(self, status_code, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return {}

    def do_GET(self):
        if self.path == "/health" or self.path == "/":
            with mcp_lock:
                running = mcp_process is not None and mcp_process.poll() is None
            self._send_json(200, {
                "status": "ok" if running else "mcp_down",
                "bridge": "running",
                "mcp_running": running,
                "mcp_cmd": MCP_CMD,
                "protocol": MCP_PROTOCOL,
                "framing": "content-length" if USE_CONTENT_LENGTH else "newline-json",
            })

        elif self.path == "/tools":
            result = mcp_list_tools()
            self._send_json(200, result)

        elif self.path == "/status":
            with mcp_lock:
                running = mcp_process is not None and mcp_process.poll() is None
                pid = mcp_process.pid if running else None
            self._send_json(200, {
                "mcp_running": running,
                "mcp_pid": pid,
                "mcp_initialized": mcp_initialized,
                "cmd": MCP_CMD,
                "args": MCP_ARGS,
                "path_exists": os.path.exists(MCP_CMD),
            })

        else:
            self._send_json(404, {"error": "Nicht gefunden", "endpoints": [
                "GET /health", "GET /tools", "GET /status",
                "POST /call", "POST /raw", "POST /restart",
                "DELETE /shutdown",
            ]})

    def do_POST(self):
        body = self._read_body()

        if self.path == "/call":
            tool_name = body.get("tool_name") or body.get("name")
            arguments = body.get("arguments") or body.get("args") or {}
            if not tool_name:
                self._send_json(400, {"error": "tool_name ist erforderlich"})
                return
            result = mcp_call_tool(tool_name, arguments)
            status = 200 if "error" not in result else 500
            self._send_json(status, result)

        elif self.path == "/raw":
            # Roher JSON-RPC-Call (für Advanced-Nutzer)
            method = body.get("method")
            params = body.get("params", {})
            if not method:
                self._send_json(400, {"error": "method ist erforderlich"})
                return

            if not ensure_mcp_running():
                self._send_json(500, {"error": "MCP-Server nicht verfügbar"})
                return

            payload = {
                "jsonrpc": "2.0",
                "id": next_request_id(),
                "method": method,
                "params": params,
            }

            try:
                _mcp_send(payload)
                response = _mcp_receive()
                self._send_json(200, response)
            except Exception as e:
                self._send_json(500, {"error": str(e)})

        elif self.path == "/restart":
            stop_mcp()
            time.sleep(0.5)
            ok = start_mcp()
            self._send_json(200 if ok else 500, {
                "status": "restarted" if ok else "restart_failed",
            })

        else:
            self._send_json(404, {"error": "Nicht gefunden"})

    def do_DELETE(self):
        if self.path == "/shutdown":
            self._send_json(200, {"status": "shutting_down"})
            stop_mcp()
            threading.Thread(target=_shutdown_server, daemon=True).start()
        else:
            self._send_json(404, {"error": "Nicht gefunden"})

    def log_message(self, format, *args):
        """Überschreibt das Standard-Logging (geht auf stderr)."""
        log(f"HTTP: {args[0] if args else ''}")


def _shutdown_server():
    """Stoppt den HTTP-Server."""
    time.sleep(1)
    sys.exit(0)


# --- Signal-Handling --------------------------------------------------------

def signal_handler(signum, frame):
    log(f"Signal {signum} erhalten. Herunterfahren...")
    stop_mcp()
    sys.exit(0)


# --- Main -------------------------------------------------------------------

def main():
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    log(f"Roblox MCP Bridge startet auf Port {BRIDGE_PORT}")
    log(f"MCP-Command: {MCP_CMD}")
    log(f"MCP-Args: {MCP_ARGS}")
    log(f"Timeout: {MCP_TIMEOUT}s, Protocol: {MCP_PROTOCOL}, Framing: {'content-length' if USE_CONTENT_LENGTH else 'newline-json'}")

    # Pfad-Prüfung vor dem Start
    if not check_mcp_cmd():
        log("Bridge beendet sich wegen fehlendem/ungültigem MCP-Command.")
        sys.exit(1)

    server = HTTPServer(("0.0.0.0", BRIDGE_PORT), RobloxBridgeHandler)
    log(f"HTTP-Server lauscht auf 0.0.0.0:{BRIDGE_PORT}")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop_mcp()
        server.server_close()
        log("Bridge gestoppt.")


if __name__ == "__main__":
    main()
