# LocalForge miner

Privát GitHub-tároló: https://github.com/Hilbertotto/localforge-miner

**Új gép teljes telepítése:** a Releases oldalról töltsd le a `LocalForge-Setup-v0.3.0.zip` indítócsomagot, bontsd ki, és futtasd a `setup-miner.bat` fájlt. Ubuntu Server 26.04 LTS amd64 + OpenSSH + sudo-felhasználó szükséges. A telepítő az új gép címét külön bekéri; nem használja automatikusan a meglévő miner mentett kapcsolatát. Részletes útmutató: [TELEPITES-GITHUB.md](TELEPITES-GITHUB.md).

A kiadási csomag nem tartalmaz gépspecifikus adatokat, walletadatbázist, jelszót, API-kulcsot vagy képernyőképet.

# LocalForge · helyi Ubuntu minerkezelő

## Profilok visszaindítása gép- vagy szolgáltatásindításkor

Az Indítás és Leállítás gombok tartósan mentik a kívánt futási állapotot a
`/var/lib/localforge/running-profiles.json` fájlba. Normál reboot, áramszünet,
alkalmazásfrissítés vagy a szolgáltatás újraindítása után a korábban elindított
profilok automatikusan visszaindulnak. A kézzel leállított és törölt profilok nem.
Szabályos szolgáltatásleállításkor a minereket leállítjuk, de az indítási szándék
megmarad. A fájl csak profilazonosítókat tartalmaz, walletet/jelszót nem.

Átmeneti indítási hiba esetén a rendszer 30 másodpercenként újrapróbálja a bootkor
visszaállítandó profilt. A profil kártyáján megjelenik a várakozás és az oka;
a Leállítás gomb a várakozást is törli. Futás közbeni minerösszeomlás után nincs
folyamatos automatikus újraindítási ciklus: ez a funkció a gép/szolgáltatás indulását
kezeli. A hővédelmi tiltást nem kerüli meg; túlmelegedés miatti reboot után a CPU
várakozik, amíg lehűlt és kézzel feloldottad a tiltást. A GPU-profilok visszaállhatnak.

A régi, futási állapotot nem mentő verzióról a telepítő megpróbálja az aktív
profilazonosítókat átvenni a helyi API-ból még a szolgáltatás leállítása előtt.
Ha ez nem sikerül, figyelmeztet: ekkor egyszer kézzel el kell indítani a kívánt
profilokat az új változatban. A rendszer újraindítása nem állítja vissza az OC/fan
kézi értékeit, csak a bányászprofilokat.

Első működő változat, Ubuntu 26.04 LTS-re. CPU és GPU külön profillal,
egyszerre is futtatható. Nem teljes HiveOS-helyettesítő vagy telepíthető OS-kép.

A felület kompakt rig-nézetet használ: állandó gép/miner-fejléc, vízszintes fülek,
soronkénti GPU-táblázat (hőfok, ventilátor, terhelés, fogyasztás, órajelek, power
limit) és szálankénti CPU-négyzetek. A négy hashrate/fogyasztás grafikon 1 órás vagy 1 napos időtávra váltható;
a GPU-hőmérséklet minigörbéi mindig az utolsó órát mutatják. Az Ubuntu tárolja az előzményeket, ezért újratöltéskor is megmaradnak. SRBMiner esetén
a GPU-hashrate a miner statisztikai kimenetéből jelenik meg, összesítve és kártyánként.
A kártyák párosítása a logban és az nvidia-smi-ben szereplő PCI-busz alapján történik,
nem eszközsorszám szerint. Ha a párosítás nem egyértelmű vagy a mérés 90 másodpercnél
régebbi, `—` látszik. A statisztika jellemzően 30 másodpercenként érkezik; a lolMiner
hashrate-je egyelőre a naplóból ellenőrizhető. A profilok, tuning, watchdog, címtár
és napló a külön füleken érhetők el.

## Új funkciók: wallet-címtár, JSON-import, hővédelem

