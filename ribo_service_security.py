"""Shared authentication and input limits for the native Ribo services (stdlib only)."""
import hmac
import json
import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent


def configure():
    # uv --env-file loads the full configuration. Direct Python launches still
    # get the service credential without importing a third-party dotenv loader.
    env_file = PROJECT_ROOT / '.env'
    if env_file.is_file() and not os.getenv('RIBO_INTERNAL_TOKEN'):
        for line in env_file.read_text().splitlines():
            key, sep, value = line.partition('=')
            if sep and key.strip() == 'RIBO_INTERNAL_TOKEN':
                os.environ[key.strip()] = value.strip().strip('\"\'')
    if len(os.getenv('RIBO_INTERNAL_TOKEN', '')) < 32:
        raise RuntimeError('RIBO_INTERNAL_TOKEN fehlt. Zuerst scripts/setup-security.py ausführen.')


def internal_headers():
    return {'Authorization': 'Bearer ' + os.environ['RIBO_INTERNAL_TOKEN']}


def reject(handler, status, message):
    body = json.dumps({'error': message}).encode()
    handler.send_response(status)
    handler.send_header('Content-Type', 'application/json')
    handler.send_header('Content-Length', str(len(body)))
    handler.send_header('Connection', 'close')
    handler.end_headers()
    handler.wfile.write(body)
    handler.close_connection = True
    return False


def authorize(handler):
    handler.connection.settimeout(15)
    expected = internal_headers()['Authorization']
    if not hmac.compare_digest(handler.headers.get('Authorization', ''), expected):
        return reject(handler, 401, 'Dienstanmeldung erforderlich')
    return True


def validate_length(handler):
    limit = 20 * 1024 * 1024 if handler.path == '/transcribe' else 256 * 1024
    try:
        length = int(handler.headers.get('Content-Length', '-1'))
    except ValueError:
        return reject(handler, 400, 'Ungültige Content-Length')
    if length < 0 or handler.headers.get('Transfer-Encoding'):
        return reject(handler, 411, 'Content-Length erforderlich')
    if length > limit:
        return reject(handler, 413, 'Anfrage zu groß')
    return True


def validate_generation(body, video=False):
    if not isinstance(body, dict):
        raise ValueError('JSON-Objekt erforderlich')
    prompt = body.get('prompt', '')
    if not isinstance(prompt, str) or len(prompt) > 8000:
        raise ValueError('Prompt ungültig oder zu lang')
    limits = {'width': (128 if video else 256, 768 if video else 2048),
              'height': (128 if video else 256, 768 if video else 2048),
              'steps': (1, 50), 'frames': (5, 121), 'fps': (1, 30),
              'seed': (0, 2**32 - 1)}
    for name, (low, high) in limits.items():
        if name in body and (type(body[name]) is not int or not low <= body[name] <= high):
            raise ValueError(f'{name} muss eine ganze Zahl zwischen {low} und {high} sein')
    for name, low, high in [('guidance', 0, 20), ('guidance_2', 0, 20), ('image_strength', 0, 1)]:
        if name in body and (type(body[name]) not in (float, int) or not low <= body[name] <= high):
            raise ValueError(f'{name} außerhalb des erlaubten Bereichs')
    for name in ['model', 'engine', 'negative_prompt']:
        if name in body and (not isinstance(body[name], str) or len(body[name]) > 8000):
            raise ValueError(f'{name} ungültig')
    if body.get('init_image'):
        source = Path(body['init_image']).resolve(strict=True)
        allowed = (PROJECT_ROOT / 'workspace/users').resolve()
        if not source.is_relative_to(allowed) or not source.is_file() or source.suffix.lower() not in {'.png', '.jpg', '.jpeg', '.webp'}:
            raise ValueError('Quellbild außerhalb des erlaubten Workspace')
        if source.stat().st_size > 20 * 1024 * 1024:
            raise ValueError('Quellbild zu groß')
