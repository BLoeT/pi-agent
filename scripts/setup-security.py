#!/usr/bin/env python3
"""Create local credentials once, preserving existing configuration and secrets."""
from pathlib import Path
import os
import secrets
import re

root = Path(__file__).resolve().parent.parent
env_path = root / '.env'
text = env_path.read_text() if env_path.exists() else ''
values = dict(re.findall(r'^([A-Z_]+)=(.*)$', text, re.M))
created = {}
for key, value in {'RIBO_INTERNAL_TOKEN': secrets.token_urlsafe(48),
                   'RIBO_WEB_USER': 'enrico',
                   'GOVEE_MQTT_USER': 'ribo',
                   'GOVEE_MQTT_PASSWORD': secrets.token_urlsafe(36),
                   'RIBO_UID': str(os.getuid()),
                   'RIBO_GID': str(os.getgid()),
                   'RIBO_WEB_PASSWORD': secrets.token_urlsafe(24)}.items():
    if key not in values or not values[key].strip():
        if key in values:
            text = re.sub(r'^' + key + r'=.*$', key + '=' + value, text, flags=re.M)
        else:
            text = text.rstrip('\n') + '\n' + key + '=' + value + '\n'
        created[key] = value
if created:
    temporary = env_path.with_name('.env-security-tmp')
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as file:
        file.write(text)
    os.replace(temporary, env_path)
    os.chmod(env_path, 0o600)
    if 'RIBO_WEB_PASSWORD' in created:
        access = root / '.ribo-browser-access.txt'
        descriptor = os.open(access, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'w') as file:
            file.write('Ribo Browser-Anmeldung (nur lokal aufbewahren)\nNutzer: ' + created.get('RIBO_WEB_USER', values.get('RIBO_WEB_USER', 'enrico')) + '\nPasswort: ' + created['RIBO_WEB_PASSWORD'] + '\n')
    print('Lokale Zugangsdaten eingerichtet. Browserzugang: .ribo-browser-access.txt')
else:
    print('Vorhandene Zugangsdaten beibehalten.')
