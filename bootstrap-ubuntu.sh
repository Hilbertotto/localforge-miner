#!/usr/bin/env bash
set -Eeuo pipefail
trap 'echo "HIBA: a teljes telepites a(z) $LINENO. sorban megszakadt. Ujrafuttathato; a profilokat nem toroljuk." >&2' ERR
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
address=''
skip_drivers=false
tunnel_only=false
plan=false
while (($#)); do
 case "$1" in
  --address) [[ $# -ge 2 ]] || exit 2; address="$2"; shift 2 ;;
  --skip-drivers) skip_drivers=true; shift ;;
  --tunnel-only) tunnel_only=true; shift ;;
  --plan) plan=true; shift ;;
  *) echo "Ismeretlen kapcsolo: $1" >&2; exit 2 ;;
 esac
done
if $plan; then
 echo '1. Ubuntu 26.04 amd64 es IP ellenorzes'
 echo '2. Alapcsomagok es szukseg eseten NVIDIA driver'
 echo '3. LocalForge, hivatalos minerek, systemd es XMRig frissito'
 echo '4. Egyedi gepazonosito, API-kulcs, vedett LAN-os Apache es belepes'
 echo '5. Mukodesellenorzes; szukseges reboot jelzese. Uj profil nem indul.'
 exit 0
fi
[[ $EUID -eq 0 ]] || { echo 'Inditas: sudo bash bootstrap-ubuntu.sh --address HELYI_IP'; exit 1; }
source /etc/os-release
[[ "$ID" == ubuntu && "$VERSION_ID" == 26.04 && "$(uname -m)" == x86_64 ]] || { echo 'Ubuntu 26.04 LTS amd64 szukseges.'; exit 1; }
command -v python3 >/dev/null || { apt-get update; apt-get install -y python3; }
python3 scripts/bootstrap-finalize.py --check-address "$address" --check-release
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l
if $skip_drivers; then bash setup-ubuntu.sh --skip-drivers; else bash setup-ubuntu.sh; fi
bash install-web.sh
if ! $tunnel_only; then apt-get install -y apache2 apache2-utils; fi
options=(--address "$address")
if $tunnel_only; then options+=(--tunnel-only); fi
python3 scripts/bootstrap-finalize.py "${options[@]}"
echo 'Az uj rendszer kesz. Walletet es profilt a webfeluleten adj meg; a telepito nem indit uj banyaszatot.'
if [[ -f /var/run/reboot-required ]] || { lspci -dn 10de: | grep -q . && ! nvidia-smi >/dev/null 2>&1; }; then
 echo 'Ujrainditas szukseges a kernel/driver miatt: sudo reboot'
 echo 'Secure Boot eseten a gep konzoljan MOK-regisztracio is szukseges lehet.'
fi
