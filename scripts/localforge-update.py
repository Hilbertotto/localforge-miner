#!/usr/bin/python3 -I
"""Fixed, root-owned entry point. No user-provided paths or commands."""
import os
import subprocess
import sys
if os.geteuid()!=0 or len(sys.argv)!=1:
    raise SystemExit('Root invocation without arguments required')
subprocess.run(['/usr/bin/systemctl','start','--no-block','localforge-app-update.service'],check=True)
print('LocalForge update queued')
