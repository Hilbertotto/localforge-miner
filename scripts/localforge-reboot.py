#!/usr/bin/python3 -I
import subprocess
import sys

if len(sys.argv) != 1:
    sys.exit('Ez a helper nem fogad argumentumokat.')
result = subprocess.run(['/usr/bin/systemctl', 'reboot', '--no-block'],
                        env={'PATH': '/usr/bin:/bin', 'LANG': 'C'}, timeout=10)
sys.exit(result.returncode)
