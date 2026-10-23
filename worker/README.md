# Munkás regisztrálása névvel és egyedi kulccsal

A farmon belül csak a munkás nevét kell megadni. A központ egy 256 bites véletlen `lfw_…` kulcsot ad vissza egyszer. Mentsd el: a kulcs a munkás teljes vezérléséhez hozzáférést ad, a központ csak SHA-256 lenyomatát tárolja. Elvesztésekor távolítsd el a munkást és hozz létre új bejegyzést. A régi kulcs ezután nem működik. Nincs szükség a gép IP-címének vagy helyi agent API-kulcsának megadására a központban.

## Telepítés Ubuntun

### Ajánlott: beállítás első webes megnyitáskor

Az új minerfelületen a „Kapcsolódás a központhoz” szakasz első indításkor automatikusan nyitva van. A központ URL-jét, a munkás nevét és az egyedi kulcsot itt adhatod meg. A mentés ellenőrzi a központot, elmenti a kapcsolatot a helyi adatkönyvtár `worker-connection.json` fájljába 600 joggal, és elindul a háttérkapcsolat. A kulcsot a webes API nem adja vissza. Böngésző és újabb kézi beállítás nélkül is működik, gépújraindítás után visszakapcsolódik. „Maradok helyi módban” bezárja a szakaszt, „Kapcsolat bontása” törli a helyi központbeállítást. A helyi minerek tovább futnak.

Ez a miner új verziójának része; a meglévő élő gépre még nem telepítettük. A beépített webes csatlakozó mellett ne indíts külön Docker- vagy systemd-csatlakozót ugyanarra a munkásra. Az alábbi külön csatlakozók alternatív megoldások.

Előfeltétel: a meglévő LocalForge miner telepítése és működő helyi API az Ubuntu gépen. Ez a csomag a központhoz csatlakozó folyamatot adja hozzá; nem teljes Docker miner operációs rendszer, és nem telepít GPU-drivert. A miner telepítőjét továbbra is előbb kell futtatni.

A projekt forráskönyvtárában az alábbi két lehetőség közül egyet válassz:

```bash
# Natív systemd csatlakozó:
sudo bash worker/install.sh

# VAGY már telepített Docker Engine esetén:
sudo bash worker/install-docker.sh
```

Mindkettő bekéri a központ URL-jét, a munkás nevét és a generált kulcsot. A gép helyi API-kulcsát automatikusan létrehozza, nem kell megadnod. A titkok `/etc/localforge-worker/config.json` fájlba kerülnek root:localforge 640 joggal, nem a parancssorba. A Docker-változat csak a csatlakozót konténerezi; a meglévő miner backend, hardvervezérlés és minerek a hoston futnak. Nem kap Docker socketet vagy privileged jogot. Linux host hálózatot használ a host loopback agent API-jához. Dokumentáció: https://docs.docker.com/engine/network/drivers/host/

A munkás két másodpercenként kapcsolódik a szerverhez, és körülbelül tíz másodpercenként állapotot küld. Minden kérés a saját kulcsával hitelesített. Az első csatlakozás a gép tartós node ID-jához köti a kulcsot: más node ID-val nem használható. Az állapot a központban 45 másodperc után elévül, nem látszik friss mérésként. A vezérlést a központ várakozó kérésekkel küldi le, a helyi API továbbra is saját validációt és hővédelmet alkalmaz. Csak engedélyezett API-műveletek hajthatók végre, tetszőleges parancsfuttatás nincs.

A felfüggesztett, törölt vagy meg nem erősített tulajdonos munkásai nem kapcsolódhatnak. A vezérlési kérések nem tartósak: központújraindítás vagy időtúllépés esetén ellenőrizd az állapotot, mielőtt ismételnéd a műveletet. A csatlakozó hálózati hiba után magától újrapróbálkozik, a bányászat ettől függetlenül működik. A Docker és a systemd csatlakozó egyszerre ne fusson.

## Szerver elérése

A szerver URL-jét meg kell adni: a munkás ebből tudja, hová kapcsolódjon. A `127.0.0.1:8090` a Windows gépen futó tesztközpont, az Ubuntu számára önmagában nem elérhető. Helyi teszthez egy SSH reverse tunnel továbbíthatja a központot az Ubuntu loopback címére; később HTTPS-es szervercímet kell használni. A központ alapból csak loopback címen figyel, helyi tesztlevél módban is ezt követeli meg. A program most nem nyit LAN- vagy internetportot automatikusan.

A csatlakozót élő hardverre telepítés nélkül, szimulált agenttel teszteltük. Docker image buildet és friss Ubuntu telepítést külön gépen kell még ellenőrizni.
