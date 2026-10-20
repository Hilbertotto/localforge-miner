# Ubuntu alap a banyaszgephez

A telepito fizikai gepre telepitett Ubuntu 24.04 vagy 26.04 LTS rendszert fogad el.
A teljes GitHubos telepítőhöz Ubuntu Server 26.04 LTS amd64 javasolt.
A meglevő rendszert nem kell ujratelepiteni az alapcsomagok telepitesehez.
A pontos GPU alapjan kesobb mas kiadas is szukseges lehet.

1. Mentsd a celgep fontos adatait. Toltsd le az Ubuntu Server 26.04 LTS amd64 ISO-t: https://ubuntu.com/download/server
2. Windows alatt Rufusszal keszits bootolhato pendrive-ot az ISO-bol. A pendrive tartalma torlodik.
3. Inditsd a banyaszgepet a pendrive UEFI bejegyzeserol.
4. A telepitoben allits be halozatot es valassz telepitesi lemezt. A teljes lemezes telepites a kivalasztott lemez adatait torli. Tobbi adatlemezt erdemes elotte lecsatlakoztatni.
5. Hozz letre sajat felhasznalot es eros jelszot, jelold be az Install OpenSSH server lehetoseget. Egyeb szervercsomag nem szukseges.
6. A telepites utan tavolitsd el a pendrive-ot es inditsd ujra a gepet.
7. Jelentkezz be, majd futtasd: `hostname -I`. Jegyezd fel a helyi IP-cimet.

## Alapcsomagok Windowsrol

A harom telepitofajlt tartsd egy mappaban. Inditsd az `install-from-windows.bat` fajlt,
add meg az Ubuntu gep IP-cimet es felhasznalonevet. Az SSH elso kapcsolodasakor
ellenorizd a gepazonositot; a program a bejelentkezesi es sudo jelszot is kerheti.
Windows OpenSSH kliens es mukodo helyi halozat kell hozza.

## Kozvetlenul Ubuntun

Masold a `setup-ubuntu.sh` fajlt a gepre, majd:

```bash
sudo bash setup-ubuntu.sh
sudo reboot
```

A script alapcsomagokat, SSH-t, monitorozast, OpenCL loader/diagnosztikat,
forditoeszkozoket es felismert NVIDIA hardver eseten az Ubuntu altal ajanlott
drivert telepiti. Az OpenCL loader onmagaban nem gyartoi compute runtime.
AMD compute runtime es OC eszkoz csak pontos kartyaazonositas utan valaszthato.
CPU OC-t altalaban a BIOS/UEFI-ben kell beallitani. A script nem modosit orajelet,
feszultseget, power limitet vagy tuzfalszabalyt. SSH-t csak megbizhato helyi
halozaton hasznalj, routeres porttovabbitast ne allits be hozza.

NVIDIA Secure Boot mellett MOK-jelszo es kovetkezo bootkor konzolos
kulcsregisztracio lehet szukseges. Ezt tavoli SSH nem tudja elintezni.

## Allapot

A telepito ezen a Windows gepen keszult; Ubuntu alatti telepitese es valos
GPU-kon a driver ellenorzese meg nem tortent meg. A `server.mjs` a kesobbi
webes kezelo megkezdett backendje, meg nem teljes webalkalmazas.

Forrasok:
- https://ubuntu.com/download/server
- https://documentation.ubuntu.com/server/how-to/graphics/install-nvidia-drivers/
- https://rocm.docs.amd.com/en/latest/compatibility/compatibility-matrix.html
