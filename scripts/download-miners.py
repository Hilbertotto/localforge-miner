#!/usr/bin/python3
"""Download official Linux x64 releases. Never execute downloads as root."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import tarfile
import tempfile
import urllib.request
import argparse
import datetime
import re
from contextlib import contextmanager

BASE = Path('/opt/localforge/miners')


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def atomic_json(path, data):
    temp = path.with_suffix(path.suffix + '.new')
    temp.write_text(json.dumps(data, indent=2), encoding='utf-8')
    os.replace(temp, path)


@contextmanager
def update_lock():
    import fcntl  # Linux installer/timer mutual exclusion
    BASE.mkdir(parents=True, exist_ok=True)
    with (BASE / '.update.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        yield


def download(repo, match, binary):
    headers = {'User-Agent': 'LocalForge-installer', 'Accept': 'application/vnd.github+json'}
    request = urllib.request.Request(f'https://api.github.com/repos/{repo}/releases/latest', headers=headers)
    with urllib.request.urlopen(request, timeout=45) as response:
        release = json.load(response)
    if release.get('prerelease') or release.get('draft'):
        raise RuntimeError('Csak stabil, publikalt kiadas telepitheto')
    target = BASE / binary
    version_file = BASE / (binary + '.version.json')
    try:
        installed = json.loads(version_file.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        installed = {}
    tag = release['tag_name']
    # A latest cimke visszamutatasa ne okozzon automatikus downgrade-et.
    def version(value):
        return tuple(map(int, value.lstrip('v').split('.'))) if re.fullmatch(r'v?\d+(\.\d+)*', value) else None
    old, new = version(installed.get('version', '')), version(tag)
    if target.is_file() and installed.get('binary_sha256') == sha(target):
        if installed.get('version') == tag or (old and new and old > new):
            print(f'{binary}: mar telepitve ({installed["version"]}), nincs ujabb kiadas.', flush=True)
            return False
    candidates = [asset for asset in release['assets'] if match(asset['name'])]
    if len(candidates) != 1:
        raise RuntimeError(f'{repo}: nem egyertelmu Linux x64 csomag. Kezi telepites szukseges.')
    asset = candidates[0]
    url = asset['browser_download_url']
    if not url.startswith(f'https://github.com/{repo}/releases/download/'):
        raise RuntimeError('Varatlan letoltesi cim')
    print(f'{repo}: {release["tag_name"]} / {asset["name"]}', flush=True)
    with tempfile.TemporaryDirectory() as temp:
        archive = Path(temp) / 'miner.tar.gz'
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=120) as src, archive.open('wb') as dst:
            shutil.copyfileobj(src, dst)
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        expected = asset.get('digest')
        if expected:
            if expected != 'sha256:' + digest:
                raise RuntimeError('SHA256 ellenorzes sikertelen')
            print('GitHub SHA256 egyezik.', flush=True)
        else:
            print('Nincs GitHub asset digest; HTTPS letoltes. SHA256: ' + digest, flush=True)
        with tarfile.open(archive, 'r:gz') as tar:
            members = [m for m in tar.getmembers() if m.isfile() and Path(m.name).name == binary]
            if len(members) != 1:
                raise RuntimeError('A csomagban nem talalhato egyertelmu binaris')
            with tar.extractfile(members[0]) as src, (BASE / (binary + '.new')).open('wb') as dst:
                shutil.copyfileobj(src, dst)
        # Linux x86-64 ELF ellenorzes; a binarist sosem futtatjuk rootkent.
        with (BASE / (binary + '.new')).open('rb') as stream:
            elf = stream.read(20)
        if len(elf) != 20 or elf[:6] != b'\x7fELF\x02\x01' or elf[18:20] != b'\x3e\x00':
            raise RuntimeError('A letoltes nem Linux x86-64 ELF binaris')
        os.chmod(BASE / (binary + '.new'), 0o755)
        if target.exists():
            shutil.copy2(target, BASE / (binary + '.previous.new'))
            os.replace(BASE / (binary + '.previous.new'), BASE / (binary + '.previous'))
            if version_file.exists():
                shutil.copy2(version_file, BASE / (binary + '.previous.version.json'))
        os.replace(BASE / (binary + '.new'), BASE / binary)
        atomic_json(version_file, {'repository': repo, 'version': tag, 'sha256': digest,
                                   'binary_sha256': sha(target),
                                   'installed_at': datetime.datetime.now(datetime.timezone.utc).isoformat()})
        print(f'{binary}: {tag} telepitve. A futo miner valtozatlan; ujrainditaskor lep eletbe.', flush=True)
        return True


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--xmrig-only', action='store_true')
    args = parser.parse_args()
    with update_lock():
        try:
            changed = download('xmrig/xmrig', lambda n: n.endswith('linux-static-x64.tar.gz'), 'xmrig')
            atomic_json(BASE / 'xmrig-update.json', {'checked_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'ok': True, 'updated': changed})
        except Exception as exc:
            atomic_json(BASE / 'xmrig-update.json', {'checked_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'ok': False, 'error': str(exc)})
            raise
        if not args.xmrig_only:
            download('Lolliedieb/lolMiner-releases', lambda n: n.endswith('_Lin64.tar.gz'), 'lolMiner')
            download('doktor83/SRBMiner-Multi', lambda n: n.startswith('SRBMiner-Multi-') and n.endswith('-Linux.tar.gz'), 'SRBMiner-MULTI')
