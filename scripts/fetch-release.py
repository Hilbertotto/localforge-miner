#!/usr/bin/python3
"""Download the latest stable public LocalForge release; never use a branch archive."""
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import tarfile
import urllib.request

REPOSITORY = 'Hilbertotto/localforge-miner'
API = f'https://api.github.com/repos/{REPOSITORY}/releases/latest'

def download(url, limit=25*1024*1024):
    if not url.startswith('https://'):
        raise ValueError('HTTPS required')
    request = urllib.request.Request(url, headers={'User-Agent':'LocalForge-Updater','Accept':'application/vnd.github+json' if 'api.github.com/' in url else 'application/octet-stream'})
    with urllib.request.urlopen(request, timeout=60) as response:
        data = response.read(limit+1)
    if len(data)>limit:
        raise ValueError('Release response too large')
    return data

def latest():
    release = json.loads(download(API, 1024*1024))
    tag = release.get('tag_name','')
    if release.get('draft') or release.get('prerelease') or not re.fullmatch(r'v\d+\.\d+\.\d+',tag):
        raise ValueError('Not a stable semantic-versioned release')
    name = f'localforge-{tag}.tar.gz'
    assets = {asset['name']:asset for asset in release.get('assets',[])}
    if name not in assets or 'SHA256SUMS' not in assets:
        raise ValueError('Stable release has no source bundle or checksum manifest')
    prefix = f'https://github.com/{REPOSITORY}/releases/download/{tag}/'
    if any(not assets[n]['browser_download_url'].startswith(prefix) for n in [name,'SHA256SUMS']):
        raise ValueError('Unexpected release asset URL')
    return {'version':tag,'name':name,'url':release['html_url'],'archive':assets[name]['browser_download_url'],'checksums':assets['SHA256SUMS']['browser_download_url']}

def unpack(data, destination, version):
    destination = Path(destination)
    destination.mkdir(parents=True,exist_ok=False)
    with tarfile.open(fileobj=io.BytesIO(data),mode='r:gz') as archive:
        members=archive.getmembers()
        if len(members)>2000 or sum(m.size for m in members)>80*1024*1024:
            raise ValueError('Release archive too large')
        seen=set()
        for member in members:
            path=PurePosixPath(member.name)
            if path.is_absolute() or '..' in path.parts or '\\' in member.name or not path.parts or member.name in seen or set(path.parts)&{'.git','.local','data','node_modules'} or not (member.isfile() or member.isdir()):
                raise ValueError('Unsafe archive member')
            seen.add(member.name)
        archive.extractall(destination,filter='data')
    package=json.loads((destination/'package.json').read_text())
    metadata=json.loads((destination/'release.json').read_text())
    if 'v'+package['version']!=version or metadata.get('version')!=version or metadata.get('repository')!=REPOSITORY:
        raise ValueError('Release version or repository mismatch')
    for name in ['server.mjs','install-web.sh','scripts/update-app.sh']:
        if not (destination/name).is_file():
            raise ValueError('Incomplete LocalForge release')
    return destination

def fetch(destination):
    info=latest()
    manifest=download(info['checksums'],1024*1024).decode('ascii')
    checksums={parts[1].lstrip('*'):parts[0] for line in manifest.splitlines() if len(parts:=line.split())==2}
    digest=checksums.get(info['name'],'')
    if not re.fullmatch('[0-9a-f]{64}',digest):
        raise ValueError('Missing SHA256 for release bundle')
    data=download(info['archive'])
    if hashlib.sha256(data).hexdigest()!=digest:
        raise ValueError('LocalForge release SHA256 mismatch')
    unpack(data,destination,info['version'])
    return info

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path);args=parser.parse_args()
    print(json.dumps(fetch(args.output) if args.output else latest()))
