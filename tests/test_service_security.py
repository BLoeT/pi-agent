import importlib.util
import io
import os
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('security', Path(__file__).resolve().parents[1] / 'ribo_service_security.py')
security = importlib.util.module_from_spec(spec)
spec.loader.exec_module(security)


class Handler:
    def __init__(self, headers, path='/generate'):
        self.headers, self.path = headers, path
        self.wfile = io.BytesIO()
        self.connection = type('Connection', (), {'settimeout': lambda self, value: None})()
    def send_response(self, code): self.status = code
    def send_header(self, *args): pass
    def end_headers(self): pass


class ServiceSecurityTests(unittest.TestCase):
    def setUp(self): os.environ['RIBO_INTERNAL_TOKEN'] = 'x' * 48
    def test_authentication(self):
        self.assertFalse(security.authorize(Handler({})))
        self.assertTrue(security.authorize(Handler(security.internal_headers())))
    def test_upload_limits(self):
        for length in ['-2', 'bad', str(30 * 1024 * 1024)]:
            self.assertFalse(security.validate_length(Handler({'Content-Length': length})))
        self.assertTrue(security.validate_length(Handler({'Content-Length': '1024'})))
    def test_generation_limits(self):
        security.validate_generation({'prompt': 'Test', 'width': 1024, 'steps': 4})
        for payload in [{'width': 100000}, {'steps': -1}, {'frames': 10000}, {'prompt': ['bad']}, {'guidance': float('nan')}, {'init_image': '/etc/os-release'}]:
            with self.assertRaises((ValueError, OSError)): security.validate_generation(payload)


if __name__ == '__main__': unittest.main()
