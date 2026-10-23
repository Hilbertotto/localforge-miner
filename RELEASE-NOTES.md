# LocalForge v0.4.0

Központi farmkezelés és frissíthető miner Ubuntu 26.04 amd64 rendszerekhez.

- Felhasználói regisztráció, e-mail-megerősítés, adminisztráció, farmok és kulccsal csatlakozó munkások.
- Farmwallet- és flight sheet-tár, titkosított munkásmentések és újratelepítés utáni visszaállítás.
- Gentelella minerfelület, közös CPU/GPU hashrate-grafikon 1/3/6/12/24 órás időtávval.
- NVIDIA OC-modál, órajelzárak, core/memóriaoffset, ventilátor és power limit; külön mért és beállított órajel.
- VBIOS-alapú OC-sablonok hardver- és VRAM-ellenőrzéssel.
- Kézzel indítható stabil programfrissítés GitHub Release-ből, SHA256-ellenőrzéssel, program- és beállításmentéssel, program-visszaállítással hibás telepítésnél.
- Ubuntu telepítő-ISO készítési források. A telepítő kézzel kéri a lemezt és felhasználót, az első SSD-s induláskor a legújabb stabil LocalForge-kiadást tölti le. Internet szükséges.

A programfrissítés a miner szolgáltatást rövid időre újraindítja, a futó profilok visszaindulnak. Drivert nem frissít. A tároló és a stabil kiadáscsomagok nyilvánosak; a helyi jelszavak, walletek és munkáskulcsok nincsenek bennük.

Az új telepítés nem indít bányászatot profil nélkül. A teljes ISO fizikai SSD/GPU kombináción végzett telepítési tesztje külön szükséges; a bootellenőrzés önmagában nem ilyen teszt. AMD OC és telemetria továbbra sincs integrálva.
