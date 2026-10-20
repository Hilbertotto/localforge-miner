"""Passwords arrive on stdin only. Do not enable protocol/debug logging."""
import ipaddress
import json
from pathlib import Path
import re
import select
import shlex
import socketserver
import sys
import tarfile
import tempfile
import time
import uuid
import webbrowser


def connect(config):
    import paramiko
    ipaddress.IPv4Address(config['host'])
    if not re.fullmatch(r'[a-z_][a-z0-9_-]{0,31}', config['username']):
        raise ValueError('Hibas felhasznalonev')
    client = paramiko.SSHClient()
    known = Path.home() / '.ssh/known_hosts'
    if known.exists():
        client.load_host_keys(str(known))
    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    # A hostkulcsot az autentikacio elott ellenorzi; nincs AutoAddPolicy.
    client.connect(config['host'], username=config['username'], password=config['password'],
                   look_for_keys=False, allow_agent=False, timeout=15, auth_timeout=20, banner_timeout=20)
    client.get_transport().set_keepalive(30)
    return client


def run_remote(client, command, sudo_password=None, output=True, secrets=(), input_data=None):
    stdin, stdout, stderr = client.exec_command(command, timeout=30)
    if sudo_password is not None:
        stdin.write(sudo_password + '\n')
        stdin.flush()
    if input_data is not None:
        stdin.write(input_data)
        stdin.flush()
    stdin.channel.shutdown_write()
    channel = stdout.channel
    captured = []
    tail = ''
    deadline = time.monotonic() + 1800
    # Keszletbol streamel, es a ket outputfolyamot is uriti, ne teljen be az SSH ablak.
    while True:
        for ready, receive in ((channel.recv_ready, channel.recv), (channel.recv_stderr_ready, channel.recv_stderr)):
            if ready():
                tail += receive(32768).decode('utf-8', errors='replace')
                lines = tail.split('\n')
                tail = lines.pop()
                for line in lines:
                    for secret in secrets:
                        if secret:
                            line = line.replace(secret, '[rejtve]')
                    captured.append(line)
                    if output:
                        print(line, flush=True)
        if channel.exit_status_ready() and not channel.recv_ready() and not channel.recv_stderr_ready():
            break
        if time.monotonic() > deadline:
            channel.close()
            raise RuntimeError('A tavoli muvelet idokorlatja lejart')
        time.sleep(0.03)
    if tail:
        for secret in secrets:
            if secret:
                tail = tail.replace(secret, '[rejtve]')
        captured.append(tail)
        if output:
            print(tail, flush=True)
    code = channel.recv_exit_status()
    if code != 0:
        raise RuntimeError(f'A tavoli parancs hibakoddal leallt: {code}')
    return '\n'.join(captured)


def install(client, config, base=False, update_only=False, ui_only=False):
    # A helyi forras helyet a Python unicode-os scriptutvonalabol szarmaztatjuk,
    # nem egy PowerShell csovon kapott, potencialisan serult karaktersorbol.
    root = Path(__file__).resolve().parents[1]
    names = ['public'] if ui_only else ['setup-ubuntu.sh'] if base else ['server.mjs', 'package.json', 'src', 'public', 'scripts', 'install-web.sh']
    with tempfile.TemporaryDirectory() as folder:
        archive = Path(folder) / 'app.tar.gz'
        with tarfile.open(archive, 'w:gz') as tar:
            for name in names:
                tar.add(root / name, arcname=name, filter=lambda m: None if '__pycache__' in m.name or m.name.endswith('.pyc') else m)
        with client.open_sftp() as sftp:
            home = sftp.normalize('.')
            remote_dir = home.rstrip('/') + '/localforge-install-' + uuid.uuid4().hex
            sftp.mkdir(remote_dir, mode=0o700)
            remote_archive = remote_dir + '/app.tar.gz'
            sftp.put(str(archive), remote_archive)
        script = 'setup-ubuntu.sh' if base else 'scripts/update-app.sh' if update_only else 'install-web.sh'
        cmd = f"set -e; tar -xzf {shlex.quote(remote_archive)} -C {shlex.quote(remote_dir)}; cd {shlex.quote(remote_dir)}; sed -i 's/\\r$//' {script}; sudo -S -p '' bash {script}"
        if ui_only:
            cmd = f"set -e; tar -xzf {shlex.quote(remote_archive)} -C {shlex.quote(remote_dir)}; cd {shlex.quote(remote_dir)}; sudo -S -p '' install -o root -g root -m 644 public/app.js public/style.css public/index.html /opt/localforge/public/"
        run_remote(client, cmd, config['sudoPassword'], secrets=(config['password'], config['sudoPassword']))


