#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Futtatás: sudo bash central/install.sh'; exit 1; }
node -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(1)' || { echo 'Node.js 22 vagy újabb szükséges.'; exit 1; }
src=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
id localforge-central &>/dev/null || useradd --system --home /var/lib/localforge-central --shell /usr/sbin/nologin localforge-central
install -d -m 755 /opt/localforge-central/central /opt/localforge-central/src
cp -r "$src/central/public" /opt/localforge-central/central/
install -m 644 "$src/central/server.mjs" /opt/localforge-central/central/server.mjs
install -m 644 "$src/central/accounts.mjs" "$src/central/send-mail.py" /opt/localforge-central/central/
install -m 644 "$src/central/worker-channel.mjs" /opt/localforge-central/central/
install -m 644 "$src/central/farm-library.mjs" /opt/localforge-central/central/
install -m 644 "$src/central/backup-store.mjs" /opt/localforge-central/central/
install -m 644 "$src/src/agent-api.mjs" /opt/localforge-central/src/agent-api.mjs
install -m 644 "$src/src/miners.mjs" "$src/src/wallets.mjs" "$src/src/hashrate.mjs" "$src/src/gpu-hashrate.mjs" /opt/localforge-central/src/
install -m 644 "$src/src/worker-backup.mjs" "$src/src/watchdog.mjs" /opt/localforge-central/src/
install -m 644 "$src/src/vbios-oc.mjs" /opt/localforge-central/src/
install -d -m 700 -o localforge-central -g localforge-central /var/lib/localforge-central
cat >/etc/systemd/system/localforge-central.service <<'EOF'
[Unit]
Description=LocalForge Central
After=network-online.target
Wants=network-online.target
[Service]
User=localforge-central
Group=localforge-central
WorkingDirectory=/opt/localforge-central
ExecStart=/usr/bin/node /opt/localforge-central/central/server.mjs
Environment=LOCALFORGE_CENTRAL_DATA=/var/lib/localforge-central
Environment=LOCALFORGE_CENTRAL_HOST=127.0.0.1
Environment=LOCALFORGE_CENTRAL_PORT=8090
EnvironmentFile=-/etc/localforge-central.env
Restart=on-failure
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/localforge-central
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now localforge-central
echo 'Elérés SSH-alagúttal: ssh -L 8090:127.0.0.1:8090 FELHASZNALO@SZERVER'
echo 'Ezután: http://127.0.0.1:8090'
echo 'Első adminjelszó: sudo journalctl -u localforge-central --no-pager'
