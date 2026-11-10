#!/usr/bin/env python3
"""Launch Govee with only its own settings, never all Ribo service secrets."""
import os
from pathlib import Path
root = Path(__file__).resolve().parent.parent
env = os.environ.copy()
for line in (root / '.env').read_text().splitlines():
    key, sep, value = line.partition('=')
    if sep and key.strip().startswith('GOVEE_'):
        env[key.strip()] = value.strip().strip('\"\'')
env.setdefault('GOVEE_MQTT_HOST', '127.0.0.1')
env.setdefault('GOVEE_MQTT_PORT', '1883')
env.setdefault('GOVEE_LAN_SCAN', '192.168.178.105')
env.setdefault('RUST_LOG', 'info')
os.chdir(root / 'govee2mqtt')
os.execve(root / 'govee2mqtt/target/release/govee', ['govee', 'serve'], env)
