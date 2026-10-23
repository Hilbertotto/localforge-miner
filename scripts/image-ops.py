import importlib.util,json,sys,shlex,hashlib,time
from pathlib import Path
spec=importlib.util.spec_from_file_location('remote',Path(__file__).with_name('remote-connection.py'));r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r);c=json.load(sys.stdin);client=r.connect(c);root=Path(__file__).resolve().parents[1];state=json.loads((root/'dist/image-build-state.json').read_text());target=state['remote'];mode=sys.argv[1]
try:
 if mode=='preflight':
  with client.open_sftp() as sftp:
   for name in ['build-iso.sh','firstboot.sh','show-info.sh','user-data','meta-data','localforge-firstboot.service']:
    with sftp.file(target+'/'+name,'w') as f:f.write((root/'image'/name).read_text(encoding='utf-8-sig').replace('\r\n','\n'))
  r.run_remote(client,"sudo -S -p '' env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends python3-jsonschema > /tmp/localforge-schema-tools.log 2>&1",c['sudoPassword'],secrets=(c['password'],c['sudoPassword']))
  script="import json,yaml,urllib.request,jsonschema; x=yaml.safe_load(open('user-data')); schema=json.load(urllib.request.urlopen('https://raw.githubusercontent.com/canonical/subiquity/main/autoinstall-schema.json'));jsonschema.validate(x['autoinstall'],schema);print('AUTOINSTALL_SCHEMA_OK')"
  r.run_remote(client,'cd '+shlex.quote(target)+'; bash -n firstboot.sh; bash -n show-info.sh; bash -n build-iso.sh; python3 -c '+shlex.quote(script),None)
 elif mode=='authenticity':
  r.run_remote(client,'cd '+shlex.quote(target)+'; curl -fsSL https://releases.ubuntu.com/26.04/SHA256SUMS.gpg -o ubuntu-SHA256SUMS.gpg; gpgv --keyring /usr/share/keyrings/ubuntu-archive-keyring.gpg ubuntu-SHA256SUMS.gpg ubuntu-SHA256SUMS',None)
 elif mode=='mirror':
  script="import pathlib,os,signal,time; target="+repr(target)+"\nfor p in pathlib.Path('/proc').iterdir():\n if not p.name.isdigit():continue\n try:\n  args=(p/'cmdline').read_bytes().split(b'\\0')\n  if os.readlink(p/'cwd')==target and args[0] in (b'aria2c',b'/usr/bin/aria2c'):os.kill(int(p.name),signal.SIGTERM)\n except (OSError,IndexError):pass\ntime.sleep(1)"
  r.run_remote(client,'python3 -c '+shlex.quote(script),None)
  r.run_remote(client,'cd '+shlex.quote(target)+'; aria2c -x8 -s8 -k16M -c --file-allocation=none --summary-interval=30 --show-console-readout=false -o ubuntu-26.04.1-live-server-amd64.iso https://cz.releases.ubuntu.com/26.04/ubuntu-26.04.1-live-server-amd64.iso https://releases.ubuntu.com/26.04/ubuntu-26.04.1-live-server-amd64.iso',None)
 elif mode in ['accelerate','stop-single']:
  r.run_remote(client,"sudo -S -p '' env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends aria2 > /tmp/localforge-aria.log 2>&1",c['sudoPassword'],secrets=(c['password'],c['sudoPassword']))
  script='import pathlib,os,signal; target='+repr(target)+'; '+"\nfor p in pathlib.Path('/proc').iterdir():\n if not p.name.isdigit():continue\n try:\n  args=(p/'cmdline').read_bytes().split(b'\\0');cwd=os.readlink(p/'cwd')\n  if cwd==target and args[0] in (b'curl',b'/usr/bin/curl') and b'https://releases.ubuntu.com/26.04/ubuntu-26.04.1-live-server-amd64.iso' in args:os.kill(int(p.name),signal.SIGTERM);print('Stopped verified single-connection download')\n except (OSError,IndexError):pass"
  r.run_remote(client,'python3 -c '+shlex.quote(script),None)
  if mode=='accelerate':r.run_remote(client,'cd '+shlex.quote(target)+'; aria2c -x8 -s8 -k16M -c --file-allocation=none --summary-interval=30 --show-console-readout=false -o ubuntu-26.04.1-live-server-amd64.iso https://releases.ubuntu.com/26.04/ubuntu-26.04.1-live-server-amd64.iso',None)
 elif mode=='status':r.run_remote(client,'cd '+shlex.quote(target)+'; ls -lh *.iso; tail -n 3 build.log 2>/dev/null || true',None)
 elif mode=='resume':
  with client.open_sftp() as sftp:
   sftp.put(str(root/'scripts/fetch-release.py'),target+'/fetch-release.py')
   for name in ['build-iso.sh','firstboot.sh','show-info.sh','user-data','meta-data','localforge-firstboot.service']:
    with sftp.file(target+'/'+name,'w') as f:f.write((root/'image'/name).read_text(encoding='utf-8-sig').replace('\r\n','\n'))
  r.run_remote(client,'bash '+shlex.quote(target+'/build-iso.sh'),None,secrets=(c['password'],c['sudoPassword']))
 elif mode=='boot':
  with client.open_sftp() as sftp:
   with sftp.file(target+'/test-boot.sh','w') as f:f.write((root/'image/test-boot.sh').read_text(encoding='utf-8-sig').replace('\r\n','\n'))
  r.run_remote(client,'bash '+shlex.quote(target+'/test-boot.sh'),None)
  with client.open_sftp() as sftp:
   for firmware in ['bios','uefi']:
    for suffix in ['summary.txt','serial.log']:
     sftp.get(target+'/test-'+firmware+'.'+suffix,str(root/'dist'/('iso-test-'+firmware+'.'+suffix)))
 elif mode=='fast-fetch':
  with client.open_sftp() as sftp:
   digest=sftp.file(target+'/SHA256SUMS').read().decode().split()[0]
   name='localforge-ubuntu-26.04.1-amd64.iso';total=sftp.stat(target+'/'+name).st_size
   sftp.get(target+'/boot-report.txt',str(root/'dist/iso-boot-report.txt'))
  output=root/'dist'/name;done=output.stat().st_size if output.exists() else 0
  if done>total:raise RuntimeError('Unexpected local ISO length')
  channel=client.get_transport().open_session(window_size=32*1024*1024,max_packet_size=256*1024);channel.settimeout(120)
  channel.exec_command('tail -c +'+str(done+1)+' -- '+shlex.quote(target+'/'+name))
  last=-1;started=time.monotonic();initial=done
  with output.open('ab') as f:
   while True:
    data=channel.recv(1024*1024)
    if not data:break
    f.write(data);done+=len(data);percent=int(done*10/total)*10
    if percent!=last:print('COPY',percent,'%',round((done-initial)/max(time.monotonic()-started,.001)/1024/1024,1),'MiB/s',flush=True);last=percent
  if channel.recv_exit_status()!=0 or done!=total:raise RuntimeError('ISO copy incomplete')
  actual=hashlib.file_digest(output.open('rb'),'sha256').hexdigest()
  if actual!=digest:raise RuntimeError('Downloaded ISO hash mismatch')
  (root/'dist/LocalForge-ISO-SHA256SUMS.txt').write_text(digest+'  '+name+'\n')
  print('ISO_LOCAL_HASH_VERIFIED',digest,flush=True)
 elif mode=='fetch':
  with client.open_sftp() as sftp:
   digest=sftp.file(target+'/SHA256SUMS').read().decode().split()[0]
   name='localforge-ubuntu-26.04.1-amd64.iso';last=[-1]
   def progress(done,total):
    percent=int(done*10/total)*10
    if percent!=last[0]:print('DOWNLOAD',percent,'%',flush=True);last[0]=percent
   sftp.get(target+'/'+name,str(root/'dist'/name),callback=progress,max_concurrent_prefetch_requests=64)
   actual=hashlib.file_digest((root/'dist'/name).open('rb'),'sha256').hexdigest()
   if actual!=digest:raise RuntimeError('Downloaded ISO hash mismatch')
   (root/'dist/LocalForge-ISO-SHA256SUMS.txt').write_text(digest+'  '+name+'\n')
   sftp.get(target+'/boot-report.txt',str(root/'dist/iso-boot-report.txt'))
   print('ISO_LOCAL_HASH_VERIFIED',digest,flush=True)
 elif mode=='validate':
  command='cd '+shlex.quote(target)+"; bash -n firstboot.sh; bash -n show-info.sh; bash -n build-iso.sh; python3 -c 'import yaml; x=yaml.safe_load(open(\"user-data\")); assert x[\"autoinstall\"][\"interactive-sections\"]==[\"network\",\"storage\",\"identity\"]; print(\"YAML_OK\")'; grep -E 'BIOS|UEFI|El Torito|GPT' boot-report.txt | head -n 12"
  r.run_remote(client,command,None)
finally:client.close()
