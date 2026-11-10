import importlib.util
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from ribo_runtime import BoundedHTTPServer, SpeechQueue

class RuntimeTests(unittest.TestCase):
    def test_health_remains_available_during_work(self):
        entered, release = threading.Event(), threading.Event()
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path == '/slow':
                    entered.set()
                    release.wait(5)
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'ok')
            def log_message(self, *args): pass
        server = BoundedHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        root = 'http://127.0.0.1:' + str(server.server_port)
        def slow():
            with urlopen(root + '/slow', timeout=10) as response: response.read()
        worker = threading.Thread(target=slow)
        worker.start()
        try:
            self.assertTrue(entered.wait(2))
            with urlopen(root + '/health', timeout=1) as response:
                self.assertEqual(response.read(), b'ok')
        finally:
            release.set(); worker.join(); server.shutdown(); server.server_close()

    def test_speech_queue_is_bounded_and_recovers_after_error(self):
        entered, release, recovered = threading.Event(), threading.Event(), threading.Event()
        def speak(text):
            if text == 'first':
                entered.set(); release.wait(3); raise ValueError('test')
            recovered.set()
        queue = SpeechQueue(speak, threading.Lock(), capacity=1)
        self.assertTrue(queue.submit('first'))
        self.assertTrue(entered.wait(1))
        self.assertTrue(queue.submit('second'))
        self.assertFalse(queue.submit('excess'))
        release.set()
        self.assertTrue(recovered.wait(2))

    def test_worker_reuse_switch_and_timeout(self):
        spec = importlib.util.spec_from_file_location('worker_client', ROOT / 'imagegen-service/worker_client.py')
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory:
            worker = Path(directory) / 'fake.py'
            worker.write_text('import sys,json,time\nfor line in sys.stdin:\n job=json.loads(line)\n if job.get("slow"): time.sleep(5)\n print(json.dumps({"path":job["model"]}),flush=True)\n')
            client = module.ModelWorker(worker)
            try:
                job = {'model': 'one', 'quantize': 8}
                self.assertEqual(client.generate(job)['path'], 'one')
                first = client.process.pid
                client.generate(job)
                self.assertEqual(client.process.pid, first)
                self.assertEqual(client.generate({**job, 'model': 'two'})['path'], 'two')
                self.assertNotEqual(client.process.pid, first)
                with self.assertRaises(TimeoutError): client.generate({**job, 'slow': True}, timeout=.05)
                self.assertIsNone(client.process)
                self.assertEqual(client.generate(job)['path'], 'one')
            finally: client.close()
