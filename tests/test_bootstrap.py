import importlib.util
import json
import os
from pathlib import Path
import stat
import tarfile
import tempfile
import unittest
import zipfile

ROOT=Path(__file__).parents[1]

def module(name, file):
    spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file)
    result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result

builder=module('release_builder','build-release.py')
bootstrap=module('bootstrap_finalize','bootstrap-finalize.py')

class BootstrapTests(unittest.TestCase):
    def fixture(self,folder):
        content={'package.json':json.dumps({'version':'0.3.0'}),'setup-miner.bat':'@echo off\r\n','setup-miner.ps1':'Write-Output "OK"\n','TELEPITES-GITHUB.md':'install\n','bootstrap-ubuntu.sh':'#!/bin/bash\r\ntrue\r\n'}
        content['release-manifest.json']=json.dumps({'files':list(content),'trees':{}})
        for name,text in content.items():(folder/name).write_bytes(text.encode())
        (folder/'.local').mkdir();(folder/'.local/connection.json').write_text('private local state')
        (folder/'data').mkdir();(folder/'data/wallets.json').write_text('private wallet')
        (folder/'screenshot.png').write_bytes(b'private screenshot')

    def test_reproducible_allowlist_and_windows_linux_line_endings(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);self.fixture(root)
            one=builder.build(root,root/'one','v0.3.0');two=builder.build(root,root/'two','v0.3.0')
            self.assertEqual([p.read_bytes() for p in one],[p.read_bytes() for p in two])
            with tarfile.open(one[0]) as tar:
                self.assertFalse(any(n.startswith(('data/','.local/')) or n.endswith('.png') for n in tar.getnames()))
                self.assertNotIn(b'\r',tar.extractfile('bootstrap-ubuntu.sh').read())
                self.assertTrue(tar.extractfile('setup-miner.ps1').read().startswith(b'\xef\xbb\xbf'))
                self.assertEqual(json.load(tar.extractfile('release.json'))['version'],'v0.3.0')
            with zipfile.ZipFile(one[3]) as zip:
                self.assertEqual(set(zip.namelist()),{'setup-miner.bat','setup-miner.ps1','TELEPITES-GITHUB.md'})

    def test_wrong_release_version_and_private_path_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);self.fixture(root)
            with self.assertRaises(ValueError):builder.build(root,root/'out','v9.0.0')
            (root/'release-manifest.json').write_text(json.dumps({'files':['.local/connection.json'],'trees':{}}))
            with self.assertRaises(ValueError):list(builder.files(root))

    def test_accidental_token_in_allowed_source_rejected_without_printing_it(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);self.fixture(root);(root/'setup-miner.ps1').write_text('ghp_'+'A'*36)
            with self.assertRaisesRegex(ValueError,'setup-miner.ps1'):list(builder.files(root))

    def test_existing_credentials_do_not_rotate_or_issue_another_key(self):
        previous={'schema':1,'webUsername':'miner','webPassword':'saved','apiToken':'old','apiKeyId':'old-id'}
        result,created=bootstrap.new_credentials(previous,None,lambda:self.fail('must not issue another key'))
        self.assertEqual(result,previous);self.assertFalse(created)

    def test_fresh_machine_gets_independent_credentials_and_preserves_existing_auth(self):
        issue=lambda:{'token':'lf_'+'a'*64,'key':{'id':'test-id'}}
        first,created=bootstrap.new_credentials(None,None,issue);second,_=bootstrap.new_credentials(None,None,issue)
        self.assertTrue(created);self.assertEqual(len(first['webPassword']),32);self.assertNotEqual(first['webPassword'],second['webPassword'])
        old='existing:$2y$10$'+'.'*53
        saved,_=bootstrap.new_credentials(None,old,issue);self.assertEqual(saved['webUsername'],'existing');self.assertIsNone(saved['webPassword'])

    def test_private_credentials_write_and_release_metadata_validation(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);self.fixture(root)
            (root/'release.json').write_text(json.dumps({'repository':builder.REPOSITORY,'version':'v0.3.0'}))
            self.assertEqual(bootstrap.validate_release(root)['version'],'v0.3.0')
            target=root/'credentials/install.json';bootstrap.write_private(target,{'webPassword':'test-only'})
            self.assertEqual(json.loads(target.read_text())['webPassword'],'test-only')
            if os.name=='posix':self.assertEqual(stat.S_IMODE(target.stat().st_mode),0o600)

    def test_real_release_manifest_excludes_all_machine_state(self):
        names=[name for name,_ in builder.files(ROOT)]
        self.assertIn('bootstrap-ubuntu.sh',names);self.assertIn('scripts/bootstrap-finalize.py',names)
        self.assertFalse(any(n.startswith(('data/','.local/','dist/')) or n.endswith(('.png','.pyc')) for n in names))
