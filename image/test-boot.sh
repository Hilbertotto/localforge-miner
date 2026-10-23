#!/bin/bash
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
iso=localforge-ubuntu-26.04.1-amd64.iso
for mode in bios uefi; do
 printf 'BOOT_TEST_START %s\n' "$mode"
 extra=()
 if [[ $mode == uefi ]]; then
  code=/usr/share/OVMF/OVMF_CODE_4M.fd
  vars=/usr/share/OVMF/OVMF_VARS_4M.fd
  [[ -f $code && -f $vars ]]
  cp "$vars" test-uefi-vars.fd
  extra=(-drive "if=pflash,format=raw,readonly=on,file=$code" -drive 'if=pflash,format=raw,file=test-uefi-vars.fd')
 fi
 set +e
 timeout --signal=TERM --kill-after=10s 130s nice -n 19 qemu-system-x86_64 \
  -accel tcg -cpu max -smp 1 -m 1536 -no-reboot -display none \
  -serial "file:test-$mode.serial.log" -monitor none -nic none \
  -cdrom "$iso" -boot order=d "${extra[@]}" > "test-$mode.qemu.log" 2>&1
 result=$?
 set -e
 [[ $result == 0 || $result == 124 ]] || { cat "test-$mode.qemu.log"; exit 1; }
 python3 - "$mode" <<'PY'
from pathlib import Path
import sys,re
mode=sys.argv[1];s=Path('test-'+mode+'.serial.log').read_text(errors='replace')
s=re.sub(r'\x1b\[[0-9;?]*[A-Za-z]','',s)
if 'Kernel panic' in s or 'not supported on this CPU' in s:raise SystemExit('BOOT_TEST_FAILED '+mode)
if 'Install LocalForge Miner' not in s:raise SystemExit('BOOT_MENU_NOT_SEEN '+mode)
if 'Linux version' not in s and 'Booting Linux' not in s:raise SystemExit('LINUX_NOT_SEEN '+mode)
print('BOOT_TEST_OK',mode,'KERNEL',('Linux version' in s),'SUBIQUITY',('subiquity' in s.lower()))
Path('test-'+mode+'.summary.txt').write_text('\n'.join(s.splitlines()[-25:]))
PY
done
