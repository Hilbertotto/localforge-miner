#!/bin/bash
set -Eeuo pipefail
[[ $EUID -eq 0 ]]
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
install -d -o root -g root -m 755 /var/lib/localforge-updater
install -o root -g root -m 644 scripts/app-updater.py scripts/fetch-release.py /opt/localforge/scripts/
sed -i 's/\r$//' scripts/localforge-update.py
install -o root -g root -m 755 scripts/localforge-update.py /usr/local/sbin/localforge-update
cat > /etc/systemd/system/localforge-app-update.service <<'SERVICE'
[Unit]
Description=LocalForge manual stable application updater
Wants=network-online.target
After=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 -I /opt/localforge/scripts/app-updater.py
TimeoutStartSec=20min
UMask=0077
SERVICE
printf '%s\n' 'localforge ALL=(root) NOPASSWD: /usr/local/sbin/localforge-update ""' > /etc/sudoers.d/localforge-app-update
chmod 440 /etc/sudoers.d/localforge-app-update
visudo -cf /etc/sudoers.d/localforge-app-update
systemctl daemon-reload
