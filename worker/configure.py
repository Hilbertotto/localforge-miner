"""Interactive configuration: never expose pairing or local API keys in arguments."""
import getpass
import grp
import json
import os
from pathlib import Path
import re
import subprocess
from urllib.parse import urlsplit

if os.geteuid() != 0:
    raise SystemExit('Futtasd sudo-val.')
server = input('Központ címe (például https://szerver.example): ').strip().rstrip('/')
url = urlsplit(server)
if url.scheme not in ('https', 'http') or not url.hostname or url.username or url.password or url.path or url.query or url.fragment:
    raise SystemExit('Hibás szervercím.')
name = input('Munkás neve (pontosan a központban megadott név): ').strip()
code = getpass.getpass('Munkás egyedi kulcsa: ').strip()
if not name or len(name) > 80 or not re.fullmatch(r'lfw_[a-f0-9]{64}', code):
    raise SystemExit('Hibás név vagy kulcs.')
directory = Path('/etc/localforge-worker')
directory.mkdir(mode=0o750, exist_ok=True)
gid = grp.getgrnam('localforge').gr_gid
os.chown(directory, 0, gid)
os.chmod(directory, 0o750)
target = directory / 'config.json'
previous = json.loads(target.read_text()) if target.exists() else None
if previous:
    token = previous['agentToken']
else:
    issued = subprocess.run(['runuser', '-u', 'localforge', '--', '/usr/bin/node', '/opt/localforge/scripts/api-key.mjs', 'create', 'outbound-worker', 'read,control,power'], capture_output=True, text=True, check=True)
    token = json.loads(issued.stdout)['token']
temp = directory / 'config.tmp'
fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, 'w') as output:
    json.dump({'server': server, 'name': name, 'code': code, 'agentToken': token}, output)
os.chown(temp, 0, gid)
os.chmod(temp, 0o640)
os.replace(temp, target)
print('Beállítás mentve; a titkos kulcsok nem kerültek a naplóba.')
