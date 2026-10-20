#!/usr/bin/python3
"""Install a LAN-only Apache frontend without restarting the mining service."""
import ipaddress
import json
import os
from pathlib import Path
import re
import subprocess
import sys


def run(args):
    return subprocess.run(args, check=True, text=True, capture_output=True, timeout=60, env={**os.environ, "LC_ALL":"C"})


def configuration(address, network):
    ip = ipaddress.IPv4Address(address)
    subnet = ipaddress.IPv4Network(network, strict=False)
    if not ip.is_private or ip.is_loopback or ip not in subnet:
        raise ValueError('Privát helyi hálózati IP-cím szükséges.')
    return f'''<VirtualHost {ip}:8080>
    ServerName {ip}
    ProxyRequests Off
    ProxyPreserveHost Off
    ProxyPass / http://127.0.0.1:8080/ connectiontimeout=5 timeout=30
    ProxyPassReverse / http://127.0.0.1:8080/
    <Location "/">
        Require ip {subnet} 127.0.0.1 ::1
    </Location>
    <LocationMatch "^/(?!api/v1/)">
        AuthType Basic
        AuthName "LocalForge miner"
        AuthBasicProvider file
        AuthUserFile /etc/apache2/localforge.htpasswd
        <RequireAll>
            Require ip {subnet} 127.0.0.1 ::1
            Require valid-user
        </RequireAll>
    </LocationMatch>
    ErrorLog ${{APACHE_LOG_DIR}}/localforge-error.log
    CustomLog ${{APACHE_LOG_DIR}}/localforge-access.log combined
</VirtualHost>
'''


def main(config_path):
    import grp
    if os.geteuid() != 0:
        raise ValueError('Root jogosultság szükséges.')
    config = json.loads(Path(config_path).read_text())
    address = str(ipaddress.IPv4Address(config['address']))
    user, hashed = config['username'], config['hash']
    if not re.fullmatch(r'[a-z_][a-z0-9_-]{0,31}', user) or not re.fullmatch(r'\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}', hashed):
        raise ValueError('Hibás webes felhasználónév vagy bcrypt lenyomat.')
    networks = [item for interface in json.loads(run(['ip', '-j', '-4', 'address']).stdout)
                for item in interface.get('addr_info', []) if item.get('local') == address]
    if len(networks) != 1:
        raise ValueError('Az IP-cím nem egyértelműen ehhez a géphez tartozik.')
    network = str(ipaddress.IPv4Network(f"{address}/{networks[0]['prefixlen']}", strict=False))
    site = configuration(address, network)
    password_file = Path('/etc/apache2/localforge.htpasswd')
    password_file.write_text(f'{user}:{hashed}\n')
    os.chmod(password_file, 0o640)
    os.chown(password_file, 0, grp.getgrnam('www-data').gr_gid)
    conf = Path('/etc/apache2/conf-available/localforge-listen.conf')
    target = Path('/etc/apache2/sites-available/localforge.conf')
    previous = {p: p.read_text() if p.exists() else None for p in (conf, target)}
    enabled = {p: p.exists() for p in (Path('/etc/apache2/conf-enabled/localforge-listen.conf'), Path('/etc/apache2/sites-enabled/localforge.conf'))}
    conf.write_text(f'Listen {address}:8080\n')
    target.write_text(site)
    try:
        run(['a2enmod', 'proxy', 'proxy_http', 'auth_basic', 'authn_file', 'authz_host', 'authz_user'])
        run(['a2enconf', 'localforge-listen'])
        run(['a2ensite', 'localforge'])
        run(['apache2ctl', 'configtest'])
    except Exception:
        for p, content in previous.items():
            if content is None:
                p.unlink(missing_ok=True)
            else:
                p.write_text(content)
        for p, existed in enabled.items():
            if not existed:
                p.unlink(missing_ok=True)
        raise
    dropin = Path('/etc/systemd/system/apache2.service.d')
    dropin.mkdir(exist_ok=True)
    (dropin / 'localforge.conf').write_text('[Unit]\nWants=network-online.target\nAfter=network-online.target\n[Service]\nRestart=on-failure\nRestartSec=5\n')
    run(['systemctl', 'daemon-reload'])
    run(['systemctl', 'enable', 'apache2.service'])
    try:
        active = run(['ufw', 'status']).stdout
    except FileNotFoundError:
        active = ''
    if 'Status: active' in active:
        run(['ufw', 'allow', 'from', network, 'to', address, 'port', '8080', 'proto', 'tcp', 'comment', 'LocalForge-LAN'])
    run(['systemctl', 'restart', 'apache2.service'])
    print(f'KESZ: http://{address}:8080/ · felhasználó: {user} · csak {network}')


if __name__ == '__main__':
    try:
        if len(sys.argv) != 2:
            raise ValueError('Egy konfigurációfájl szükséges.')
        main(sys.argv[1])
    except Exception as error:
        print(f'Apache telepítési hiba: {error}', file=sys.stderr)
        sys.exit(1)
