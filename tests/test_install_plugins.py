import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]

class InstallPluginTests(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory()
        self.root=Path(self.temporary.name)
        (self.root/'scripts').mkdir();(self.root/'workspace').mkdir()
        self.script=self.root/'scripts/install-default-plugins.py'
        shutil.copyfile(ROOT/'scripts/install-default-plugins.py',self.script)
        (self.root/'workspace/users.json').write_text(json.dumps({'users':{'alice':{'permissions':['admin']},'bob':{'permissions':[]}}}))
    def tearDown(self):self.temporary.cleanup()
    def run_installer(self,user='alice'):
        return subprocess.run([sys.executable,str(self.script),'--admin',user],capture_output=True,text=True)
    def test_defaults_preserve_existing_acl(self):
        self.assertEqual(self.run_installer().returncode,0)
        meta=self.root/'workspace/plugins/send_message.meta.json'
        self.assertEqual(json.loads(meta.read_text())['allowed_users'],['alice'])
        meta.write_text('{"allowed_users":[]}')
        self.assertEqual(self.run_installer().returncode,0)
        self.assertEqual(json.loads(meta.read_text())['allowed_users'],[])
    def test_existing_custom_code_is_not_automatically_approved(self):
        folder=self.root/'workspace/plugins';folder.mkdir()
        (folder/'send_message.js').write_text('export default {name:"custom"};')
        self.assertEqual(self.run_installer().returncode,0)
        self.assertFalse((folder/'send_message.meta.json').exists())
        self.assertIn('custom',(folder/'send_message.js').read_text())
    def test_non_admin_is_rejected(self):
        self.assertNotEqual(self.run_installer('bob').returncode,0)
        self.assertFalse((self.root/'workspace/plugins').exists())