def tunnel(client):
    transport = client.get_transport()

    class Handler(socketserver.BaseRequestHandler):
        def handle(self):
            try:
                channel = transport.open_channel('direct-tcpip', ('127.0.0.1', 8080), self.request.getpeername(), timeout=15)
                if channel is None:
                    return
                with channel:
                    while True:
                        ready, _, _ = select.select([self.request, channel], [], [], 30)
                        for src in ready:
                            data = src.recv(65536)
                            if not data:
                                return
                            (channel if src is self.request else self.request).sendall(data)
            except (OSError, EOFError):
                return

    class Server(socketserver.ThreadingTCPServer):
        daemon_threads = True
        allow_reuse_address = True

    with Server(('127.0.0.1', 8080), Handler) as server:
        server.timeout = 1
        print('Webfelulet: http://127.0.0.1:8080 — ezt az ablakot hagyd nyitva. Ctrl+C: bezaras.', flush=True)
        webbrowser.open('http://127.0.0.1:8080')
        while transport.is_active():
            server.handle_request()
        raise RuntimeError('Az SSH kapcsolat megszakadt')


def diagnose(client, config):
    code = """
import json, pathlib, subprocess, urllib.request
for args in [['systemctl','is-enabled','localforge.service'],['systemctl','is-active','localforge.service'],['systemctl','show','localforge.service','-p','ActiveState','-p','SubState','-p','Result','-p','ExecMainStatus'],['journalctl','-b','-u','localforge.service','-n','65','--no-pager','-o','cat']]:
 print('COMMAND', ' '.join(args), flush=True)
 r=subprocess.run(args,capture_output=True,text=True,timeout=15);print(r.stdout);print(r.stderr)
for name in ['running-profiles.json','watchdog.json']:
 p=pathlib.Path('/var/lib/localforge')/name
 print(name, p.read_text() if p.exists() else 'MISSING')
p=pathlib.Path('/var/lib/localforge/profiles.json')
print('PROFILES',json.dumps([{k:x.get(k) for k in ['id','name','engine','algorithm']} for x in json.loads(p.read_text())]) if p.exists() else 'MISSING')
try:
 d=json.load(urllib.request.urlopen('http://127.0.0.1:8080/api/status',timeout=15))
 print('LIVE',json.dumps({k:d.get(k) for k in ['autostart','watchdog','powerRequest']}))
 print('JOBS',json.dumps([{k:j.get(k) for k in ['id','state','error','exitCode']} for j in d.get('jobs',[])]))
 print('HASHRATES',json.dumps({key:{k:v.get(k) for k in ['available','total','algorithm','accepted','submitted','error','source']} for key,v in d.get('hashrates',{}).items()}))
except Exception as e: print('API',str(e))
"""
    run_remote(client, "sudo -S -p '' python3 -c " + shlex.quote(code), config['sudoPassword'], secrets=(config['password'],config['sudoPassword']))


def diagnose_lan(client, config):
    command = "ip -4 -brief address; ss -ltn; systemctl is-active localforge.service; systemctl is-active apache2.service || true; command -v apache2ctl || true"
    run_remote(client, command, secrets=(config['password'],config['sudoPassword']))


def verify_lan(config, check_history=False):
    import base64
    import urllib.request
    import urllib.error
    base = f"http://{config['host']}:8080"
    try:
        urllib.request.urlopen(base+'/', timeout=10)
        raise RuntimeError('A webes bejelentkezes nincs ervenyesitve')
    except urllib.error.HTTPError as error:
        if error.code != 401:
            raise
    for route in ['/api/session', '/api/status', '/app.js']:
        try:
            urllib.request.urlopen(base+route, timeout=10)
            raise RuntimeError('Nem vedett helyi vegpont: '+route)
        except urllib.error.HTTPError as error:
            if error.code != 401:
                raise
    authorization = 'Basic '+base64.b64encode((config['webUsername']+':'+config['webPassword']).encode()).decode()
    req = urllib.request.Request(base+'/api/status', headers={'Authorization': authorization})
    with urllib.request.urlopen(req, timeout=20) as response:
        data = json.load(response)
    print('LAN eleres es bejelentkezes OK: '+data['hostname'])
    print('Miner allapotok: '+', '.join(job['state'] for job in data.get('jobs', [])))
    if check_history:
        for period in ['1h','1d']:
            request = urllib.request.Request(base+'/api/history?range='+period, headers={'Authorization': authorization})
            with urllib.request.urlopen(request, timeout=20) as response:
                history = json.load(response)
            if history.get('error'):
                raise RuntimeError(history['error'])
            expected = 3600000 if period == '1h' else 86400000
            if history['end']-history['start'] != expected:
                raise RuntimeError('Hibas idotav')
            print(f"HISTORY {period}: {len(history['records'])} minta, {history['stepMs']} ms felbontas, mentés OK")



