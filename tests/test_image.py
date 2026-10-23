import tarfile,unittest
from pathlib import Path
class ImagePayload(unittest.TestCase):
 def test_source_bundle_has_no_runtime_or_credentials(self):
  file=Path(__file__).resolve().parents[1]/'dist/image-source/localforge-v0.3.0.tar.gz'
  if not file.exists():self.skipTest('Build source bundle first')
  with tarfile.open(file) as tar:
   names=tar.getnames()
   self.assertIn('server.mjs',names);self.assertIn('scripts/localforge-oc.py',names)
   self.assertFalse(any(set(Path(n).parts)&{'.local','data','.git','json','node_modules'} for n in names))
 def test_install_requires_disk_and_identity_input(self):
  text=(Path(__file__).resolve().parents[1]/'image/user-data').read_text(encoding='utf-8-sig')
  self.assertIn('interactive-sections: [network, storage, identity]',text)
  self.assertNotIn('password:',text);self.assertNotIn('match:',text)
if __name__=='__main__':unittest.main()
