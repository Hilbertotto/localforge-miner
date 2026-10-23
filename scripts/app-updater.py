#!/usr/bin/python3 -I
"""Install an authenticated-origin stable release in a root-owned systemd job."""
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import time
import urllib.request

BASE=Path('/opt/localforge')
STATE=Path('/var/lib/localforge-updater')

def status(phase,message,**extra):
    file=STATE/'status.json'
    temporary=STATE/'status.new'
    temporary.write_text(json.dumps({'phase':phase,'message':message,'updatedAt':time.time(),**extra}))
    temporary.chmod(0o644)
    temporary.replace(file)

def healthy():
    for _ in range(40):
        try:
            with urllib.request.urlopen('http://127.0.0.1:8080/api/session',timeout=2) as response:
                if response.status==200:return True
        except Exception:pass
        time.sleep(1)
    return False

def backup():
    with tarfile.open(STATE/'previous-code.tar.gz','w:gz') as tar:
        for name in ['server.mjs','package.json','release.json','src','public','scripts','worker']:
            if (BASE/name).exists():tar.add(BASE/name,arcname=name)
    with tarfile.open(STATE/'previous-settings.tar.gz','w:gz') as tar:
        for file in Path('/var/lib/localforge').glob('*.json'):
            if file.is_file() and not file.is_symlink():tar.add(file,arcname=file.name)
    for file in ['previous-code.tar.gz','previous-settings.tar.gz']:(STATE/file).chmod(0o600)
    for name in ['localforge-oc','localforge-update']:
        shutil.copy2('/usr/local/sbin/'+name,STATE/(name+'.previous'))

def main():
    if os.geteuid()!=0:raise SystemExit('Root required')
    os.umask(0o077)
    STATE.mkdir(mode=0o755,exist_ok=True)
    STATE.chmod(0o755)
    with (STATE/'update.lock').open('w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        status('downloading','Stabil GitHub-kiadás letöltése és ellenőrzése…')
        spec=importlib.util.spec_from_file_location('release_fetch',BASE/'scripts/fetch-release.py')
        release=importlib.util.module_from_spec(spec);spec.loader.exec_module(release)
        with tempfile.TemporaryDirectory(prefix='stage-',dir=STATE) as folder:
            source=Path(folder)/'source'
            info=release.fetch(source)
            current=tuple(map(int,json.loads((BASE/'package.json').read_text())['version'].split('.')))
            candidate=tuple(map(int,info['version'][1:].split('.')))
            if candidate<=current:
                status('complete','A legújabb stabil verzió már telepítve van.',version=info['version']);return
            status('backing-up','Program- és beállításmentés készítése…',version=info['version'])
            backup()
            try:
                status('installing','Telepítés; a futó profilok visszaindulnak…',version=info['version'])
                subprocess.run(['/bin/bash',str(source/'scripts/update-app.sh')],cwd=source,check=True,timeout=600)
                shutil.copy2(source/'release.json',BASE/'release.json')
                if not healthy():raise RuntimeError('Az új szolgáltatás nem válaszol')
                status('complete','A frissítés sikeresen befejeződött.',version=info['version'])
            except Exception:
                status('rolling-back','A frissítés sikertelen; az előző program visszaállítása…')
                subprocess.run(['/usr/bin/systemctl','stop','localforge.service'],check=False)
                with tarfile.open(STATE/'previous-code.tar.gz') as tar:tar.extractall(BASE,filter='data')
                for name in ['localforge-oc','localforge-update']:shutil.copy2(STATE/(name+'.previous'),'/usr/local/sbin/'+name)
                subprocess.run(['/usr/bin/systemctl','start','localforge.service'],check=False)
                raise

if __name__=='__main__':
    try:main()
    except Exception as error:
        if STATE.is_dir():status('failed',str(error))
        raise
