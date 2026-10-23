import importlib.util,unittest,io,tarfile,json,tempfile
from pathlib import Path
spec=importlib.util.spec_from_file_location('fetch_release',Path(__file__).resolve().parents[1]/'scripts/fetch-release.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
def archive(extra=None):
 out=io.BytesIO()
 with tarfile.open(fileobj=out,mode='w:gz') as tar:
  values={'package.json':json.dumps({'version':'0.4.0'}),'release.json':json.dumps({'version':'v0.4.0','repository':module.REPOSITORY}),'server.mjs':'','install-web.sh':'','scripts/update-app.sh':''}
  if extra:values.update(extra)
  for name,value in values.items():
   data=value.encode();info=tarfile.TarInfo(name);info.size=len(data);tar.addfile(info,io.BytesIO(data))
 return out.getvalue()
class FetchRelease(unittest.TestCase):
 def test_valid_release(self):
  with tempfile.TemporaryDirectory() as d:self.assertTrue(module.unpack(archive(),Path(d)/'out','v0.4.0').is_dir())
 def test_traversal_and_private_runtime_paths_rejected(self):
  for name in ['../escape','/absolute','.local/connection.json','data/wallets.json']:
   with tempfile.TemporaryDirectory() as d:
    with self.assertRaises(ValueError):module.unpack(archive({name:'bad'}),Path(d)/'out','v0.4.0')
 def test_version_mismatch_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   with self.assertRaises(ValueError):module.unpack(archive(),Path(d)/'out','v0.5.0')
if __name__=='__main__':unittest.main()
