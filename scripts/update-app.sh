#!/usr/bin/env bash
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo 'Root jogosultsag szukseges.'; exit 1; }
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
[[ -f /opt/localforge/server.mjs && -d /var/lib/localforge ]] || { echo 'Elobb a teljes install-web telepites szukseges.'; exit 1; }
node --check server.mjs
node --check public/app.js
if systemctl is-active --quiet localforge.service; then python3 scripts/capture-running.py; fi
systemctl stop localforge.service
# Even if copying fails, try bringing the existing service back up.
trap 'systemctl start localforge.service' EXIT
install -d -m 755 /opt/localforge/scripts
install -o root -g root -m 644 src/*.mjs /opt/localforge/src/
install -d -m 755 /opt/localforge/worker
install -o root -g root -m 644 worker/connector.mjs /opt/localforge/worker/
install -o root -g root -m 644 public/* /opt/localforge/public/
install -o root -g root -m 644 scripts/api-key.mjs /opt/localforge/scripts/
install -o root -g root -m 644 scripts/read-oc.py scripts/nvidia-offsets.py /opt/localforge/scripts/
install -o root -g root -m 644 server.mjs package.json /opt/localforge/
sed -i 's/\r$//' scripts/localforge-oc.py
install -o root -g root -m 755 scripts/localforge-oc.py /usr/local/sbin/localforge-oc
bash scripts/install-app-updater.sh
systemctl start localforge.service
trap - EXIT
systemctl is-active localforge.service
echo 'Alkalmazas frissitve. A korabban futo profilok visszaindulnak.'