def install_lan(client, config):
    run_remote(client, "sudo -S -p '' env DEBIAN_FRONTEND=noninteractive apt-get install -y apache2 apache2-utils", config['sudoPassword'], secrets=(config['password'],config['sudoPassword']))
    username = config['webUsername']
    if not re.fullmatch(r'[a-z_][a-z0-9_-]{0,31}', username) or not re.fullmatch(r'[a-f0-9]{32}', config['webPassword']):
        raise ValueError('Hibas webes belepesi adatok')
    hashed = run_remote(client, 'htpasswd -Bni '+shlex.quote(username), output=False, input_data=config['webPassword']+'\n', secrets=(config['webPassword'],)).strip()
    if not hashed.startswith(username+':$2'):
        raise ValueError('A webes jelszo lenyomata nem keszult el')
    root = Path(__file__).resolve().parents[1]
    with client.open_sftp() as sftp:
        folder = sftp.normalize('.').rstrip('/')+'/localforge-lan-'+uuid.uuid4().hex
        sftp.mkdir(folder, mode=0o700)
        installer = folder+'/install-lan-apache.py'
        payload = folder+'/config.json'
        sftp.put(str(root/'scripts/install-lan-apache.py'), installer)
        with sftp.open(payload, 'w') as file:
            file.write(json.dumps({'address':config['host'],'username':username,'hash':hashed.split(':',1)[1]}))
        sftp.chmod(payload, 0o600)
        try:
            run_remote(client, "sudo -S -p '' python3 "+shlex.quote(installer)+' '+shlex.quote(payload), config['sudoPassword'], secrets=(config['password'],config['sudoPassword'],config['webPassword']))
        finally:
            sftp.remove(payload)
    verify_lan(config)


def main():
    mode = sys.argv[1]
    if mode not in ('install', 'open', 'base', 'diagnose', 'diagnose-lan', 'install-lan', 'verify-lan', 'update-app', 'verify-history', 'update-ui'):
        raise ValueError('Ismeretlen uzemmod')
    config = json.loads(sys.stdin.buffer.readline().decode('utf-8-sig'))
    if any(not isinstance(config.get(k), str) or any(c in config[k] for c in '\r\n\x00') for k in ('password', 'sudoPassword')):
        raise ValueError('Hibas jelszoformatum')
    client = connect(config)
    try:
        if mode == 'install-lan':
            install_lan(client, config)
        elif mode == 'verify-history':
            verify_lan(config, check_history=True)
        elif mode == 'verify-lan':
            verify_lan(config)
        elif mode == 'diagnose-lan':
            diagnose_lan(client, config)
        elif mode == 'diagnose':
            diagnose(client, config)
        elif mode == 'open':
            # A sudo jelszo az alaguthoz nem szukseges es nem jut el a szerverhez.
            config['sudoPassword'] = None
            tunnel(client)
        else:
            install(client, config, base=mode == 'base', update_only=mode == 'update-app', ui_only=mode == 'update-ui')
    finally:
        client.close()
        config.clear()


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        pass
    except Exception as exc:
        # A paramiko hitelesitesi hiba nem tartalmaz jelszot. Nincs traceback/payload-log.
        print(f'HIBA: {type(exc).__name__}: {exc}', file=sys.stderr)
        if type(exc).__name__ == 'BadHostKeyException':
            print('Az SSH gepazonosito megvaltozott. Ellenorizd a celgep hostkulcsat; ne torold vakon a regi kulcsot.', file=sys.stderr)
        elif type(exc).__name__ == 'SSHException' and 'known_hosts' in str(exc):
            print('Ismeretlen hostkulcs: eloszor csatlakozz a Windows ssh paranccsal es ellenorizd a gepazonositot.', file=sys.stderr)
        sys.exit(1)
