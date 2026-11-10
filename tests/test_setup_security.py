from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class SetupTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        (self.root / 'scripts').mkdir()
        for name in ['setup-security.py', 'setup-mqtt.py']:
            shutil.copyfile(ROOT / 'scripts' / name, self.root / 'scripts' / name)

    def tearDown(self):
        self.temporary.cleanup()

    def run_script(self, name):
        return subprocess.run([sys.executable, str(self.root / 'scripts' / name)], capture_output=True, text=True)

    def test_credentials_are_private_preserved_and_not_printed(self):
        env = self.root / '.env'
        env.write_text('EXISTING_SETTING=keep-me\n')
        first = self.run_script('setup-security.py')
        self.assertEqual(first.returncode, 0, first.stderr)
        content = env.read_text()
        values = dict(line.split('=', 1) for line in content.splitlines() if '=' in line)
        self.assertEqual(values['EXISTING_SETTING'], 'keep-me')
        for key in ['RIBO_INTERNAL_TOKEN', 'RIBO_WEB_PASSWORD', 'GOVEE_MQTT_PASSWORD']:
            self.assertGreaterEqual(len(values[key]), 24)
            self.assertNotIn(values[key], first.stdout + first.stderr)
        self.assertEqual(env.stat().st_mode & 0o777, 0o600)
        self.assertEqual((self.root / '.ribo-browser-access.txt').stat().st_mode & 0o777, 0o600)
        second = self.run_script('setup-security.py')
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual(content, env.read_text())

    def test_existing_mqtt_hash_is_not_replaced(self):
        directory = self.root / 'mosquitto/config'
        directory.mkdir(parents=True)
        password = directory / 'passwords'
        password.write_text('existing-test-hash')
        result = self.run_script('setup-mqtt.py')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(password.read_text(), 'existing-test-hash')

    def test_invalid_mqtt_username_is_rejected_before_docker(self):
        (self.root / '.env').write_text('GOVEE_MQTT_USER=bad:user\nGOVEE_MQTT_PASSWORD=' + 'x' * 32 + '\n')
        result = self.run_script('setup-mqtt.py')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / 'mosquitto/config/passwords').exists())


if __name__ == '__main__':
    unittest.main()
