#!/bin/bash
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
base=ubuntu-26.04.1-live-server-amd64.iso
url=https://releases.ubuntu.com/26.04
printf 'Downloading official Ubuntu Server 26.04.1 ISO...\n'
curl -fsSL --retry 3 "$url/SHA256SUMS" -o ubuntu-SHA256SUMS
curl -fsSL --retry 3 "$url/SHA256SUMS.gpg" -o ubuntu-SHA256SUMS.gpg
gpgv --keyring /usr/share/keyrings/ubuntu-archive-keyring.gpg ubuntu-SHA256SUMS.gpg ubuntu-SHA256SUMS
if ! grep -F " *$base" ubuntu-SHA256SUMS | sha256sum --status -c - 2>/dev/null; then
 curl -fL --retry 3 --silent --show-error --continue-at - "$url/$base" -o "$base"
fi
grep -F " *$base" ubuntu-SHA256SUMS | sha256sum -c -
mkdir -p overlay/boot/grub overlay/nocloud overlay/localforge
xorriso -osirrox on -indev "$base" -extract /md5sum.txt original-md5sum.txt 2>extract.log
cat > overlay/boot/grub/grub.cfg <<'GRUB'
set timeout=15
set default=0
serial --unit=0 --speed=115200
terminal_output console serial
menuentry 'Install LocalForge Miner (select SSD and create user)' {
 linux /casper/vmlinuz autoinstall ds=nocloud\;s=/cdrom/nocloud/ console=tty0 console=ttyS0,115200n8 ---
 initrd /casper/initrd
}
menuentry 'Ubuntu Server manual installer (recovery)' {
 linux /casper/vmlinuz console=tty0 console=ttyS0,115200n8 ---
 initrd /casper/initrd
}
GRUB
cp user-data meta-data overlay/nocloud/
cp firstboot.sh show-info.sh localforge-firstboot.service fetch-release.py overlay/localforge/
cp source.tar.gz overlay/localforge/
(cd overlay/localforge && sha256sum source.tar.gz > source.tar.gz.sha256)
cp build-info.json overlay/localforge/
python3 - <<'PY'
import pathlib,hashlib
root=pathlib.Path('overlay');entries={line.split('  ',1)[1].lstrip('./'):line.split('  ',1)[0] for line in pathlib.Path('original-md5sum.txt').read_text().splitlines() if '  ' in line}
for file in root.rglob('*'):
 if file.is_file():entries[file.relative_to(root).as_posix()]=hashlib.md5(file.read_bytes()).hexdigest()
(root/'md5sum.txt').write_text(''.join(f'{digest}  ./{name}\n' for name,digest in sorted(entries.items())))
PY
printf 'Building hybrid BIOS/UEFI LocalForge ISO...\n'
xorriso -indev "$base" -outdev localforge-ubuntu-26.04.1-amd64.iso -boot_image any replay -map overlay / -commit -end 2>build.log
sha256sum localforge-ubuntu-26.04.1-amd64.iso > SHA256SUMS
xorriso -indev localforge-ubuntu-26.04.1-amd64.iso -report_el_torito plain -report_system_area plain > boot-report.txt 2>&1
python3 - <<'PY'
import yaml,json
from pathlib import Path
x=yaml.safe_load(Path('user-data').read_text());assert x['autoinstall']['interactive-sections']==['network','storage','identity'];assert 'identity' not in x['autoinstall'];assert 'storage' not in x['autoinstall'];assert not Path('overlay/localforge/source.tar.gz').stat().st_size<10000
print('CONFIG_CHECK_OK: interactive storage and identity; no preset password or disk target.')
PY
printf 'ISO_BUILD_COMPLETE\n'
ls -lh localforge-ubuntu-26.04.1-amd64.iso
cat SHA256SUMS
