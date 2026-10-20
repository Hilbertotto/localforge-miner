#!/usr/bin/python3
"""Complete a verified release installation; credentials never enter the source tree."""
import argparse
import base64
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
CREDENTIALS = Path('/etc/localforge/install-credentials.json')


def run(args, input_text=None):
    result = subprocess.run(args, input=input_text, capture_output=True, text=True, timeout=120,
                            env={**os.environ, 'LC_ALL': 'C'})
    if result.returncode:
        # Do not include stdout: key creation writes a token there.
        raise RuntimeError(f'A telepítési lépés sikertelen: {Path(args[0]).name} (exit {result.returncode})')
    return result.stdout


def validate_release(folder):
    release = json.loads((folder / 'release.json').read_text(encoding='utf-8'))
    package = json.loads((folder / 'package.json').read_text(encoding='utf-8'))
    if release.get('version') != 'v'+package['version'] or not re.fullmatch(r'v\d+\.\d+\.\d+', release['version']):
        raise ValueError('A csomag verzióadatai nem egyeznek.')
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', release.get('repository', '')):
        raise ValueError('Hibás kiadási tároló.')
    return release


def validate_address(value):
    address = ipaddress.IPv4Address(value)
    if not address.is_private or address.is_loopback or address.is_unspecified or address.is_multicast:
        raise ValueError('Privát LAN IPv4-cím szükséges.')
    interfaces = json.loads(run(['ip', '-j', '-4', 'address']))
    if not any(a.get('local') == str(address) for device in interfaces for a in device.get('addr_info', [])):
        raise ValueError('A megadott LAN IP-cím nincs ezen az Ubuntu gépen.')
    return str(address)


def new_credentials(previous, existing_auth, issue_key):
    # Re-running never rotates a password or resurrects a revoked API key.
    if previous is not None:
        return dict(previous), False
    credentials = {'schema': 1, 'webUsername': 'miner', 'webPassword': None, 'apiToken': None, 'apiKeyId': None}
    if existing_auth:
        user, hashed = existing_auth.split(':', 1)
        if not re.fullmatch(r'[a-z_][a-z0-9_-]{0,31}', user) or not re.fullmatch(r'\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}', hashed):
            raise ValueError('Meglévő Apache-jelszófájl: csak egy bcrypt felhasználót tudunk változtatás nélkül átvenni.')
        credentials['webUsername'] = user
    else:
        credentials['webPassword'] = secrets.token_hex(16)
    issued = issue_key()
    credentials['apiToken'] = issued['token']
    credentials['apiKeyId'] = issued['key']['id']
    return credentials, True


def write_private(file, data):
    file.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(file.parent, 0o700)
    temporary = file.with_suffix('.tmp')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as stream:
        json.dump(data, stream, indent=2, ensure_ascii=False)
    os.chmod(temporary, 0o600)
    os.replace(temporary, file)


def finish(address, tunnel_only):
    release = validate_release(ROOT)
    for binary in ['xmrig', 'lolMiner', 'SRBMiner-MULTI']:
        file = Path('/opt/localforge/miners') / binary
        if not file.is_file() or not os.access(file, os.X_OK):
            raise RuntimeError(f'Hiányzó miner: {binary}. A letöltés után futtasd újra a telepítőt.')
    previous = json.loads(CREDENTIALS.read_text()) if CREDENTIALS.exists() else None
    auth_file = Path('/etc/apache2/localforge.htpasswd')
    auth = auth_file.read_text().strip() if auth_file.exists() else None
    credentials, created = new_credentials(previous, auth, lambda: json.loads(run([
        'runuser', '-u', 'localforge', '--', '/usr/bin/node', '/opt/localforge/scripts/api-key.mjs',
        'create', 'initial-central-controller', 'read,control,power'])))
    credentials.update({'repository': release['repository'], 'version': release['version'], 'address': address})
    write_private(CREDENTIALS, credentials)
    if not tunnel_only:
        if credentials['webPassword']:
            hashed = run(['htpasswd', '-Bni', credentials['webUsername']], credentials['webPassword']+'\n').strip().split(':', 1)[1]
        elif auth:
            hashed = auth.split(':', 1)[1]
        else:
            raise RuntimeError('A korábbi webes jelszó nem állítható vissza automatikusan.')
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir='/run', prefix='localforge-lan-', delete=False) as stream:
            config = Path(stream.name)
            json.dump({'address': address, 'username': credentials['webUsername'], 'hash': hashed}, stream)
        try:
            run(['python3', str(ROOT/'scripts/install-lan-apache.py'), str(config)])
        finally:
            config.unlink(missing_ok=True)
    status = None
    for _ in range(20):
        try:
            with urllib.request.urlopen('http://127.0.0.1:8080/api/status', timeout=8) as response:
                status = json.load(response)
            break
        except (OSError, ValueError):
            time.sleep(1)
    if status is None:
        raise RuntimeError('A kezelőszolgáltatás nem válaszol. Ellenőrzés: sudo journalctl -u localforge -n 50')
    if not tunnel_only:
        url = f'http://{address}:8080/'
        try:
            urllib.request.urlopen(url, timeout=8)
            raise RuntimeError('Az Apache bejelentkezésvédelme nem aktív.')
        except urllib.error.HTTPError as error:
            if error.code != 401:
                raise
        if credentials['webPassword']:
            basic = base64.b64encode((credentials['webUsername']+':'+credentials['webPassword']).encode()).decode()
            with urllib.request.urlopen(urllib.request.Request(url, headers={'Authorization': 'Basic '+basic}), timeout=8) as response:
                if response.status != 200:
                    raise RuntimeError('A webes bejelentkezés nem működik.')
        print(f'WEB: {url}\nFELHASZNÁLÓ: {credentials["webUsername"]}')
        if credentials['webPassword']:
            print(f'WEBES JELSZÓ: {credentials["webPassword"]}')
        else:
            print('WEBES JELSZÓ: a korábbi Apache-jelszó megmaradt.')
    else:
        print(f'SSH-alagút szükséges: ssh -L 8080:127.0.0.1:8080 FELHASZNÁLÓ@{address}')
    token = credentials.get('apiToken')
    if token:
        keys = json.loads(Path('/var/lib/localforge/api-keys.json').read_text()).get('keys', [])
        valid = any(k.get('id') == credentials['apiKeyId'] and k.get('hash') == hashlib.sha256(token.encode()).hexdigest() for k in keys)
        if not valid:
            print('A korábban készített API-kulcs vissza lett vonva; nem aktiváljuk újra.')
    print(f'Kiadás: {release["version"]}. API-kulcs és belépési adatok: sudo cat {CREDENTIALS}')
    print('A GitHub-token nem került a bányászgépre. A telepítő nem hoz létre walletet vagy bányászprofilt.')
    return created


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--address')
    parser.add_argument('--check-address')
    parser.add_argument('--check-release', action='store_true')
    parser.add_argument('--tunnel-only', action='store_true')
    options = parser.parse_args()
    try:
        if options.check_address:
            validate_address(options.check_address)
        if options.check_release:
            validate_release(ROOT)
        if not options.check_address and not options.check_release:
            if os.geteuid() != 0:
                raise ValueError('Root jogosultság szükséges.')
            finish(validate_address(options.address), options.tunnel_only)
    except Exception as error:
        print(f'Bootstrap hiba: {error}', file=__import__('sys').stderr)
        raise SystemExit(1)
