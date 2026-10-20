import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('updater', Path(__file__).resolve().parents[1] / 'scripts/download-miners.py')
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)


def archive(marker):
    content = b'\x7fELF\x02\x01' + b'\x00' * 12 + b'\x3e\x00' + marker
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w:gz') as tar:
        member = tarfile.TarInfo('miner/xmrig')
        member.size = len(content)
        tar.addfile(member, io.BytesIO(content))
    return buf.getvalue(), content


class UpdaterTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base_patch = patch.object(updater, 'BASE', Path(self.temp.name))
        self.base_patch.start()
        self.addCleanup(self.temp.cleanup)
        self.addCleanup(self.base_patch.stop)

    def install(self, version, payload, digest=None):
        release = {'tag_name': version, 'prerelease': False, 'draft': False, 'assets': [{
            'name': 'xmrig-linux-static-x64.tar.gz',
            'browser_download_url': f'https://github.com/xmrig/xmrig/releases/download/{version}/miner.tar.gz',
            'digest': digest or 'sha256:' + hashlib.sha256(payload).hexdigest()}]}
        calls = []

        def response(request, **kwargs):
            calls.append(request.full_url)
            return io.BytesIO(json.dumps(release).encode() if len(calls) == 1 else payload)
        with patch.object(updater.urllib.request, 'urlopen', response):
            changed = updater.download('xmrig/xmrig', lambda n: n.endswith('linux-static-x64.tar.gz'), 'xmrig')
        return changed, calls

    def test_new_skip_upgrade_backup_and_no_downgrade(self):
        first, first_binary = archive(b'first')
        self.assertTrue(self.install('v1.0.0', first)[0])
        changed, calls = self.install('v1.0.0', first)
        self.assertFalse(changed)
        self.assertEqual(len(calls), 1)
        second, second_binary = archive(b'second')
        self.assertTrue(self.install('v1.1.0', second)[0])
        self.assertEqual((updater.BASE / 'xmrig.previous').read_bytes(), first_binary)
        self.assertEqual((updater.BASE / 'xmrig').read_bytes(), second_binary)
        self.assertFalse(self.install('v1.0.0', first)[0])
        # A serult binaris azonos tag eseten is javithato.
        (updater.BASE / 'xmrig').write_bytes(b'broken')
        self.assertTrue(self.install('v1.1.0', second)[0])

    def test_bad_digest_preserves_installed_binary(self):
        first, content = archive(b'valid')
        self.install('v1.0.0', first)
        with self.assertRaisesRegex(RuntimeError, 'SHA256'):
            self.install('v1.1.0', first, 'sha256:' + '0' * 64)
        self.assertEqual((updater.BASE / 'xmrig').read_bytes(), content)
        self.assertEqual(json.loads((updater.BASE / 'xmrig.version.json').read_text())['version'], 'v1.0.0')

    def test_non_elf_binary_not_installed(self):
        payload, _ = archive(b'valid')
        # Ervenyes tar, de nem futtathato Linux binaris.
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode='w:gz') as tar:
            member = tarfile.TarInfo('xmrig')
            member.size = 3
            tar.addfile(member, io.BytesIO(b'bad'))
        with self.assertRaisesRegex(RuntimeError, 'ELF'):
            self.install('v1.0.0', buf.getvalue())
        self.assertFalse((updater.BASE / 'xmrig').exists())


if __name__ == '__main__':
    unittest.main()
