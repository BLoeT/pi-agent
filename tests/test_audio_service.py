import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import types
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from ribo_runtime import BoundedHTTPServer

class AudioServiceTests(unittest.TestCase):
    def test_model_work_is_bounded_health_responds_and_failure_cleans_tempfiles(self):
        model = Mock()
        model.generate_audio.side_effect = RuntimeError('synthetic failure')
        deps = {name: types.ModuleType(name) for name in ['sounddevice','numpy','mlx_whisper','pocket_tts']}
        deps['pocket_tts'].TTSModel = Mock()
        deps['pocket_tts'].TTSModel.load_model.return_value = model
        with patch.dict(sys.modules,deps), patch.dict(os.environ,{'RIBO_INTERNAL_TOKEN':'t'*48}):
            spec=importlib.util.spec_from_file_location('test_ribo_audio',ROOT/'ribo_audio.py')
            audio=importlib.util.module_from_spec(spec)
            sys.modules[spec.name]=audio
            spec.loader.exec_module(audio)
            server=BoundedHTTPServer(('127.0.0.1',0),audio.MusicAPIHandler)
            threading.Thread(target=server.serve_forever,daemon=True).start()
            root='http://127.0.0.1:'+str(server.server_port)
            headers={'Authorization':'Bearer '+'t'*48,'Content-Type':'application/json'}
            def request():return Request(root+'/tts',data=json.dumps({'text':'Test'}).encode(),headers=headers)
            try:
                audio.audio_lock.acquire()
                try:
                    with self.assertRaises(HTTPError) as caught:urlopen(request(),timeout=1)
                    self.assertEqual(caught.exception.code,503)
                    caught.exception.close()
                    with urlopen(root+'/health',timeout=1) as response:self.assertEqual(response.status,200)
                finally:audio.audio_lock.release()
                with tempfile.TemporaryDirectory() as directory, patch.object(audio.tempfile,'tempdir',directory):
                    with self.assertRaises(HTTPError) as caught:urlopen(request(),timeout=2)
                    self.assertEqual(caught.exception.code,500)
                    caught.exception.close()
                    self.assertEqual(list(Path(directory).iterdir()),[])
                self.assertFalse(audio.audio_lock.locked())
            finally:
                server.shutdown();server.server_close();sys.modules.pop(spec.name,None)