A **Walletek** részen névvel, coin/hálózat megjelöléssel, címmel vagy poolfiókkal
menthető bejegyzés. Privát kulcsot és seedet nem tárolunk. A helyi adatfájl
`/var/lib/localforge/wallets.json`; a szolgáltatásfelhasználó számára olvasható.
A profilban mentett wallet kiválasztható, az indulás mindig az aktuális címet
olvassa a címtárból. Futó miner payout-címét nem módosítjuk automatikusan.
Használatban lévő walletet csak a profilhivatkozások eltávolítása után lehet törölni.

A **JSON import** egy HiveOS-jellegű `items`-bejegyzést alakít előnézeti profillá.
A **Pearl Kryptex példa betöltése** gomb a megadott SRBMiner/PearlHash profilt tölti be:
`prl-eu.kryptex.network:7048`, TLS kikapcsolva, password `x`. A címtárban megadható
a külső `wal_id` (a példánál `11067194`), így az import a helyi walletcímet feloldja.
Máskülönben kézi címet kell megadni. A sablonváltozókat feloldja; az import nem indít
bányászatot, előbb ellenőrizni és menteni kell a profilt. A GPU-sorszámokat az SRBMiner
saját eszközlistájából vedd: `/opt/localforge/miners/SRBMiner-MULTI --list-devices`.
A telepítő a hivatalos `doktor83/SRBMiner-Multi` stabil kiadását is letölti.
Különböző GPU-minerek párhuzamos futását egyelőre tiltjuk, mert az eszközsorrendjük
eltérhet. XMRig és SRBMiner GPU-profil egyszerre futhat.

A **Hőmérséklet & watchdog** 2 másodpercenként a Linux CPU-szenzorait olvassa
(`k10temp`, `coretemp`, `zenpower`, illetve CPU thermal zone). Az ismert CPU-szenzorok
legmagasabb értéke látszik, forrásmegjelöléssel; lemez/GPU-szenzor nem keveredik bele.
Az alapértelmezett watchdog kikapcsolt. Választható:

- Csak a kezelt CPU-miner leállítása, kézi feloldás és indítás szükséges.
- CPU-leállítás és automatikus visszaindítás, ha a megadott alacsonyabb hőfok
  alatt folyamatosan letelt a lehűlési várakozás. A várakozás külön megszakítható.
- Összes kezelt miner leállítása és az egész Ubuntu gép rebootja. Ezt csak futó
  kezelt CPU-miner mellett váltja ki. A tartós tiltás újraindítás után is megmarad,
  így nem okoz reboot-hurkot; lehűlés után kézi feloldás kell.

Hőmérőhiba esetén CPU-minerleállítás történik, nem reboot. A beállítások és
események a `watchdog.json` fájlban maradnak meg. A folyamat böngésző nélkül is fut,
de nem hardveres watchdog: lefagyott OS/Node vagy hibás szenzor esetén a BIOS/CPU
védelme továbbra is szükséges. A szolgáltatás újraindítása nem oldja fel a tartós
hővédelmi tiltást; lehűlés után kézi feloldás kell, majd a boot-visszaállítás újrapróbálja.

## Mentett kapcsolati adatok Windowson

Egyszer futtasd a `configure-connection.bat` fájlt. A program helyben bekéri az IP-t,
felhasználónevet, SSH-jelszót és sudo-jelszót. A sudo-mezőn üres Enter ugyanazt a
jelszót használja. A jelszavakat ne a chatben add meg.

A létrejövő `.local/connection.json` Windows DPAPI-val, az aktuális Windows-fiókhoz
kötve titkosítja a jelszavakat. A mappán csak az aktuális felhasználó kap hozzáférést;
a `.local` nincs Gitben, és nem része az Ubuntu-telepítőcsomagnak. Az ugyanazon
Windows-fiókkal futó programoktól ez nem biztosít teljes titokvédelmet. Másik gépen
vagy fiókban újra be kell állítani. A beállítófájl kézzel is szerkeszthető az IP/név
megváltoztatásához, de jelszócseréhez futtasd ismét a beállítót.

