"""Register a saved SSH target with Central; all credentials arrive on stdin."""
import json
import sys
import urllib.request
import urllib.error
from http.cookiejar import CookieJar
from importlib.util import spec_from_file_location, module_from_spec
from pathlib import Path


def main():
    config = json.load(sys.stdin)
    spec = spec_from_file_location('remote_connection', Path(__file__).with_name('remote-connection.py'))
    remote = module_from_spec(spec)
    spec.loader.exec_module(remote)
    base = 'http://127.0.0.1:8090'
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))

    def request(route, body=None, csrf=None):
        headers = {'Content-Type': 'application/json'}
        if csrf:
            headers['X-CSRF-Token'] = csrf
        req = urllib.request.Request(base + route, data=json.dumps(body).encode() if body is not None else None, headers=headers)
        try:
            with opener.open(req, timeout=20) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            raise RuntimeError('HTTP ' + str(error.code) + ' ' + route) from None

    csrf = request('/api/login', {'password': config['centralPassword']})['csrf']
    address = 'http://' + config['host'] + ':8080'
    existing = request('/api/rigs')['rigs']
    rig = next((r for r in existing if r['address'] == address), None)
    if rig:
        status = request('/api/rigs/' + rig['id'] + '/status')
        print('A gep mar csatlakoztatva: ' + rig['name'])
    else:
        client = remote.connect(config)
        issued = None
        try:
            raw = remote.run_remote(client, "sudo -S -p '' -u localforge /usr/bin/node /opt/localforge/scripts/api-key.mjs create localforge-central read,control,power", config['sudoPassword'], output=False)
            issued, _ = json.JSONDecoder().raw_decode(raw[raw.index('{'):])
            probe = urllib.request.Request(address + '/api/v1/node', headers={'Authorization': 'Bearer ' + issued['token']})
            try:
                with urllib.request.urlopen(probe, timeout=10) as response:
                    identity = json.load(response)
                print('Agent API elerheto; azonositomezo: ' + ', '.join(identity.keys()))
            except urllib.error.HTTPError as error:
                raise RuntimeError('HTTP ' + str(error.code) + ' agent /node') from None
            rig = request('/api/rigs', {'name': config.get('name', 'meloai'), 'address': address, 'token': issued['token']}, csrf)['rig']
            status = request('/api/rigs/' + rig['id'] + '/status')
            print('Gep csatlakoztatva: ' + rig['name'])
        except Exception:
            # Revoke only when registration did not complete; keep a registered key valid.
            if issued and not rig:
                key_id = issued['key']['id']
                import uuid
                uuid.UUID(key_id)
                remote.run_remote(client, "sudo -S -p '' -u localforge /usr/bin/node /opt/localforge/scripts/api-key.mjs revoke " + key_id, config['sudoPassword'], output=False)
            raise
        finally:
            client.close()
    print('Elo allapot: ' + str(status.get('hostname', '')))
    for job in status.get('jobs', []):
        print('Profil: ' + job['id'] + ' / ' + job['state'])
    request('/api/logout', {}, csrf)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Never print remote output or credentials.
        detail = str(error) if isinstance(error, RuntimeError) and str(error).startswith('HTTP ') else type(error).__name__
        print('A csatlakoztatas sikertelen: ' + detail, file=sys.stderr)
        sys.exit(1)
