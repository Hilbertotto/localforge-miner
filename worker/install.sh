#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Futtasd: sudo bash worker/install.sh'; exit 1; }
[[ -f /opt/localforge/scripts/api-key.mjs ]] || { echo 'Először a LocalForge miner részt telepítsd.'; exit 1; }
src=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
python3 "$src/configure.py"
install -d -m 755 /opt/localforge-worker
install -m 644 "$src/connector.mjs" /opt/localforge-worker/connector.mjs
cat >/etc/systemd/system/localforge-worker.service <<'EOF'
[Unit]
Description=LocalForge outbound worker connection
After=network-online.target localforge.service
Wants=network-online.target
[Service]
User=localforge
Group=localforge
ExecStart=/usr/bin/node /opt/localforge-worker/connector.mjs
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable localforge-worker
systemctl restart localforge-worker
echo 'Munkáscsatlakozó telepítve. A futó minereket nem indítottuk újra.'
