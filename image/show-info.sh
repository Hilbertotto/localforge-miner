#!/bin/bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run: sudo localforge-info'; exit 1; }
printf 'Web addresses:\n'
for address in $(hostname -I); do
 [[ "$address" == *:* ]] || printf 'http://%s/\n' "$address"
done
cat /etc/localforge/web-credentials
printf '\nEnter the central server URL, worker name and worker key in the web setup.\n'
