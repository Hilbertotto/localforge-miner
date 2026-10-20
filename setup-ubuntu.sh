#!/usr/bin/env bash
set -Eeuo pipefail
trap 'echo "Hiba a(z) $LINENO. sorban. A telepites nem fejezodott be." >&2' ERR
if [[ $EUID -ne 0 ]]; then echo 'Inditas: sudo bash setup-ubuntu.sh'; exit 1; fi
source /etc/os-release
if [[ "$ID" != ubuntu || ( "$VERSION_ID" != 24.04 && "$VERSION_ID" != 26.04 ) ]]; then
 echo 'Ez a telepito Ubuntu 24.04 vagy 26.04 LTS rendszerhez keszult.'; exit 1
fi
skip_drivers=false
if [[ ${1:-} == --skip-drivers ]]; then skip_drivers=true; shift; fi
[[ $# -eq 0 ]] || { echo 'Ismeretlen kapcsolo'; exit 2; }
echo 'Ubuntu alapcsomagok es hardverfelismeres telepitese'
apt-get update
apt-get install -y ca-certificates curl wget git build-essential cmake pkg-config \
 pciutils usbutils iproute2 htop lm-sensors openssh-server ubuntu-drivers-common \
 ocl-icd-libopencl1 clinfo libhwloc-dev libuv1-dev libssl-dev
systemctl enable --now ssh
echo 'Felismert grafikus vezerlok:'
lspci -nn | grep -Ei 'VGA|3D|Display' || true
if ! $skip_drivers && lspci -dn 10de: | grep . >/dev/null; then
 if command -v nvidia-smi >/dev/null && nvidia-smi >/dev/null 2>&1; then
  echo 'A jelenlegi NVIDIA driver mukodik, megtartjuk.'
  nvidia-smi
 else
  echo 'NVIDIA eszkoz: Ubuntu altal ajanlott driver telepitese.'
  ubuntu-drivers install
 fi
fi
if lspci -nn | grep -Ei 'VGA|3D|Display' | grep -qi 'AMD\|ATI'; then
 echo 'AMD: a kernel amdgpu drivere az alap. ROCm/OpenCL es OC eszkoz'
 echo 'telepitesehez elobb ellenorizni kell a pontos GPU kompatibilitasat.'
fi
echo 'CPU:'
lscpu | sed -n '1,18p'
echo 'KESZ. Inditsd ujra a gepet: sudo reboot'
echo 'Ujrainditas utan: nvidia-smi (NVIDIA), clinfo, sensors'
echo 'Ez a script nem allit OC-t, nem indit banyaszatot, es nem telepit webes kezelot.'
echo 'Secure Boot mellett NVIDIA MOK regisztracio lehet szukseges a kovetkezo bootkor.'
