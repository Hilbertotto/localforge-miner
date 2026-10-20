#!/usr/bin/python3
"""One-time migration from versions without persistent run intent; IDs only."""
import json
import os
from pathlib import Path
import pwd
import re
import tempfile
import urllib.request

target = Path('/var/lib/localforge/running-profiles.json')
if not target.exists():
    try:
        with urllib.request.urlopen('http://127.0.0.1:8080/api/status', timeout=12) as response:
            status = json.load(response)
        profiles = {p['id'] for p in status.get('profiles', []) if isinstance(p.get('id'), str)}
        ids = sorted({j['id'] for j in status.get('jobs', [])
                      if j.get('id') in profiles and j.get('state') == 'running'
                      and re.fullmatch(r'[-\w]{1,64}', j['id'])})
        account = pwd.getpwnam('localforge')
        with tempfile.NamedTemporaryFile(mode='w', dir=target.parent, prefix='.running-capture-', delete=False, encoding='utf-8') as stream:
            temp = Path(stream.name)
            json.dump({'schema': 1, 'ids': ids}, stream)
        try:
            os.chown(temp, account.pw_uid, account.pw_gid)
            # Exclusive publication: a concurrently written state file wins.
            try:
                os.link(temp, target)
                print(f'Korabban futo profilok visszainditashoz mentve: {len(ids)}')
            except FileExistsError:
                pass
        finally:
            temp.unlink()
    except Exception as error:
        print(f'FIGYELEM: a regi futasi allapot nem veheto at: {error}. Telepites utan inditsd el a kivant profilokat egyszer kezzel.')
