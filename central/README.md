# LocalForge Central

Külön központi szolgáltatás a meglévő LocalForge agentekhez. Nem telepít és nem indít minert a központi gépen. A bányászgépek jelenlegi telepítése változatlanul működik.

## Indítás Windows alatt

Node.js 22 vagy újabb szükséges. A projekt könyvtárában:

```powershell
node central/server.mjs
```

Vagy indítsd a `central/start-central.bat` fájlt. Nyisd meg a http://127.0.0.1:8090 címet. Az első indítás a terminálban kiírja az egyszer generált adminjelszót. Mentsd el. A következő indítások ezt a jelszót tartják meg, a munkamenetek viszont megszűnnek. Az első indítás előtt a `LOCALFORGE_CENTRAL_PASSWORD` változóval saját, legalább 12 karakteres jelszó is megadható.

## Külön Ubuntu szerver

Másold át ezt a forráskönyvtárat, telepíts Node.js 22+ verziót, majd:

```bash
sudo bash central/install.sh
sudo journalctl -u localforge-central --no-pager
```

A szolgáltatás automatikusan elindul újraindítás után. Alapból loopback címen figyel. Windowsról SSH-alagút:

```powershell
ssh -L 8090:127.0.0.1:8090 FELHASZNALO@SZERVER_IP
```

Ezután böngészőben http://127.0.0.1:8090. Távoli közvetlen eléréshez HTTPS reverse proxy szükséges; ne publikáld titkosítatlanul. A környezeti változók: `LOCALFORGE_CENTRAL_HOST`, `LOCALFORGE_CENTRAL_PORT`, `LOCALFORGE_CENTRAL_DATA`. Az Ubuntu service /usr/bin/node útvonalú Node telepítést vár.

## Gép felvétele

A központi szervernek hálózaton el kell érnie az agentet (helyi hálózat vagy VPN). A bányászgépen SSH-n hozz létre külön kulcsot; ez nem igényel minerrestartot:

```bash
sudo -u localforge /usr/bin/node /opt/localforge/scripts/api-key.mjs create central read,control,power
```