Ezután az `install-web.bat`, `open-web.bat` és az alaptelepítő is automatikusan
olvassa a mentett adatokat. Jelszó nem kerül parancssori argumentumba vagy átmeneti
szövegfájlba; a Windows segéd a gyermekfolyamat stdin csatornáján adja át, a sudo
pedig az SSH-csatorna stdin-jén kapja meg. Az alagúthoz a sudo-jelszó nem kerül
elküldésre. Nincs jelszó-/protokollnaplózás, a parancskimenet jelszóegyezéseit kitakarja.

A titkosított mód Python 3.10+-t és Paramikót használ saját `.local/python` környezetben;
első beállításkor a hivatalos PyPI-ról telepíti. A Codex mellékelt Pythonját felismeri,
ha az elérhető. Az SSH-hostkulcsot a Windows `~/.ssh/known_hosts` fájljával ellenőrzi;
ismeretlen gépet nem fogad el automatikusan. Első alkalommal szükség esetén lépj be
a szokásos `ssh felhasznalo@IP` paranccsal és ellenőrizd a gépazonosítót.
A mentett fájl nélkül a korábbi interaktív OpenSSH-mód változatlanul használható.

## Telepítés Windowsról

1. Indítsd az `install-web.bat` fájlt ebben a mappában.
2. Add meg az Ubuntu IP-címét, valamint a felhasználónevet, például `hilbi1`.
3. Az SSH és sudo jelszókérés után várd meg a `KESZ` üzenetet.
4. Indítsd az `open-web.bat` fájlt ugyanazokkal a kapcsolati adatokkal.
5. Az SSH-kapcsolat létrejötte után böngészőben: http://127.0.0.1:8080

Az open-web ablak maradjon nyitva. Ctrl+C bezárja az alagutat, a bányászprogramok
tovább futnak az Ubuntun. A webport nem kerül ki a helyi hálózatra vagy internetre.
Ha a Windows 8080-as portja foglalt, előbb állítsd le az azt használó alkalmazást.
Ne futtass közben Windowsos `npm start` előnézetet ugyanazon a porton.

Az alapcsomag-telepítőt (`install-from-windows.bat`) nem kell újra futtatni.
A webtelepítő megtartja a meglévő NVIDIA-drivert és a korábban mentett webprofilokat.
Az alkalmazás frissítése ideiglenesen leállítja a kezelt bányászfolyamatokat,
majd az új szolgáltatás a mentett futási állapot szerint visszaindítja őket.

## Mit telepít?

- Node.js az Ubuntu csomagtárából, Python és futási alapcsomagok.
- `/opt/localforge`: root tulajdonú alkalmazáskód és miner binárisok.
- `/var/lib/localforge`: a `localforge` szolgáltatásfelhasználó profiljai.
- `localforge.service`: automatikusan induló kezelő, a korábban futó profilok visszaállításával.
- NVIDIA OC helper: UUID alapú power limit, abszolút GPU/memóriaórajel és visszaállítás.
- XMRig és lolMiner: hivatalos GitHub latest kiadás letöltése; SHA256 ellenőrzés,
  ha a GitHub asset digest rendelkezésre áll. A letöltött verzió és hash a miner
  mappájában kerül rögzítésre. A minerek saját fejlesztői díjai érvényesek.

A webes folyamat nem root. A sudo-jog kizárólag a root által írható OC helperre
vonatkozik, amely ellenőrzi a paramétereket és lekérdezi a GPU teljesítménykorlátait.
Nincs általános parancsfuttatás vagy tetszőleges minerargumentum a webes API-ban.

## Első használat

### XMRig automatikus frissítése és szálankénti hashrate

