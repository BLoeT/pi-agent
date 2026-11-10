from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'imagegen-service'))
from pipeline import ImagePipeline
from service_config import ImagegenConfig


class ImagePipelineTests(unittest.TestCase):
    def test_config_is_explicit_and_rejects_invalid_ports(self):
        config = ImagegenConfig.from_env({})
        self.assertEqual(config.default_engine, 'flux2')
        self.assertFalse(config.reuse_model)
        with self.assertRaises(ValueError):
            ImagegenConfig.from_env({'IMAGEGEN_PORT': 'invalid'})
        with self.assertRaises(ValueError):
            ImagegenConfig.from_env({'IMAGEGEN_PORT': '70000'})

    def test_video_releases_cached_image_worker_before_cli(self):
        with tempfile.TemporaryDirectory() as directory:
            config = ImagegenConfig.from_env({'IMAGEGEN_OUTPUT_DIR': directory, 'IMAGEGEN_VIDEO_OUTPUT_DIR': directory, 'IMAGEGEN_REUSE_MODEL': '1'})
            service = ImagePipeline(config)
            service.worker.close = Mock()
            def fake_run(command, **kwargs):
                service.worker.close.assert_called_once()
                return subprocess.CompletedProcess(command, 1, '', 'synthetic failure')
            with patch('pipeline.run_generation', side_effect=fake_run):
                output, error = service.generate_video('synthetic prompt')
            self.assertIsNone(output)
            self.assertEqual(error, 'synthetic failure')

    def test_http_process_handles_sigterm_cleanly_without_loading_a_model(self):
        import json
        import os
        import signal
        import socket
        import time
        from urllib.request import urlopen
        with tempfile.TemporaryDirectory() as directory:
            with socket.socket() as listener:
                listener.bind(('127.0.0.1', 0))
                port = listener.getsockname()[1]
            env = {**os.environ, 'RIBO_INTERNAL_TOKEN': 'test-signal-token-' + 'x' * 40,
                   'IMAGEGEN_PORT': str(port), 'IMAGEGEN_OUTPUT_DIR': directory,
                   'IMAGEGEN_VIDEO_OUTPUT_DIR': directory}
            child = subprocess.Popen([sys.executable, str(ROOT / 'imagegen-service/server.py')], env=env,
                                     stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            try:
                ready = False
                for _ in range(50):
                    try:
                        with urlopen(f'http://127.0.0.1:{port}/health', timeout=.5) as response:
                            ready = json.load(response)['status'] == 'ok'
                    except OSError:
                        time.sleep(.05)
                    if ready:
                        break
                self.assertTrue(ready)
                child.send_signal(signal.SIGTERM)
                self.assertEqual(child.wait(timeout=3), 0)
            finally:
                if child.poll() is None:
                    child.kill()
                    child.wait()
                child.stderr.close()

    def test_output_cleanup_failure_is_reported_without_breaking_lifecycle(self):
        from jobs import cleanup_outputs
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'partial.png'
            file.write_bytes(b'partial')
            with patch('jobs.os.unlink', side_effect=PermissionError(13, 'synthetic')):
                self.assertEqual(cleanup_outputs([str(file)]), 1)
            self.assertTrue(file.exists())
            self.assertEqual(cleanup_outputs([str(file)]), 0)
            self.assertFalse(file.exists())

    def test_worker_releases_only_unused_buffers_and_reports_memory(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location('image_memory_worker', ROOT / 'imagegen-service/model_worker.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        mx = Mock()
        mx.get_cache_memory.side_effect = [4096, 0]
        mx.get_active_memory.return_value = 8192
        mx.get_peak_memory.return_value = 16384
        result = module.release_temporary_memory(mx)
        mx.synchronize.assert_called_once()
        mx.clear_cache.assert_called_once()
        self.assertEqual(result, {'cache_before_bytes': 4096, 'cache_after_bytes': 0,
                                 'active_bytes': 8192, 'peak_bytes': 16384})
