#!/bin/bash
set -Eeuo pipefail
# Repair only the known ISO-created Apache auth file; do not alter other setups.
if [[ -d /etc/localforge && ! -L /etc/localforge && -f /etc/localforge/web.htpasswd && ! -L /etc/localforge/web.htpasswd ]]; then
 chown root:www-data /etc/localforge /etc/localforge/web.htpasswd
 chmod 750 /etc/localforge
 chmod 640 /etc/localforge/web.htpasswd
 if [[ -f /etc/localforge/web-credentials && ! -L /etc/localforge/web-credentials ]]; then
  chown root:root /etc/localforge/web-credentials
  chmod 600 /etc/localforge/web-credentials
 fi
fi