A telepítő a `localforge-xmrig-update.timer` időzítőt is felteszi. Boot után
10 perccel, majd hatóránként (0–5 perc véletlen késleltetéssel) ellenőrzi a
hivatalos `xmrig/xmrig` GitHub-repository legfrissebb stabil release-ét.
Csak eltérő, újabb verziónál tölt le; hiányzó/sérült binárist azonos verziónál
is javít. Ugyanaz a frissítési zár védi a telepítőt és az időzítőt.
SHA256-eltérésnél vagy letöltési hibánál megtartja a telepített binárist.
Az előző bináris neve `xmrig.previous`, a verzióadata külön fájlban marad meg.
Futó bányászatot a timer nem szakít meg; a telepített új verzió a következő
kézi minerindítástól fut. lolMinerhez nincs periodikus automatikus frissítés.

```bash
systemctl list-timers localforge-xmrig-update.timer
sudo journalctl -u localforge-xmrig-update.service -n 30 --no-pager
# Azonnali XMRig-verzióellenőrzés, minerújraindítás nélkül:
sudo systemctl start localforge-xmrig-update.service
```

A CPU-hashrate összesítve és XMRig-bányászszálanként négyzetekben látható,
10 másodperces, 60 másodperces vagy 15 perces átlaggal. Egy négyzet nem
feltétlenül külön fizikai mag: az API szerinti szál és CPU-affinitás jelenik meg.
Hiányzó adatnál `—` szerepel, nem becsült vagy mesterségesen elosztott érték.
Az adatforrás a helyi, tokennel védett XMRig API (`127.0.0.1:18088`);
az API nem kerül ki a hálózatra, a token nem jut el a böngészőhöz.
A méréshez az új alkalmazáskóddal kell indítani a CPU-profilt. Az SRBMinerhez
nem nyitunk külön API-portot, a statisztikai stdout-adatokat dolgozzuk fel.
A kezelt minerek külön írható munkakönyvtárat kapnak a `miner-work/PROFIL_ID`
alatt, így az SRBMiner saját Cache mappája is létrehozható root jog nélkül.

Meglévő telepítés frissítése: `install-web.bat`, majd a weboldal újratöltése.
A telepítés a profilokat megőrzi, a korábban futókat automatikusan visszaindítja.
A korábbi hibás `--no-opencl` és `--no-cuda` argumentumok
is kikerültek az XMRig indításából.

1. Hozz létre CPU-profilt (XMRig), algoritmussal, saját wallettel és poolcímmel.
2. A GPU-profil előtt ellenőrizd a lolMiner saját eszközlistáját SSH-n:

```bash
/opt/localforge/miners/lolMiner --list-devices
```

3. Hozz létre lolMiner GPU-profilt. A devices mező lolMiner-sorszámokat vár,
   például `0,1`. Ez nem automatikusan az nvidia-smi szerinti sorrend.
4. A profilok külön indíthatók és leállíthatók. Ugyanazt a lolMiner-eszközt nem
   engedjük több profilnak egyszerre használni; CPU-ból egy profil futhat.
5. Ellenőrizd a naplóban a hashrate-et, poolkapcsolatot és elfogadott share-eket.

TLS csak TLS-t támogató poolporttal használható. Az algoritmusválaszték jelenleg
XMRig: rx/0, ghostrider, cn-heavy/xhv; lolMiner: ETCHASH, AUTOLYKOS2, BEAM-III.
A hardver és algoritmus támogatását a telepített miner verziója határozza meg.
Nincs profit szerinti automatikus váltás vagy dual mining ebben a változatban.

## OC

Az Alkalmaz gomb azonnali műveletet indít a kiválasztott UUID-re. A power limit
hardverből lekérdezett tartományban állítható. Órajeleknél a driver mondja meg,
hogy a művelet támogatott-e. Abszolút MHz értékeket használunk, nem offseteket.
Az OC minerleállítás után is érvényben maradhat, és nem alkalmazzuk újra bootkor.
A Gyári visszaállítás törli a GPU- és memóriaórajelrögzítést, majd a gyári power
limitet állítja vissza; nem támogatott részlépés esetén részleges hibát jelez.
Az OC-profilok tartós mentése és GPU-hővédelmi watchdog még nincs kész.
CPU-OC: BIOS/UEFI. AMD-OC és telemetria még nincs integrálva.

