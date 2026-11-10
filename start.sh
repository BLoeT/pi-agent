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

    python3 "$BASE_DIR/scripts/run-govee.py" &

    echo "✓ govee2mqtt gestartet"
fi


# --------------------------------------------------
# Ribo Audio + Imagegen (native Hintergrunddienste)
# Erkennt auch Dienste, die außerhalb dieses Skripts gestartet wurden.
# Logs: .logs/voice.log und .logs/imagegen.log
# --------------------------------------------------

if ! python3 "$BASE_DIR/scripts/start-native.py"; then
    echo "❌ Audio-/Bilddienste konnten nicht vollständig gestartet werden."
    exit 1
fi


echo ""
echo "=== Fertig ==="
