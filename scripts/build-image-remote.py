import importlib.util,json,sys,shlex,uuid,hashlib,subprocess,datetime
from pathlib import Path
spec=importlib.util.spec_from_file_location('remote',Path(__file__).with_name('remote-connection.py'));r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r);c=json.load(sys.stdin);client=r.connect(c);root=Path(__file__).resolve().parents[1]
try:
 subprocess.run([sys.executable,str(root/'scripts/build-release.py'),'--output',str(root/'dist/image-source')],check=True)
 source=root/'dist/image-source'/('localforge-v'+json.loads((root/'package.json').read_text())['version']+'.tar.gz')
 r.run_remote(client,"sudo -S -p '' apt-get update -qq",c['sudoPassword'],secrets=(c['password'],c['sudoPassword']))
 r.run_remote(client,"sudo -S -p '' env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends xorriso qemu-system-x86 ovmf python3-yaml > /tmp/localforge-image-tools.log 2>&1",c['sudoPassword'],secrets=(c['password'],c['sudoPassword']))
 with client.open_sftp() as sftp:
  target=sftp.normalize('.')+'/localforge-image-'+uuid.uuid4().hex[:10];sftp.mkdir(target,mode=0o700)
  (root/'dist/image-build-state.json').write_text(json.dumps({'remote':target,'host':c['host']}),encoding='utf-8')
  for name in ['user-data','meta-data','firstboot.sh','show-info.sh','localforge-firstboot.service','build-iso.sh']:
   with sftp.file(target+'/'+name,'w') as f:f.write((root/'image'/name).read_text(encoding='utf-8-sig').replace('\r\n','\n'))
  sftp.put(str(source),target+'/source.tar.gz')
  info={'name':'LocalForge Ubuntu installer','base':'Ubuntu Server 26.04.1 amd64','sourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root).decode().strip(),'sourceSha256':hashlib.sha256((source).read_bytes()).hexdigest(),'networkRequired':True,'firstBootProvisioning':True,'created':datetime.datetime.now(datetime.timezone.utc).isoformat()}
  with sftp.file(target+'/build-info.json','w') as f:f.write(json.dumps(info,indent=2))
 print('REMOTE_BUILD',target,flush=True)
 r.run_remote(client,'bash '+shlex.quote(target+'/build-iso.sh'),None,secrets=(c['password'],c['sudoPassword']))
 print('REMOTE_ARTIFACT_READY',flush=True)
finally:client.close()
