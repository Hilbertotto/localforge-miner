# LocalForge v0.3.0

Első csomagolt kiadás, friss Ubuntu 26.04 LTS amd64 telepítéséhez.

- GitHubról letöltő Windows indító (`LocalForge-Setup-v0.3.0.zip`).
- Kiadáshoz kötött letöltés és SHA-256 ellenőrzés Windowson és az Ubuntun.
- Alapcsomagok, működő NVIDIA driver megőrzése vagy Ubuntu által ajánlott driver telepítése.
- CPU/GPU minerek, helyi webfelület, jogosultságos API és LAN-os Apache belépésvédelemmel.
- Gépenként külön azonosító és kulcsok; nincs GitHub-token a bányászgépen.
- Automatikus indulás, XMRig-frissítő, hővédelem, 24 órás mérési előzmény.
- Futó flight sheet mentése és alkalmazása, másolat mentése indítás nélkül.

Előfeltétel: már telepített Ubuntu, működő hálózat, OpenSSH és sudo-jogú felhasználó. A telepítő nem particionál SSD-t, nem készít walletet és nem indít új bányászatot. Driver/kernel után reboot, Secure Boot esetén kézi MOK-regisztráció is szükséges lehet. AMD OpenCL és OC nem teljesen automatizált.