### NVIDIA ventilátor

A GPU-táblázat FAN értékére kattintva, illetve az Overclocking fülön kártyánként
kézi 30–100%-os ventilátorsebesség állítható. Az Auto gomb visszaadja a vezérlést
a drivernek. Az NVML driverkönyvtárat a korlátozott root helper kezeli, UUID alapján,
az adott kártya összes ventilátorára. Részleges sikertelenség esetén megpróbálja
visszaállítani minden ventilátor automatikus módját, és hibát jelez.
Nem támogatott GPU/driver esetén egyértelmű hiba látszik; X11/Coolbits nem szükséges.
A kézi sebesség felülírja az automatikus hőfok szerinti szabályozást. Az OC gyári
visszaállítása csak az órajelrögzítést és power limitet érinti; a ventilátorhoz
külön Auto gomb van. A fanbeállítást bootkor nem alkalmazzuk újra.

## Hibakeresés SSH-n

```bash
systemctl status localforge --no-pager
sudo journalctl -u localforge -n 60 --no-pager
nvidia-smi
```

Ha a GitHub-letöltés nem sikerült, a feltöltött telepítő könyvtárából ismételhető:
`sudo python3 scripts/download-miners.py`. A webes kezelő ettől függetlenül fut.
Kézzel telepített binárisok helye: `/opt/localforge/miners/xmrig` és
`/opt/localforge/miners/lolMiner`. Bináriscseréhez előbb állítsd le a profilokat.

## Fejlesztés és ellenőrzés

Node.js 22+: `npm start`, majd http://127.0.0.1:8080. Külső npm-függőség nincs.
`npm test`: API, tartós mentés, folyamatállapot, CPU/GPU konkurencia, eszközütközés
és szálankénti XMRig-telemetria. `python3 -B -m unittest discover -s tests -p test_updater.py`:
verziókihagyás, upgrade, előző bináris megőrzése, sérülésjavítás és hibás letöltés.
Az automatizált ellenőrzések mockolt folyamatokkal és teszt-szenzoradatokkal futnak
Windows alatt. A wallet mentését és a Pearl JSON-importot külön fejlesztői előnézetben
böngészőből is ellenőriztük, szimulált adatokkal. A CPU-watchdog valódi hőterheléses
tesztje, az automatikus reboot és a mentett jelszavas SSH teljes folyamata még nem
volt ellenőrizhető az Ubuntu célgépen. Az új funkciók a következő telepítéskor kerülnek oda.

