#!/usr/bin/env bash
set -Eeuo pipefail
trap 'echo "HIBA: telepites megszakadt a(z) $LINENO. sorban. A hibat masold be a chatbe." >&2' ERR
[[ $EUID -eq 0 ]] || { echo 'sudo bash install-web.sh'; exit 1; }
source /etc/os-release
[[ "$ID" == ubuntu && "$VERSION_ID" == 26.04 ]] || { echo 'Ez a webtelepito Ubuntu 26.04 LTS-hez keszult.'; exit 1; }
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
apt-get update
apt-get install -y nodejs python3 sudo pciutils ca-certificates ocl-icd-libopencl1 libnuma1 lm-sensors
node -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(1)'
id localforge >/dev/null 2>&1 || useradd --system --user-group --home-dir /var/lib/localforge --create-home --shell /usr/sbin/nologin localforge
install -d -o localforge -g localforge -m 700 /var/lib/localforge
if systemctl is-active --quiet localforge.service; then
 python3 scripts/capture-running.py
fi
systemctl stop localforge.service 2>/dev/null || true
install -d -m 755 /opt/localforge /opt/localforge/public /opt/localforge/src /opt/localforge/miners /opt/localforge/scripts
install -d -o localforge -g localforge -m 700 /var/lib/localforge
install -m 644 server.mjs package.json /opt/localforge/
install -m 644 src/*.mjs /opt/localforge/src/
install -d -m 755 /opt/localforge/worker
install -m 644 worker/connector.mjs /opt/localforge/worker/
install -m 644 scripts/api-key.mjs /opt/localforge/scripts/
install -m 644 scripts/read-oc.py scripts/nvidia-offsets.py /opt/localforge/scripts/
install -m 644 public/* /opt/localforge/public/
# Az app es a privilegizalt helper kodja csak root altal irhato.
chown -R root:root /opt/localforge
if [[ -e /opt/localforge/data && ! -L /opt/localforge/data ]]; then echo '/opt/localforge/data mar letezik es nem symlink; kezi ellenorzes kell.'; exit 1; fi
ln -sfn /var/lib/localforge /opt/localforge/data
sed -i 's/\r$//' scripts/localforge-oc.py
install -o root -g root -m 755 scripts/localforge-oc.py /usr/local/sbin/localforge-oc
install -o root -g root -m 755 scripts/localforge-reboot.py /usr/local/sbin/localforge-reboot
install -o root -g root -m 755 scripts/localforge-power.py /usr/local/sbin/localforge-power
printf '%s\n' 'localforge ALL=(root) NOPASSWD: /usr/local/sbin/localforge-oc' 'localforge ALL=(root) NOPASSWD: /usr/local/sbin/localforge-reboot ""' 'localforge ALL=(root) NOPASSWD: /usr/local/sbin/localforge-power poweroff, /usr/local/sbin/localforge-power reboot, /usr/local/sbin/localforge-power reboot-delay' > /etc/sudoers.d/localforge
chmod 440 /etc/sudoers.d/localforge
visudo -cf /etc/sudoers.d/localforge
cat > /etc/systemd/system/localforge.service <<'SERVICE'
[Unit]
Description=LocalForge local mining control
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=localforge
Group=localforge
WorkingDirectory=/opt/localforge
Environment=PATH=/opt/localforge/miners:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=XMRIG_PATH=/opt/localforge/miners/xmrig
Environment=LOLMINER_PATH=/opt/localforge/miners/lolMiner
Environment=SRBMINER_PATH=/opt/localforge/miners/SRBMiner-MULTI
ExecStart=/usr/bin/node /opt/localforge/server.mjs
Restart=on-failure
RestartSec=5
KillMode=control-group
TimeoutStopSec=20
UMask=0077

[Install]
WantedBy=multi-user.target
SERVICE
bash scripts/install-updater.sh
systemctl daemon-reload
bash scripts/install-app-updater.sh
bash scripts/repair-web-access.sh
systemctl enable --now localforge.service
echo 'Webes kezelo elindult. Hivatalos miner binarisok letoltese...'
# Csak letoltes/kicsomagolas; a binarisokat a telepito nem futtatja.
if ! python3 scripts/download-miners.py; then
 echo 'FIGYELEM: a minerletoltes nem teljes. A webfelulet mukodik, de a hianyzo minert potolni kell.'
fi
systemctl --no-pager --full status localforge.service
echo 'KESZ. Windows: open-web.bat. Cime: http://127.0.0.1:8080'
echo 'A korabban futo profilok automatikusan visszaindulnak. A kezzel leallitott profilok nem.'
