#!/usr/bin/env python3
"""Allowlist-only, reproducible source bundle. No runtime state is ever copied."""
import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import tarfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = 'Hilbertotto/localforge-miner'
SECRET_PATTERNS = [re.compile(rb'-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----'),
                   re.compile(rb'gh[pousr]_[A-Za-z0-9]{24,}'),
                   re.compile(rb'github_pat_[A-Za-z0-9_]{30,}'),
                   re.compile(rb'01000000d08c9ddf'+rb'0115d1118c7a00c04fc297eb', re.I)]


def files(folder):
    manifest = json.loads((folder/'release-manifest.json').read_text(encoding='utf-8'))
    names = set(manifest['files'])
    for directory, suffixes in manifest['trees'].items():
        for file in (folder/directory).rglob('*'):
            relative = file.relative_to(folder)
            if '__pycache__' not in relative.parts and file.is_file() and file.suffix in suffixes:
                names.add(relative.as_posix())
    for name in sorted(names):
        relative = Path(name)
        file = folder/relative
        if relative.is_absolute() or '..' in relative.parts or any(p in ['.local','data','node_modules','.git','__pycache__','dist'] for p in relative.parts):
            raise ValueError(f'Nem publikálható útvonal: {name}')
        if not file.is_file() or file.is_symlink() or not file.resolve().is_relative_to(folder.resolve()):
            raise ValueError(f'Hiányzó vagy nem biztonságos forrásfájl: {name}')
        data = file.read_bytes()
        if any(pattern.search(data) for pattern in SECRET_PATTERNS):
            raise ValueError(f'Titoknak tűnő adat: {name}. A tartalmat nem naplózzuk.')
        yield name, data


def normalized(name, data):
    text = data.decode('utf-8-sig').replace('\r\n','\n')
    if name.endswith('.ps1'):
        return ('\ufeff'+text.replace('\n','\r\n')).encode('utf-8')
    if name.endswith('.bat'):
        return text.replace('\n','\r\n').encode('utf-8')
    return text.encode('utf-8')


def build(folder, output, tag, repository=REPOSITORY):
    version = json.loads((folder/'package.json').read_text())['version']
    if tag != 'v'+version or not re.fullmatch(r'v\d+\.\d+\.\d+', tag):
        raise ValueError('A tag és a package.json verziója nem egyezik.')
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+',repository):
        raise ValueError('Hibás kiadási tároló.')
    payload = {name:normalized(name,data) for name,data in files(folder)}
    payload['release.json'] = (json.dumps({'repository':repository,'version':tag,'archiveFormat':1},indent=2)+'\n').encode()
    output.mkdir(parents=True,exist_ok=True)
    archive = output/f'localforge-{tag}.tar.gz'
    with archive.open('wb') as raw, gzip.GzipFile(filename='',mode='wb',fileobj=raw,mtime=0) as compressed, tarfile.open(fileobj=compressed,mode='w') as tar:
        for name,data in sorted(payload.items()):
            info=tarfile.TarInfo(name);info.size=len(data);info.mode=0o755 if name.endswith('.sh') else 0o644;info.mtime=0
            tar.addfile(info,io.BytesIO(data))
    assets = [archive]
    for name in ['setup-miner.bat','setup-miner.ps1']:
        file=output/name;file.write_bytes(payload[name]);assets.append(file)
    starter=output/f'LocalForge-Setup-{tag}.zip'
    with zipfile.ZipFile(starter,'w',compression=zipfile.ZIP_DEFLATED) as zip:
        for name in ['setup-miner.bat','setup-miner.ps1','TELEPITES-GITHUB.md']:
            info=zipfile.ZipInfo(name,date_time=(1980,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED
            zip.writestr(info,payload[name])
    assets.append(starter)
    sums=output/'SHA256SUMS';sums.write_text(''.join(f'{hashlib.sha256(file.read_bytes()).hexdigest()}  {file.name}\n' for file in assets),encoding='ascii')
    return [*assets,sums]


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--tag');parser.add_argument('--output',type=Path,default=ROOT/'dist');parser.add_argument('--repository',default=os.environ.get('GITHUB_REPOSITORY',REPOSITORY));parser.add_argument('--list',action='store_true');args=parser.parse_args()
    if args.list:
        for name,_ in files(ROOT):print(name)
    else:
        for asset in build(ROOT,args.output,args.tag or 'v'+json.loads((ROOT/'package.json').read_text())['version'],args.repository):print(asset.name)