Források: [XMRig](https://xmrig.com/docs/miner/command-line-options),
[lolMiner](https://github.com/Lolliedieb/lolMiner-releases),
[NVIDIA SMI](https://docs.nvidia.com/deploy/nvidia-smi/).


### Grafikonok és teljes gép vezérlése

Az áttekintésen felül CPU/GPU-hashrate, alattuk CPU/GPU-fogyasztás látszik. Az időtengely valós mintavételi időpontokat használ; egérrel vagy bal/jobb nyíllal közös időpont választható. Az alsó sor a legközelebbi minta idejét és mind a négy értéket írja ki. Az Ubuntu 24 óra előzményét gyűjti és lemezre menti böngésző nélkül is; az 1 órás nézet 5 másodperces mintákat, az 1 napos nézet perces átlagokat mutat. Újratöltés és szolgáltatásrestart után az előzmény visszatöltődik. A hashrate a miner saját átlagolt jelentése, nem pillanatnyi mérés. Eltérő GPU-algoritmusokat nem összegez a grafikon.

A CPU-fogyasztás olvasható Linux RAPL package energiából számított watt. Szenzor vagy olvasási jogosultság nélkül — jelenik meg; nincs TDP-alapú becslés. A GPU-adat a felismert kártyák teljes összege, nem a teljes gép konnektorból mért fogyasztása.

A felső gombok a teljes Ubuntu gépet kapcsolják ki vagy indítják újra, megerősítést követően. A „Reboot · 30 mp múlva” systemd-időzítővel működik, böngészőtől függetlenül; a 30 másodperc a reboot kezdetéig tart, a boot ideje ezen felül értendő. Az időzítés után a felület új vezérlési műveletet nem fogad. A futó profilok indulási szándéka megmarad, ezért boot után visszaindulnak, ha a watchdog engedi. Kikapcsolás után külön bekapcsolás szükséges.

A módosításokat az `install-web.bat` ismételt futtatásával lehet telepíteni az Ubuntura.


### Központi gépkezeléshez használható API

A verziózott `/api/v1/` agent API külön Bearer-kulccsal érhető el. Tartós gépazonosító, read/control/power scope-ok, visszavonható kulcsok, állapot- és paraméterlekérdezés, profil-, wallet-, watchdog-, NVIDIA OC/fan- és gépvezérlés tartozik hozzá. A kulcsok nem kerülnek automatikusan létrehozásra, és nem nyit új hálózati portot. A meglévő helyi webfelület működése megmarad.

Telepítés után kulcs készíthető: `sudo -u localforge /usr/bin/node /opt/localforge/scripts/api-key.mjs create central read,control,power`. A tokent csak a létrehozáskor írja ki. Részletes szerződés, példák, Apache/VPN elérési feltételek és a központi szerver tervezett kapcsolódása: [API.md](API.md). Géppel olvasható végpontleírás: [openapi.json](openapi.json).

A több gépet összesítő dashboard és a NAT mögötti agentek kifelé nyitott kapcsolata későbbi fejlesztés; ez a változat az agentoldali API-alapot tartalmazza.


### Közvetlen helyi hálózati elérés Apache-on át

Az `install-lan.bat` külön telepíti az Ubuntu Apache frontendjét, és nem indítja újra a miner-szolgáltatást. A megadott LAN IP-n figyelő Apache átadja a kéréseket a továbbra is kizárólag `127.0.0.1:8080` címen figyelő Node-szolgáltatásnak. Jelenlegi cím: `http://192.168.0.18:8080/`. Az IP maradjon állandó (például DHCP-foglalással); IP-cserénél az install-lan telepítést újra kell futtatni a frissített kapcsolati címmel.

A felület és a legacy API HTTP Basic bejelentkezést kap. Felhasználónév: `miner`; az egyedi generált webes jelszót a Windows DPAPI-val titkosítva menti a `.local/connection.json` fájlba. A `web-login.bat` a felhasználó saját termináljában megjeleníti a belépési adatokat. Ez külön jelszó, nem az Ubuntu/SSH jelszava. A Linuxon bcrypt lenyomat marad. Az API v1 Bearer-hitelesítése külön működik; ahhoz az API-verziót is telepíteni és kulcsot létrehozni kell.

Az Apache a felismert helyi alhálózatból enged hozzáférést (jelenleg `192.168.0.0/24`). Aktív UFW esetén csak ennek az alhálózatnak nyitja meg a LAN IP 8080-as portját. Apache rendszerindításkor automatikusan indul, az SSH-alagút nem kell a LAN-os használathoz. Ez helyi HTTP-elérés; internetes használat előtt HTTPS vagy VPN szükséges.

A `web-login.bat` csak a belépési adatok megtekintésére szolgál, az ablakot utána be lehet zárni. A korábbi `open-web.bat` SSH-alagutas hozzáférés változatlanul működik.


### Grafikon időtávok és előzménytárolás

A „Teljesítmény és fogyasztás” időtávválasztója a négy nagy grafikonon 1 órát vagy 1 napot állít. A választás a böngészőben megmarad. A GPU-k melletti hőmérsékleti minigörbék mindkét nézetben egyórásak. Az időtengely mindig a teljes választott időtartamot mutatja; ahol nincs mérés, ott nincs görbe. Az új adatgyűjtés telepítése előtti időszakhoz nem készül mesterséges előzmény.

A szolgáltatás 5 másodpercenként gyűjt, az utolsó 24 órát `history-YYYY-MM-DD.jsonl` fájlokban őrzi a saját adatkönyvtárában. A napi görbék perces átlagok. A grafikon alatti részletkijelző jelzi a kiválasztott minta/átlag idejét és felbontását. A régi napokat automatikusan törli; a többi adatfájlhoz nem nyúl. A v1 API ugyanezt az előzményt szolgáltatja a központi kezelőnek.


### Egységes miner-fejléc eszközkockákkal

Minden miner saját sorában jelennek meg az eszközkockák. Az XMRig minden bányászszálához külön kocka tartozik 10 másodperces átlagos hashrátával. A feltüntetett CPU-hőfok a közös CPU-szenzor értéke, nem szálanként külön mért adat; ezt a felirat és a kocka magyarázata jelzi. A szálak 1-től számozott XMRig-szálak, nem feltétlenül külön fizikai magok; ismert affinitásnál a magyarázat logikai CPU-azonosítót is tartalmaz.

A GPU-minerek saját kockái GPU-sorszámot, friss kártyánkénti hashrátát, hőfokot és ventilátorsebességet mutatnak. A fizikai kártyák és a profil összerendelése PCI-busszal történik. Ha még nincs egyértelmű azonosítás, a csillagos GPU-sorszám a miner saját eszközazonosítója, a hőfok és ventilátor helyén — jelenik meg. A kockák tördelődnek keskeny kijelzőn. A `update-ui` mentett kapcsolati mód csak a három webes fájlt cseréli, a minerek és a kezelőszolgáltatás újraindítása nélkül.


A miner-fejléc a referencia szerinti tömör, háromsoros blokkot használ: profilnév, miner/verzió/állapot, pool és worker. Mellette az algoritmus és az összesített hashrate, majd keskeny eszközkockák látszanak. A kockák sorrendje: eszközazonosító, hőfok, ventilátorsáv (CPU-nál közös CPU-hő jelölés), hashrate. A kockák közös hashrate-egységét a profil alatti sor jelzi; a teljes egységes érték a számra mutatva is látszik. A ventilátorsáv színe a kijelzett ventilátorszázalékot követi; nem módosít vezérlési beállítást.


### Futó flight sheet szerkesztése és másolat mentése

A Szerkesztés gomb futó profilnál is megjelenik. Azonos név mellett a „Mentés és alkalmazás” menti a paramétereket, és csak az érintett minert indítja újra. Új név megadásakor a felület „Új profil mentése · nem indul” módra vált; a „Mentés új néven” gomb is ezt használja. A másolat külön azonosítót kap, leállítva marad, és az autostart-listába sem kerül be. Az eredeti profil és annak folyamata ilyenkor nem változik.

Új profilnál már létező nevet megadva a felület felülírási megerősítést kér; a szerver nem enged véletlenül két azonos nevű profilt. Leállított profil mentése nem indítja el azt. Hibás paramétert vagy eszközütközést leállítás előtt elutasít. Ha az új konfiguráció nem indítható, visszaállítja és megpróbálja futtatni a régit; a hővédelmet visszaállításkor sem kerüli meg. Az API ugyanazt a mentési folyamatot használja.

## Programfrissítés és saját telepítő

A miner oldalsávjának **Programfrissítés** gombja megmutatja a telepített és a legújabb stabil GitHub-verziót. A frissítés kézzel indítható; program- és beállításmentés után a szolgáltatás újraindul, a futó profilok visszaindulnak. A driver változatlan marad. Kiadások: https://github.com/Hilbertotto/localforge-miner/releases/latest.

Az internetet igénylő Ubuntu telepítő-ISO készítési forrásai és használata: [image/README.md](image/README.md). Nem tartalmaznak személyes jelszót, walletet vagy munkáskulcsot.
