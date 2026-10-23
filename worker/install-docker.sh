#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Futtasd: sudo bash worker/install-docker.sh'; exit 1; }
[[ -f /opt/localforge/scripts/api-key.mjs ]] || { echo 'Először a LocalForge miner részt telepítsd.'; exit 1; }
docker info >/dev/null
src=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
python3 "$src/configure.py"
docker build -t localforge-worker:local "$src"
# Only one connector may use a worker identity at a time.
if systemctl is-active --quiet localforge-worker; then systemctl disable --now localforge-worker; fi
if docker container inspect localforge-worker >/dev/null 2>&1; then docker container rm -f localforge-worker; fi
docker run -d --name localforge-worker --restart unless-stopped --network host \
  --user "$(id -u localforge):$(id -g localforge)" --read-only --cap-drop ALL \
  --security-opt no-new-privileges \
  --mount type=bind,source=/etc/localforge-worker/config.json,target=/etc/localforge-worker/config.json,readonly \
  localforge-worker:local
echo 'Docker munkáscsatlakozó elindult. A meglévő miner szolgáltatás változatlanul fut.'
