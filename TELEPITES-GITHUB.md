# Teljes telepítés GitHubról

Tároló: **https://github.com/Hilbertotto/localforge-miner** (privát).

## 1. Új SSD / Ubuntu

Telepíts **Ubuntu Server 26.04 LTS amd64** rendszert. Hozz létre saját, sudo-jogú felhasználót, és jelöld be az **Install OpenSSH server** lehetőséget. A telepítés után legyen internetkapcsolat; a `hostname -I` paranccsal keresd meg a helyi IPv4-címet. A telepítő nem választ vagy töröl lemezt.

## 2. Windows indító

1. Jelentkezz be a tárolóhoz hozzáférő GitHub-fiókkal, majd a Releases oldalon töltsd le a **LocalForge-Setup-v0.3.0.zip** fájlt.
2. Bontsd ki egy könyvtárba, és futtasd a **setup-miner.bat** fájlt.
3. Add meg az **új Ubuntu gép IP-címét és felhasználónevét**. A meglévő miner `.local/connection.json` fájlját ez az indító nem használja, így nem választja ki magától a régi gépet.
4. Ha kell, telepíti a hivatalos GitHub CLI-t a winget csomagkezelőből, és bejelentkezést kér. Privát kiadást csak jogosult fiók tölthet le.
5. Az SSH az Ubuntu-jelszót, a sudo az adminisztrációs jelszót kérheti. Első kapcsolódásnál ellenőrizd a gépazonosító ujjlenyomatát.
6. A végén megkapod a webcímet, a `miner` webes felhasználónevet és az egyedi jelszót.

A GitHub hitelesítése a Windowson marad. A bányászgépre csak az ellenőrzött kiadási csomag kerül, GitHub-token nem. A jelszavak nem parancssori argumentumokban utaznak.

## Mit állít be?

- Ubuntu alapcsomagok, Node.js 22+, Python, szenzor- és GPU-felismerés.
- NVIDIA esetén a működő drivert megtartja; ha nincs működő driver, Ubuntu által ajánlottat telepít. CPU-only gép is használható. AMD-nél a kernel alapdrivere rendelkezésre állhat, de az OpenCL/OC a pontos hardvertől függ, nincs teljes automatikus AMD-beállítás.
- LocalForge, XMRig, SRBMiner, lolMiner a hivatalos kiadási forrásokból; gépinduláskor elinduló kezelő és XMRig-frissítő.
- Külön gépazonosító, `read,control,power` jogosultságú kezdeti API-kulcs, helyi hálózatra korlátozott Apache és külön webes jelszó.
- A program és a jogosultságos segédprogramok root tulajdonúak; a kezelő külön `localforge` rendszerfelhasználóval fut.
- Böngésző nélküli mérésgyűjtés és 24 órás előzmény. A watchdog alapból kikapcsolt; hőfokhatárt és műveletet a saját hűtésedhez állíts be a felületen.

**A walletet és a bányászprofilokat te adod meg a webfelületen. Friss gépen nem indul bányászat.** A CPU BIOS-tuningját, az SSD particionálását és a router DHCP-foglalását nem módosítja.

## Újraindítás, belépési adatok

Ha kernel- vagy drivertelepítés miatt szükséges, a végén jelzi a `sudo reboot` parancsot. Nem rebootol váratlanul SSH közben. Secure Bootnál a gép konzolján NVIDIA MOK-regisztrációra is szükség lehet. A kezelő reboot után automatikusan indul.

A gép saját belépési adatai és API-kulcsa root számára olvasható fájlban maradnak:

```bash
sudo cat /etc/localforge/install-credentials.json
```

Ezt a fájlt ne másold másik rigre vagy a tárolóba. A központi szerverhez gépenként külön API-kulcsot használj. A helyi HTTP-cím a LAN-ra korlátozott; internetes eléréshez VPN vagy HTTPS szükséges.

## Kapcsolók / újrafuttatás

```powershell
.\setup-miner.ps1 -Version v0.3.0 -Address 192.168.1.50 -UserName sajatuser
.\setup-miner.ps1 -SkipDrivers
.\setup-miner.ps1 -TunnelOnly
.\setup-miner.ps1 -Plan
```

Az alapértelmezés a legutolsó stabil kiadás. A `-Version` egy konkrét kiadást rögzít. A `-SkipDrivers` kihagyja a GPU-driver telepítését; a `-TunnelOnly` nem tesz ki LAN-os Apache-ot, ekkor SSH-alagút kell. A `-Plan` nem telepít és nem kapcsolódik hálózatra.

Újrafuttatható: a profilokat, walleteket, előzményeket és a korábbi kulcsokat nem törli. Meglévő gépen a kezelő frissítése rövid miner-újraindítást okozhat; a korábban futó profilok a mentett szándék szerint visszaindulnak. Visszavont API-kulcsot nem aktivál újra. Meglévő Apache-jelszót megőriz, nem váltja le csendben.

## Kiadás készítése

`python3 scripts/build-release.py --tag v0.3.0` csak az engedélylistás forrásokat csomagolja a `dist/` mappába. A `.local/`, `data/`, képernyőképek, jelszavak és futási állapotok nem kerülnek bele. A GitHub Actions futtatja a teszteket, majd verziótag esetén elkészíti a Release csomagjait. A SHA-256 ellenőrzés sérülést és keveredést jelez; a kiadás hitelességének forrása a jogosult GitHub-tároló és a HTTPS-kapcsolat.

A teljes, friss SSD-re történő Ubuntu-telepítést a bootstrap nem helyettesíti. A CI a programteszteket, a csomagolást és a telepítő szintaxisát ellenőrzi; GPU-driveres végponttól végpontig teszthez külön friss Ubuntu 26.04 gép szükséges.
