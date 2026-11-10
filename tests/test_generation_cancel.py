import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from urllib.request import Request, urlopen
import uuid

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT));sys.path.insert(0,str(ROOT/'imagegen-service'))
from ribo_runtime import BoundedHTTPServer

class GenerationCancelTests(unittest.TestCase):
    def load_service(self,directory):
        spec=importlib.util.spec_from_file_location('test_imagegen',ROOT/'imagegen-service/server.py')
        module=importlib.util.module_from_spec(spec)
        with patch.dict(os.environ,{'RIBO_INTERNAL_TOKEN':'g'*48,'IMAGEGEN_OUTPUT_DIR':directory,'IMAGEGEN_VIDEO_OUTPUT_DIR':directory}):spec.loader.exec_module(module)
        return module

    def test_cli_process_exits_on_cancel(self):
        with tempfile.TemporaryDirectory() as directory:
            service=self.load_service(directory);cancel=threading.Event();errors=[]
            def work():
                service.job_context.cancel=cancel
                try:service.run_generation([sys.executable,'-c','import time;time.sleep(30)'],timeout=60,cwd=directory)
                except RuntimeError as error:errors.append(str(error))
            started=time.monotonic();worker=threading.Thread(target=work);worker.start();time.sleep(.15);cancel.set();worker.join(5)
            self.assertFalse(worker.is_alive());self.assertLess(time.monotonic()-started,5);self.assertEqual(errors,['Generierung abgebrochen'])

    def test_http_cancellation_targets_only_its_job(self):
        with tempfile.TemporaryDirectory() as directory,patch.dict(os.environ,{'RIBO_INTERNAL_TOKEN':'g'*48}):
            service=self.load_service(directory);entered=threading.Event()
            partial=Path(directory)/'partial.png'
            def fake_generate(**kwargs):
                partial.write_bytes(b'partial')
                service.job_context.outputs.append(str(partial))
                entered.set()
                self.assertTrue(service.job_context.cancel.wait(4))
                return None,'Generierung abgebrochen'
            service.generate_image=fake_generate
            server=BoundedHTTPServer(('127.0.0.1',0),service.Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
            root='http://127.0.0.1:'+str(server.server_port)
            def post(route,body):
                from urllib.error import HTTPError
                req=Request(root+route,data=json.dumps(body).encode(),headers={'Authorization':'Bearer '+'g'*48,'Content-Type':'application/json'})
                try:
                    with urlopen(req,timeout=6) as response:return json.load(response)
                except HTTPError as error:
                    with error:return json.load(error)
            result={};job_id=str(uuid.uuid4())
            worker=threading.Thread(target=lambda:result.update(post('/generate',{'prompt':'synthetic','job_id':job_id})));worker.start()
            try:
                self.assertTrue(entered.wait(2))
                self.assertFalse(post('/cancel',{'job_id':str(uuid.uuid4())})['cancelled'])
                self.assertTrue(post('/cancel',{'job_id':job_id})['cancelled'])
                worker.join(4);self.assertFalse(worker.is_alive());self.assertIn('abgebrochen',result['error']);self.assertEqual(service.jobs,{});self.assertFalse(partial.exists())
            finally:server.shutdown();server.server_close()
