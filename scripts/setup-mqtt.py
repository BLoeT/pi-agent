#!/usr/bin/env python3
"""Bootstrap local MQTT hashes without putting plaintext passwords in argv/logs."""
from pathlib import Path
import json
import os
import secrets
import subprocess

root = Path(__file__).resolve().parent.parent
config_dir = root / 'mosquitto/config'
target = config_dir / 'passwords'
if target.exists():
    print('Vorhandene MQTT-Passwortdatei beibehalten.')
    raise SystemExit(0)
values = {}
for line in (root / '.env').read_text().splitlines():
    key, sep, value = line.partition('=')
    if sep:
        values[key.strip()] = value.strip().strip('\"\'')
username = values.get('GOVEE_MQTT_USER', '')
password = values.get('GOVEE_MQTT_PASSWORD', '')
if not username or any(c in username for c in ':\r\n') or len(password) < 24:
    raise SystemExit('Zuerst python3 scripts/setup-security.py ausführen.')
result = subprocess.run(['docker', 'compose', 'config', '--format', 'json'], cwd=root, capture_output=True, text=True)
if result.returncode:
    raise SystemExit('Compose-Konfiguration nicht lesbar; zuerst die lokale .env konfigurieren.')
image = json.loads(result.stdout)['services']['mosquitto']['image']
if not image.startswith('eclipse-mosquitto:') or '@sha256:' not in image:
    raise SystemExit('MQTT-Image muss auf einen geprüften Hersteller-Digest festgelegt sein.')
config_dir.mkdir(parents=True, exist_ok=True)
temporary = config_dir / ('passwords-setup-' + secrets.token_hex(8))
descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
try:
    with os.fdopen(descriptor, 'w') as file:
        file.write(username + ':' + password + '\n')
    command = ['docker', 'run', '--rm', '--network', 'none', '--user', f'{os.getuid()}:{os.getgid()}',
               '--entrypoint', 'mosquitto_passwd', '-v', str(config_dir) + ':/config', image,
               '-U', '/config/' + temporary.name]
    result = subprocess.run(command, cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    if result.returncode:
        raise SystemExit('MQTT-Passwortdatei konnte nicht sicher erzeugt werden.')
    os.chmod(temporary, 0o600)
    os.replace(temporary, target)
    if not (config_dir / 'acl').exists():
        (config_dir / 'acl').write_text('user ' + username + '\ntopic readwrite #\n')
finally:
    temporary.unlink(missing_ok=True)
print('Lokale MQTT-Passwortdatei eingerichtet. Zugangsdaten nicht veröffentlichen.')
