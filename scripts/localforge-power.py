#!/usr/bin/python3 -I
import subprocess
import sys

def command(action):
    if action == 'reboot-delay':
        return ['/usr/bin/systemd-run', '--unit=localforge-user-reboot', '--on-active=30s', '--timer-property=AccuracySec=1s', '/usr/bin/systemctl', 'reboot']
    if action in ('reboot', 'poweroff'):
        return ['/usr/bin/systemctl', action, '--no-block']
    raise ValueError('Ismeretlen gépművelet.')

if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('Egy rögzített művelet szükséges.')
    try:
        result = subprocess.run(command(sys.argv[1]), env={'PATH': '/usr/bin:/bin', 'LANG': 'C'}, timeout=10, capture_output=True, text=True)
        if result.returncode:
            sys.exit(result.stderr.strip() or 'A gépművelet nem sikerült.')
    except ValueError as error:
        sys.exit(str(error))
