#!/bin/bash

BASE_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== AI Services ==="
echo ""

# --------------------------------------------------
# govee2mqtt
# --------------------------------------------------

if pgrep -f "$BASE_DIR/govee2mqtt/target/release/govee serve" >/dev/null; then
    echo "✓ govee2mqtt läuft bereits"
else
    echo "→ Starte govee2mqtt..."

    cd "$BASE_DIR/govee2mqtt"

    GOVEE_MQTT_HOST=127.0.0.1 \
    GOVEE_MQTT_PORT=1883 \
    GOVEE_LAN_SCAN=192.168.178.105 \
    RUST_LOG=info \
    ./target/release/govee serve &

    echo "✓ govee2mqtt gestartet"
fi


# --------------------------------------------------
# hey-ribo
# --------------------------------------------------

if pgrep -f "uv run hey-ribo.py" >/dev/null; then
    echo "✓ hey-ribo läuft bereits"
else
    echo "→ Starte hey-ribo..."

    osascript <<EOF
tell application "Terminal"
    do script "cd '$BASE_DIR' && uv run hey-ribo.py"
end tell
EOF

    echo "✓ hey-ribo gestartet"
fi


# --------------------------------------------------
# imagegen-service
# --------------------------------------------------

if pgrep -f "uv run imagegen-service/server.py" >/dev/null; then
    echo "✓ imagegen-service läuft bereits"
else
    echo "→ Starte imagegen-service..."

    osascript <<EOF
tell application "Terminal"
    do script "cd '$BASE_DIR' && uv run imagegen-service/server.py"
end tell
EOF

    echo "✓ imagegen-service gestartet"
fi


# --------------------------------------------------
# roblox-bridge (Roblox Studio MCP Bridge)
# --------------------------------------------------

#if pgrep -f "uv run roblox-mcp/roblox_bridge.py" >/dev/null; then
#    echo "✓ roblox-bridge läuft bereits"
#else
#    echo "→ Starte roblox-bridge..."
#
#    osascript <<EOF
#tell application "Terminal"
#    do script "cd '$BASE_DIR' && uv run roblox-mcp/roblox_bridge.py"
#end tell
#EOF
#
#    echo "✓ roblox-bridge gestartet"
#fi


echo ""
echo "=== Fertig ==="
