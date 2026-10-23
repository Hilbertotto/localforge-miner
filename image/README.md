# LocalForge Ubuntu telepítő

Ez egy **internetes telepítő**, Ubuntu Server 26.04.1 amd64 alapon. Az első SSD-s indításkor a nyilvános GitHub-tároló legújabb stabil LocalForge Release-csomagját tölti le és ellenőrzi. Nem a main ág pillanatnyi állapotát telepíti.

1. Bootolj a pendrive-ról, és válaszd az „Install LocalForge Miner” menüpontot.
2. Ellenőrizd a hálózatot (alapból DHCP).
3. Válaszd ki a cél-SSD-t. A kiválasztott céllemez törlődik; ellenőrizd a méretét és típusát.
4. Add meg az új gép nevét, saját Ubuntu-felhasználónevedet és jelszavadat.
5. Az Ubuntu telepítése után vedd ki a pendrive-ot, és indíts az SSD-ről.
6. Az első induláskor automatikusan települ a LocalForge és a minerprogramok. Ehhez internet kell; várd meg a befejezést.
7. A gépen vagy SSH-n futtasd: `sudo localforge-info`. Ez megmutatja a webcímet és az egyedileg generált webes belépést.
8. Nyisd meg a megadott `http://IP/` címet, majd a gépnév melletti kapcsolódási ikonnál add meg a központ elérhető címét, a munkás nevét és kulcsát.

Nincs beégetett wallet, pool, személyes jelszó vagy munkáskulcs. Új gépen a bányászat profil nélkül nem indul el.

A telepítő a célhardverhez illeszkedő, Ubuntu által ajánlott NVIDIA-drivert kéri. Secure Boot mellett a driver használatához a firmware MOK-jóváhagyást kérhet. AMD OC és telemetria továbbra sincs integrálva.

Hibanapló: `sudo journalctl -u localforge-firstboot.service`.
Sikertelen első konfigurálás újrapróbálása: `sudo systemctl restart localforge-firstboot.service`.
Az első telepítés sikerét a `/var/lib/localforge-installer/complete` fájl jelzi.

A meglévő Windows gépen futó központ `127.0.0.1:8090` címe egy másik gépről nem érhető el. A mostani SSH-alagút csak a jelenlegi minerhez van beállítva; új gépnél elérhető központcím vagy külön alagút szükséges.

Az image elkészítése és bootellenőrzése nem helyettesíti a tényleges, adott SSD-n és GPU-n végzett telepítési tesztet.
