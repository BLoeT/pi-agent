#!/usr/bin/env python3
"""Reproducible syntax and isolated regression checks; no productive workspace mounts."""
import argparse
import ast
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def run(arguments, *, environment=None):
    print('→ ' + ' '.join(str(value) for value in arguments[:5]), flush=True)
    subprocess.run(arguments, cwd=ROOT, env=environment, check=True)


def check_python():
    files = list(ROOT.glob('*.py'))
    for directory in ['scripts', 'tests', 'ribo_services', 'imagegen-service']:
        files.extend((ROOT / directory).rglob('*.py'))
    for file in files:
        ast.parse(file.read_text(), filename=str(file))
    for directory in ['pi-agent', 'pi-telegram', 'ha-service']:
        for name in ['package.json', 'package-lock.json']:
            json.loads((ROOT / directory / name).read_text())
    print(f'Python syntax: {len(files)} files checked; service manifests parsed', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--all', action='store_true', help='Build own images and run all offline regression tests')
    args = parser.parse_args()
    check_python()
    run(['bash', '-n', 'start.sh'])
    if args.all:
        run(['docker', 'compose', 'build', 'pi-agent', 'pi-telegram'])
    run(['docker', 'run', '--rm', '--network', 'none', '--read-only', '--tmpfs', '/tmp',
         '-v', f'{ROOT}/pi-agent:/source/pi-agent:ro',
         '-v', f'{ROOT}/pi-telegram:/source/pi-telegram:ro',
         '-v', f'{ROOT}/shared:/source/shared:ro',
         '-v', f'{ROOT}/scripts:/source/scripts:ro',
         '--entrypoint', 'node', 'pi-agent-pi-agent:latest',
         '/source/scripts/check-js.mjs', '/source'])
    if not args.all:
        return
    run(['docker', 'run', '--rm', '--network', 'none', '--read-only', '--tmpfs', '/tmp',
         '--tmpfs', '/workspace:mode=1777', '-e', 'RIBO_TEST_ISOLATED=1',
         '-e', 'RIBO_INTERNAL_TOKEN=synthetic-test-token-0000000000000000000000',
         '-e', 'TZ=Europe/Berlin', '--entrypoint', 'sh', 'pi-agent-pi-agent:latest',
         '-c', 'node --test /app/tests/*.test.mjs'])
    run(['docker', 'run', '--rm', '--network', 'none', '--read-only', '--tmpfs', '/tmp',
         '-e', 'TZ=Europe/Berlin', '-v', f'{ROOT}/pi-telegram/tests:/app/tests:ro',
         '--entrypoint', 'sh', 'pi-agent-pi-telegram:latest', '-c', 'node --test /app/tests/*.test.mjs'])
    run([sys.executable, '-m', 'unittest', 'discover', '-s', 'tests'])
    print('All checks passed. No real model, Telegram messages or device actions were used.', flush=True)


if __name__ == '__main__':
    main()
