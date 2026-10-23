#!/bin/bash
set -Eeuo pipefail
umask 077
state=/var/lib/localforge-installer
mkdir -p "$state"
trap 'echo "LocalForge setup failed. Check: sudo journalctl -u localforge-firstboot.service"; touch "$state/failed"' ERR
[[ ! -f "$state/complete" ]] || exit 0
for attempt in $(seq 1 60); do
 if curl -fsSI --connect-timeout 5 https://archive.ubuntu.com/ >/dev/null; then break; fi
 sleep 5
done
cd /opt/localforge-installer
latest_dir=$(mktemp -d /opt/localforge-installer/latest-XXXXXXXX)
python3 /opt/localforge-installer/fetch-release.py --output "$latest_dir/source"
cd "$latest_dir/source"
# Drivers are selected by Ubuntu's installer for the target hardware.
bash setup-ubuntu.sh --skip-drivers
bash install-web.sh
# Downloads must all finish successfully before marking the installation complete.
python3 scripts/download-miners.py
apt-get install -y apache2 apache2-utils
install -d -m 700 /etc/localforge
if [[ ! -s /etc/localforge/web-credentials ]]; then
 password=$(python3 -c 'import secrets; print(secrets.token_urlsafe(18))')
 printf '%s\n' "$password" | htpasswd -ci /etc/localforge/web.htpasswd miner
 printf 'Username: miner\nPassword: %s\n' "$password" > /etc/localforge/web-credentials
 unset password
fi
chmod 600 /etc/localforge/web-credentials
chown root:www-data /etc/localforge/web.htpasswd
chmod 640 /etc/localforge/web.htpasswd
a2enmod proxy proxy_http headers
cat > /etc/apache2/sites-available/localforge.conf <<'APACHE'
<VirtualHost *:80>
  ServerName localforge
  ProxyRequests Off
  ProxyPreserveHost Off
  ProxyPass / http://127.0.0.1:8080/ connectiontimeout=5 timeout=60
  ProxyPassReverse / http://127.0.0.1:8080/
  <Location />
    AuthType Basic
    AuthName "LocalForge miner"
    AuthUserFile /etc/localforge/web.htpasswd
    <RequireAll>
      Require valid-user
      Require ip 127.0.0.1 ::1 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16
    </RequireAll>
  </Location>
  Header always set X-Content-Type-Options "nosniff"
</VirtualHost>
APACHE
a2dissite 000-default
a2ensite localforge
apache2ctl configtest
systemctl enable apache2 localforge.service
systemctl restart apache2
systemctl is-active --quiet localforge.service
install -m 755 /opt/localforge-installer/show-info.sh /usr/local/bin/localforge-info
rm -f "$state/failed"
touch "$state/complete"
cat >> /etc/issue <<'NOTICE'

LocalForge: open http://<this-machine-IP>/ on your LAN.
Show address and web login: sudo localforge-info
First setup logs: sudo journalctl -u localforge-firstboot.service
NOTICE
printf '\nLocalForge installation complete. Run: sudo localforge-info\n'