A felületen add meg a gép nevét, címét (például http://192.168.0.18:8080) és a kulcsot. A felvétel ellenőrzi az agent azonosítóját, a duplikált gépeket elutasítja. Olvasási kulccsal megfigyelés működik; az agent ellenőrzi a vezérlési és power jogosultságokat. Az agent Apache hálózati engedélyezése jelenleg a saját LAN-jára korlátozott: másik alhálózatból érkező központnak külön hálózati konfiguráció kell.

15 másodpercenként frissül az állapot, látszik a CPU/GPU hashrate és a profilok futása. Profil indítható, leállítható, JSON szerkesztőben módosítható; futó profil mentése újraindítja az érintett minert. A gép rebootja megerősítést kér. Az eltávolítás csak a központ nyilvántartását módosítja.

## Adatok és korlátok

Windows alatt `central/data`, Ubuntu alatt `/var/lib/localforge-central` tartalmazza a tartós adatokat. Az API-kulcsok AES-256-GCM titkosítással tárolódnak; a `vault.key` ugyanebben a védett könyvtárban van. A teljes könyvtár mentése szükséges, és annak olvasási joga a kulcsokhoz is hozzáférést jelent. Windows alatt a könyvtár hozzáférését a saját fiókodra korlátozd; a POSIX 600 mód Windows alatt nem ACL. Ne másold GitHubra. Az adminjelszó sózott scrypt lenyomatként tárolódik. A szerver első indítási naplója tartalmazza a generált jelszót, kezeld ennek megfelelően.

Fiókok, e-mailes megerősítés, saját farmok és farmonként több munkás támogatott. Nincs még központi grafikon, riasztás, farmmegosztás, jelszó-visszaállítás, kimenő agentkapcsolat vagy automatikus gépfelderítés. A teljes engedélyezett agent API a központ `/api/rigs/ID/…` útvonalán elérhető, munkamenet és POST esetén `X-CSRF-Token` szükséges; a kulcsot nem küldi a böngészőnek. A gépállapot csak sikeres élő lekérésből jelenik meg.

## Regisztráció és farmok

### Farmonként közös walletek és flight sheetek

### Munkásbeállítások mentése és újratelepítés utáni helyreállítás

A beépített miner-csatlakozó automatikusan küldi a helyi profilokat (pooljelszóval), walleteket, watchdog-konfigurációt és tiltási állapotot, az automatikus indítási listát és a rögzített NVIDIA OC-/ventilátorbeállításokat. A kezdeti teljesítménykorlátot és a támogatott driverből olvasható ventilátor-policy/target értéket is átveszi; korábban nem rögzített core/memory lockot nem becsül működési órajelből. A további, felületen sikeresen alkalmazott OC-módosítások mentésre kerülnek, és normál gépújraindításkor a minerek előtt érvényesülnek. A helyi root helper az aktuális hardverkorlátokat továbbra is ellenőrzi; sikertelen OC-visszaállításnál a miner-visszaindítás várakozik.

A központ `worker-backup-UUID.json` fájlonként három konfigurációverziót őriz, AES-256-GCM titkosítva a saját vaultkulcsával. Azonos tartalom nem hoz létre új verziót. A központ újraindulása nem törli ezeket. A munkás „Mentések” gombja és a miner kapcsolatpanelje mutatja a legutóbbi mentés idejét és elemszámait. A központ teljes adatkönyvtárát, a `vault.key` fájllal együtt külön is mentsd: adatkönyvtár elvesztése vagy törlése ellen ez nem külső biztonsági mentés.

Újratelepített minernél a korábbi munkásnevet és kulcsot add meg, és jelöld az „Újratelepített gép: korábbi mentés letöltése” lehetőséget. Más node ID-ra váltáshoz a régi kapcsolat legalább 45 másodperce ne legyen aktív; ezután az új telepítéshez kötjük a munkást. A letöltött mentés külön, védett helyi fájlba kerül, az új üres beállítások addig nem írhatják felül a központi mentést. A visszaállítás külön megerősítést kér, az OC és a korábban futó profilok indítása külön választható. Futó minerek mellett visszaállítás nem engedélyezett. Az OC-sablon VBIOS-verzió alapján kerül mentésre; alkalmazás előtt a PCI-eszközazonosító, a Subsystem ID és a VRAM-méret egyezését is ellenőrizzük. Így kompatibilis cserekártyán vagy átrendezés után is visszatölthető. A régi, sablon nélküli mentések továbbra is GPU-UUID alapján működnek; eltérő hardvernél OC nélkül lehet visszaállítani. Hővédelmi tiltást nem oldunk fel automatikusan. A helyi profilok és walletek cseréje felülírja az aktuális beállításokat; elutasított vagy részlegesen sikertelen alkalmazást az állapotban ellenőrizni kell, a minerek ilyenkor nem indulnak automatikusan.

Ez konfigurációmentés, nem teljes SSD-kép: nem tartalmazza az operációs rendszert, drivereket, SSH-/webjelszavakat, a munkáskulcsot vagy a teljes grafikon-/naplóelőzményt. A külön Docker/systemd csatlakozó ebben a verzióban csak állapotot és parancsokat továbbít; az automatikus mentési és webes helyreállítási funkció a minerbe épített csatlakozóban működik.

A kiválasztott farmon belül külön wallet- és flight sheet-lista van. Ezek a központ adatkönyvtárának `farm-library.json` fájljában tárolódnak. Minden bejegyzés farmhoz kötött; másik farm adatait nem lehet hivatkozni vagy munkásra küldeni. A pooljelszó ugyanazzal a védett vaultkulccsal titkosítva kerül lemezre, mint az agentkulcsok; olvasási API nem adja vissza. Wallet alatt csak nyilvános walletcímet vagy poolfiókot értünk, privát kulcs tárolása nem része a funkciónak.

Először adj hozzá walletet (név, coin/hálózat, cím), majd flight sheetet (miner, algoritmus, wallet, pool, CPU-szálak vagy GPU-eszközök, TLS és opcionális pooljelszó). A `%WORKER_NAME%` a célmunkás nevéből képzett, miner számára megengedett karakterekből álló név lesz; a wallet sablonban `%WAL%` és `%WORKER_NAME%` használható. A központ legfeljebb 1024 CPU-szálat fogad sablonként, de a célgép saját hardverhatárát az agent ellenőrzi.

A központi mentés nem küld automatikusan módosítást a gépeknek. A „Munkásra küldés” egy munkásra másolja a flight sheet és a wallet aktuális verzióját, külön indítási jelölőnégyzettel. Ugyanaz a flight sheet több munkásra is elküldhető. A stabil profilazonosító miatt újraküldéskor ugyanazt a profilt frissíti. Ha már fut, az agent mentéskor az új beállításokkal újraindítja az érintett minert; másik profilt nem állít le automatikusan. Offline munkásra nincs késleltetett alkalmazás: várd meg a csatlakozását. A sikeres átküldéshez eltároljuk a flight sheet és wallet verzióját. A gépen önálló walletcímes másolat van, így hálózati hiba esetén tovább működhet. A meglévő helyi profilok és walletek nem importálódnak automatikusan a központba.

API: saját farmon `GET /api/farms/ID/library`; `POST .../wallets`, `.../profiles`, `.../delete` (`{kind:"wallets"|"profiles",id}`), `.../apply` (`{profileId,rigId,start:boolean}`). Az indítási mód kifejezett megadása kötelező. Használt wallet nem törölhető. Központi flight sheet törlése nem törli vagy állítja le a gépeken lévő másolatot. Továbbra is a helyi agent végzi az erőforrás- és hővédelmi ellenőrzést.

Az admin külön, kizárólag adminisztrációs felületet kap. A regisztrált felhasználók neve, e-mail-címe, megerősítési állapota, regisztrációs ideje (régi fióknál lehet ismeretlen), farm- és munkásszáma a `/api/admin/users` végponton listázható. Jelszólenyomat, megerősítő token és agentkulcs nem kerül a listába. Normál felhasználó ezt nem érheti el. Admin számára a farm- és worker API is tiltott; a korábbi adminhoz tartozó gépek adatai megmaradnak, automatikus átadás más fióknak nincs.

Ugyanezen végpont POST művelete `{id, action}`, ahol action: `verify`, `unverify`, `suspend`, `restore`, `delete`. Minden módosítás megszünteti az érintett fiók munkameneteit. A felfüggesztés és a megerősítetlen állapot tiltja a belépést; felfüggesztést e-mailes link sem kerülhet meg. Az e-mail-állapot kézi módosítása érvényteleníti a korábbi megerősítő linket. A felület minden műveletet megerősíttet. A regisztráció törlése logikai törlés: eltűnik az aktív listából, a jelszólenyomat és megerősítő token törlődik, belépni nem lehet. A farmok és gépek mentett adatai megmaradnak, a minerekhez nem küldünk leállítást. Azonos e-maillel új regisztráció lehetséges, új fiókazonosítóval; a korábbi farmokat és gépeket nem örökli meg. Ez nem teljes személyesadat-törlési funkció.

A regisztráció nevet, e-mail-címet és 12–256 karakteres jelszót kér. E-mail-cím megerősítése nélkül nincs belépés. A link 24 óráig érvényes és egyszer használható; a levél linkjének megnyitása után a felhasználó gombbal erősít meg, így egy automatikus levélellenőrző nem használja el a linket. Lejárt link újraküldéséhez ismételd meg a regisztrációt azonos címmel; a meglévő fiók jelszavát ez nem írja felül. SMTP nélkül a regisztráció 503 választ ad, nem hoz létre hamisan megerősített fiókot. A régi admin a belépésnél az „Admin belépés” gombot használja, e-mail nélkül, a korábbi jelszóval.

Minden felhasználó saját névvel farmokat hozhat létre. A farmhoz munkásokat adhat: egy munkás egy teljes agent, CPU-val és tetszőleges számú GPU-val. A munkás felvételéhez annak címe és saját API-kulcsa kell. A backend minden olvasásnál és vezérlésnél ellenőrzi a farm tulajdonosát. A migrált gépek az admin „Saját farm” farmjába kerülnek; új regisztráló ezekhez nem kap hozzáférést. A felhasználók és farmok az `accounts.json` fájlban tárolódnak.

## SMTP beállítása később

Helyi tesztlevélhez indítás előtt állítsd `LOCALFORGE_MAIL_MODE=local` értékre a környezeti változót. A Windows `central/start-central.bat` ezt már beállítja. A regisztráció után a megerősítő levél közvetlenül a regisztrációs lap alatt jelenik meg; a link megnyitása után külön gomb erősíti meg a címet. Nincs SMTP-küldés. Legfeljebb 100 helyi levél a védett adatkönyvtár `local-mail.json` fájljában is megmarad. A tesztmód nem igazolja a valódi postafiók birtoklását: csak loopback címen indítható, és csak helyi kapcsolatot fogad. Interneten elérhető rendszerhez kapcsold ki ezt a módot és állíts be SMTP-t.

Python 3 szükséges a szabványos könyvtári SMTP-küldőhöz. Külső Python csomag nem kell. A változókat a központ indítása előtt állítsd be; Ubuntu alatt a telepítő által betöltött `/etc/localforge-central.env` fájlban (root:root 600), Windows alatt a folyamat környezetében. A titkos fájl ne kerüljön a forráskönyvtárba vagy GitHubra.

```text
LOCALFORGE_CENTRAL_URL=https://a-sajat-kozpontod.example
LOCALFORGE_SMTP_HOST=smtp.a-sajat-szolgaltatod.example
LOCALFORGE_SMTP_PORT=587
LOCALFORGE_SMTP_MODE=starttls
LOCALFORGE_SMTP_FROM=LocalForge <miner@a-sajat-domained.example>
LOCALFORGE_SMTP_USER=SMTP_FELHASZNALO
LOCALFORGE_SMTP_PASSWORD=SMTP_JELSZO
```

465-ös implicit TLS-hez `LOCALFORGE_SMTP_MODE=tls` és `LOCALFORGE_SMTP_PORT=465`. Mindkét mód hitelesített TLS-kapcsolatot használ, sima titkosítatlan SMTP nincs. `LOCALFORGE_PYTHON` megadhatja a Python futtatható fájl abszolút útvonalát; Windows alatt különösen hasznos, ha nincs `python` a PATH-ban. Helyi teszthez a központ URL-je `http://127.0.0.1:8090` lehet, de a levél linkje csak ugyanazon a számítógépen nyitható meg. Változtatás után indítsd újra a központot. A tényleges levélkézbesítést saját SMTP-adatokkal külön ellenőrizni kell.
