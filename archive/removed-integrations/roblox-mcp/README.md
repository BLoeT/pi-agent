# Roblox Studio MCP Bridge

Verbindet Ribo (pi-agent) mit Roblox Studio über den eingebauten MCP-Server.

## Architektur

```
roblox.js (Plugin im pi-agent Container)
    │
    │  HTTP POST /call
    ▼
roblox_bridge.py (läuft auf dem Mac, Port 8090)
    │
    │  stdio (stdin/stdout)
    ▼
Roblox Studio MCP Server (in Roblox Studio)
```

## Voraussetzungen

1. **Roblox Studio** muss geöffnet sein
2. Der **MCP-Server** muss in Studio aktiviert sein (Settings > MCP)
3. **Python 3** auf dem Mac
4. Die **Bridge** muss auf dem Mac laufen
5. Der **Container** muss die Bridge erreichen (host.docker.internal:8090)

## Setup

### 1. Bridge auf dem Mac starten

```bash
# Option A: Wenn der MCP-Server ein eigenes Binary/Script ist
ROBLOX_MCP_CMD="/path/to/roblox-mcp-server" python3 roblox_bridge.py

# Option B: Wenn es ein Python-Script ist
ROBLOX_MCP_CMD="python3" ROBLOX_MCP_ARGS="/path/to/mcp_server.py --stdio" python3 roblox_bridge.py

# Option C: Wenn es ein Node-Script ist
ROBLOX_MCP_CMD="node" ROBLOX_MCP_ARGS="/path/to/mcp-server.js" python3 roblox_bridge.py
```

Die Bridge startet den MCP-Server als Subprozess und kommuniziert über stdio.

### 2. Container-Netzwerk

Der Container muss `host.docker.internal` erreichen. In `docker-compose.yaml`:

```yaml
services:
  pi-agent:
    extra_hosts:
      - "host.docker.internal:host-gateway"
    environment:
      - ROBLOX_BRIDGE_URL=http://host.docker.internal:8090
```

Falls `host.docker.internal` nicht funktioniert (Linux), nutze die IP des Hosts:
```bash
# IP des Mac im Docker-Netzwerk finden
docker network inspect bridge | grep Gateway
```

### 3. Plugin im Container

`roblox.js` muss in den Plugin-Ordner des Containers kopiert werden:
```bash
docker cp roblox.js pi-agent:/workspace/plugins/roblox.js
# Dann Container neu starten
docker compose restart pi-agent
```

## Nutzung

### Health-Check
```
roblox action=health
```
Zeigt ob die Bridge und der MCP-Server laufen.

### Verfügbare Tools auflisten
```
roblox action=tools
```
Listet alle ~65 MCP-Tools von Roblox Studio.

### Tool aufrufen
```
roblox action=call tool_name="create_instance" arguments={"className": "Part", "parent": "Workspace"}
```

### Roher JSON-RPC-Request
```
roblox action=raw method="resources/read" params={"uri": "roblox://game"}
```

### MCP-Server neustarten
```
roblox action=restart
```

## Konfiguration (Umgebungsvariablen)

### Bridge (roblox_bridge.py)

| Variable | Default | Beschreibung |
|---|---|---|
| `ROBLOX_MCP_CMD` | (Pflicht) | Command zum Starten des MCP-Servers |
| `ROBLOX_MCP_ARGS` | (leer) | Zusätzliche Args, raumgetrennt |
| `ROBLOX_BRIDGE_PORT` | 8090 | HTTP-Port |
| `ROBLOX_MCP_TIMEOUT` | 60 | Timeout pro Call in Sekunden |
| `ROBLOX_MCP_PROTOCOL` | 2024-11-05 | MCP-Protokollversion |
| `ROBLOX_MCP_CONTENT_LENGTH` | false | LSP-Style Framing (true wenn nötig) |

### Plugin (roblox.js)

| Variable | Default | Beschreibung |
|---|---|---|
| `ROBLOX_BRIDGE_URL` | http://host.docker.internal:8090 | URL der Bridge |

## Debugging

### Bridge-Log
Die Bridge schreibt alles auf stderr:
```
[bridge] Starte MCP-Server: /path/to/mcp-server
[bridge] MCP-Server initialisiert (PID 12345)
[bridge] HTTP-Server läuft auf Port 8090
[http] 172.17.0.2 POST /call
```

### Status abfragen
```bash
curl http://localhost:8090/health
curl http://localhost:8090/status
```

### MCP-Server manuell testen
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | /path/to/mcp-server
```

## Troubleshooting

| Problem | Lösung |
|---|---|
| `ROBLOX_MCP_CMD ist nicht gesetzt` | Umgebungsvariable setzen |
| `MCP-Server ist abgestorben` | Studio ist geschlossen oder MCP-Server hat einen Crash |
| `Connection refused` | Bridge läuft nicht oder Port ist falsch |
| `host.docker.internal` nicht erreichbar | Docker-Netzwerk konfigurieren (siehe oben) |
| Timeout | MCP-Server antwortet nicht — prüfe ob Studio läuft und MCP aktiv ist |
| `Content-Length` Fehler | Setze `ROBLOX_MCP_CONTENT_LENGTH=true` |

## MCP-Protokoll

Die Bridge spricht das MCP-Protokoll (Model Context Protocol) über stdio:
- **Transport**: Newline-delimited JSON (Standard) oder LSP Content-Length Framing
- **Initialisierung**: `initialize` → `notifications/initialized`
- **Tool-Calls**: `tools/call` mit `{name, arguments}`
- **Tool-Liste**: `tools/list`
- **Ressourcen**: `resources/read`, `resources/list`

## Dateistruktur

```
roblox-mcp/
├── roblox_bridge.py    # HTTP→stdio Bridge für den Mac
├── roblox.js           # Plugin für den pi-agent Container
└── README.md           # Diese Datei
```
