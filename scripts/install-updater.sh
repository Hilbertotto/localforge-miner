#!/usr/bin/env bash
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo 'Root jogosultsag kell.'; exit 1; }
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
install -d -o root -g root -m 755 /opt/localforge/scripts
install -o root -g root -m 644 download-miners.py /opt/localforge/scripts/download-miners.py
cat > /etc/systemd/system/localforge-xmrig-update.service <<'SERVICE'
[Unit]
Description=LocalForge official XMRig stable release updater
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/bin/python3 -I /opt/localforge/scripts/download-miners.py --xmrig-only
TimeoutStartSec=5min
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/opt/localforge/miners
SERVICE
cat > /etc/systemd/system/localforge-xmrig-update.timer <<'TIMER'
[Unit]
Description=Check XMRig updates every six hours

[Timer]
OnBootSec=10min
OnUnitActiveSec=6h
RandomizedDelaySec=5min
Unit=localforge-xmrig-update.service

[Install]
WantedBy=timers.target
TIMER
systemctl daemon-reload
systemctl enable --now localforge-xmrig-update.timer
echo 'XMRig automatikus frissites: 6 orankent, boot utan 10 perccel (+0-5 perc).'
