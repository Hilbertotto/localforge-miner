# LocalForge Agent API v1

A bányászgép most **agentként** működhet: a helyi webfelület és a központi kezelő ugyanazt a vezérlést használja. Ez a változtatás az agent API-ját készíti el; a több gépet összefogó központi szerver még nincs megvalósítva.

## Elérés és jogosultság

Alapútvonal: `/api/v1/`. Minden végponthoz kötelező:

```http
Authorization: Bearer <gépenkénti-api-token>
Content-Type: application/json
```

Az API a meglévő szolgáltatás része, új szolgáltatást nem igényel. A Node.js továbbra is csak `127.0.0.1:8080` címen figyel. A változtatás nem nyit hálózati portot és nem telepít Apache-ot. Másik gépről HTTPS-es reverse proxyval vagy VPN/SSH-alagúton keresztül érhető el. Internetre titkosítatlan HTTP-vel ne kerüljön ki.

Jogosultságok:

| Scope | Engedély |
| --- | --- |
| `read` | Gépazonosító, képességek, állapot, profilok, walletek, watchdog és naplók olvasása |
| `control` | A fenti olvasás és a profilok, walletek, watchdog, NVIDIA OC/ventilátor vezérlése |
| `power` | Teljes gép kikapcsolása vagy újraindítása; önmagában nem enged olvasást vagy más vezérlést |

Minden bányászgép külön kulcsot kapjon. A központi szerver tárolja ezeket titoktárban; a böngészőnek csak a központi szerver munkamenete kelljen. A token nem kerülhet URL-be, kliensoldali JavaScriptbe vagy verziókezelőbe.

## Kulcs létrehozása az Ubuntun

Az új verzió `install-web.bat` telepítése után, SSH-n:

```bash
# Csak megfigyelés:
sudo -u localforge /usr/bin/node /opt/localforge/scripts/api-key.mjs create central-monitor read

# Teljes vezérlés, a gép újraindítását is beleértve:
sudo -u localforge /usr/bin/node /opt/localforge/scripts/api-key.mjs create central-control read,control,power

# Kulcsok listája: csak metaadatok, token és hash nélkül.
sudo -u localforge /usr/bin/node /opt/localforge/scripts/api-key.mjs list

# Visszavonás: a következő API-kéréstől hatályos, szolgáltatásrestart nélkül.
sudo -u localforge /usr/bin/node /opt/localforge/scripts/api-key.mjs revoke KULCS_ID
```

A létrehozás egyszer írja ki a teljes tokent. A bányászgép lemezén csak SHA-256 lenyomat marad, 600 jogosultságú fájlban. Nincs publikus kulcslétrehozó végpont. Egyedi kulcsokkal a központi vezérlés hozzáférése külön visszavonható.

Helyi fejlesztésnél a `LOCALFORGE_DATA_DIR` környezeti változó adja meg a CLI adatkönyvtárát. Ubuntu telepítéskor a szokásos `/opt/localforge/data` hivatkozást használja.

## Végpontok

Az útvonalak mind az `/api/v1/` után értendők. A history végpont `range=1h` vagy `range=1d` query-paramétert fogad; a többi végponton nincs query-paraméteres szűrés vagy lapozás.

| Metódus | Útvonal | Tartalom / kérés |
| --- | --- | --- |
| GET | `node` | Tartós UUID, hostname, API- és agent-verzió |
| GET | `capabilities` | Minerek, algoritmusok, támogatott funkciók, kulcs scope-jai |
| GET | `history?range=1h` / `history?range=1d` | Utolsó 1 óra 5 másodperces mintái, illetve utolsó 24 óra perces átlagai; tartós szerveroldali előzmény |
| GET | `status` | Teljes állapot: hardver, hashrate, hőfok, fogyasztás, profilok, jobok, watchdog, autostart |
| GET | `profiles` | Profilok pooljelszó nélkül; `passwordConfigured` jelzi a meglétét |
| GET | `wallets` | Walletcímek és poolfiókok, nem privát kulcsok |
| GET | `watchdog` | Hővédelmi beállítások és aktuális állapot |
| GET | `logs` | Jobok és az agent által már maszkolt miner-naplók |
| POST | `profiles` | Teljes profil létrehozása vagy cseréje, azonos `id` alapján |
| POST | `delete` | Profil törlése: `{"id":"..."}` |
| POST | `start` | Profil indítása: `{"id":"..."}` |
| POST | `stop` | Profil leállítása és autostart törlése: `{"id":"..."}` |
| POST | `wallets` | Wallet létrehozása vagy cseréje |
| POST | `wallets/delete` | Wallet törlése: `{"id":"..."}`; használt wallet nem törölhető |
| POST | `import-profile` | HiveOS-jellegű JSON import előnézete; nem indít minert |
| POST | `watchdog` | Teljes watchdog-konfiguráció; reboot action esetén `power` scope is kell |
| POST | `watchdog/rearm` | Hővédelmi tiltás kézi feloldása: `{}` |
| POST | `oc` | `uuid`, `action`, szükség esetén `value` |
| POST | `system-power` | `{"action":"poweroff"}`, `reboot` vagy `reboot-delay`; `power` scope kell |

Az OC action lehet `power`, `core`, `memory`, `reset`, `fan`, `fan-auto`. Power wattban, core/memory abszolút MHz-ben értendő, nem offset. Kézi ventilátor: 30–100%. A driver/hardver határértékeit a root helper is ellenőrzi. A `reset` és `fan-auto` nem kér értéket.

Új profilnál a pooljelszó `password` mezője kötelező, akkor is, ha az értéke csak `x`. Meglévő profil cseréjénél a mező kihagyható, ekkor az előző érték megmarad. A v1 olvasási végpontok nem adják vissza a pooljelszót. A walletcím és poolfiók viszont az állapot része, ezért az olvasási kulcs is bizalmas.

Futó profil is módosítható: azonos id és `saveMode: "update"` esetén a mentés csak az érintett minert indítja újra az új beállításokkal. `saveMode: "copy"` és `sourceId` esetén a szerver új UUID-val menti a másolatot, és nem indítja el. A másolatnak külön név kell; névütközés 409. A leállított profil mentése nem indít minert. Ha az alkalmazás nem sikerül, a szerver megpróbálja visszaállítani a régi profilt, a hővédelem figyelembevételével. A CPU-szálszám, algoritmus, pool, wallet, worker, TLS, GPU-kiosztás mind profilparaméter. A CPU BIOS/UEFI tuning és az AMD OC jelenleg nincs implementálva; a `capabilities` ezt jelzi. A hashrate és fogyasztás mért adat, nem írható paraméter.

## Példák

A példákban a `LOCALFORGE_TOKEN` az előzőleg biztonságosan beolvasott token, a localhost pedig helyi elérés vagy SSH-alagút. HTTPS proxy esetén a címet cseréld annak címére.

```bash
curl --fail-with-body -H "Authorization: Bearer $LOCALFORGE_TOKEN" \
  http://127.0.0.1:8080/api/v1/node

curl --fail-with-body -H "Authorization: Bearer $LOCALFORGE_TOKEN" \
  http://127.0.0.1:8080/api/v1/status

curl --fail-with-body -X POST \
  -H "Authorization: Bearer $LOCALFORGE_TOKEN" -H 'Content-Type: application/json' \
  -d '{"id":"MENTETT_PROFIL_ID"}' \
  http://127.0.0.1:8080/api/v1/start
```

CPU-profil JSON példa (a szálak száma legfeljebb az adott gép logikai CPU-száma):

```json
{
  "id": "cpu-randomx",
  "name": "CPU RandomX",
  "engine": "xmrig",
  "algorithm": "rx/0",
  "pool": "POOL_HOST:443",
  "wallet": "SAJAT_WALLET_VAGY_POOLFIOK",
  "password": "x",
  "worker": "rig-01",
  "tls": true,
  "threads": 12,
  "devices": ""
}
```

## Válaszok és újrapróbálás

JSON-válaszok; hibánál `{"error":"..."}`. 401: nincs érvényes Bearer-kulcs, 403: nincs scope, 404: ismeretlen végpont, 405: nem támogatott metódus, 409: művelet vagy leállás folyamatban, 413: 32 KiB feletti kérés, 400: hibás paraméter vagy a végrehajtás visszautasítása.

Egyidejű állapotlekérések engedélyezettek, de gépenként egyszerre egy vezérlési művelet történhet. 409 után az állapotot újra le kell kérni. Indítás, reboot és import nem rendelkezik parancsazonosítós deduplikációval: időtúllépéskor ne küldd vakon újra, először ellenőrizd az állapotot. A 30 másodperc a reboot kezdetéig tart, a boot ideje ezen felül értendő.

A `status.sampledAt` Unix idő ezredmásodpercben. A hiányzó mérés `null`/`available:false`, nem nulla. A GPU miner ritkábban frissülő jelentéseit az agent kezeli; különböző algoritmusok hashrátáját a központi szerver se összegezze egyetlen H/s értékké.

Az engedélyezett POST-kérések eredménye `api-audit.jsonl` fájlba kerül: időpont, kulcsazonosító, végpont, HTTP-státusz. A törzs és a token nem kerül bele. 5 MiB után egy előző napló marad meg. Ez helyi, működési napló, nem sérthetetlen biztonsági naplótár.

## Kapcsolódás a későbbi központi szerverhez

1. A központi szerver adatbázisa gépenként tárolja a tartós `node.id` értéket, megjelenítési nevet, elérési címet és a titoktárban lévő kulcs hivatkozását.
2. `node` és `capabilities` lekérdezéssel azonosítja a gépet és a használható funkciókat.
3. Például 10 másodpercenként `status` kérést küld; az utolsó sikeres válasz idejéből mutat online/offline állapotot. Az előzményeket saját idősoros adatbázisban tárolja.
4. A kezelőből kiadott művelet az érintett gép API-jára kerül, gépenként követett eredménnyel. Több gépes művelet nem atomi: minden gép külön sikerülhet vagy hibázhat.
5. A helyi watchdog és a futó profilok visszaindítása a központi szerver kiesésekor is működik.

Első körben VPN-en át elérhető agentekkel lehet dolgozni. NAT mögötti, VPN nélküli gépekhez később az agent által kifelé nyitott HTTPS kapcsolat, parancssor és visszaigazolás kell. Ez az API-változat még nem tartalmaz automatikus regisztrációt, heartbeat-küldést vagy parancssort.

Gépklónozáskor a `node-identity.json` és az `api-keys.json` fájlokat ne másold át a másik rigre: annak külön gépazonosító és kulcs kell.

Apache telepítésénél a helyi webfelület régi `/api/session` és `/api/*` útvonalait is védeni kell bejelentkezéssel. A Bearer-védelem az új `/api/v1/` útvonalra vonatkozik; önmagában nem teszi publikussá tehetővé a régi helyi UI-t. A proxy a backend Host fejlécét `127.0.0.1:8080` értékre állítsa, és őrizze meg az Authorization fejlécet.

Géppel feldolgozható végpontleírás: `openapi.json`.


## Tartós mérési előzmények

A `/api/v1/history?range=1h` és `range=1d` olvasási scope-pal érhető el. A válasz `start`, `end` és a rekordok `at` mezői Unix ezredmásodpercek; `stepMs` 5000 vagy 60000. Rekordok: `cpuHash`, `gpuHash` (H/s), `cpuPower`, `gpuPower` (W), `cpuKey`, `gpuKey`; az egyórás nézetben `temperatures` GPU UUID → °C szótár is van. A napi nézet perces átlagait az utolsó tényleges minta ideje jelöli. Nullát tartalmazó vagy különböző algoritmusokat keverő átlag nem készül, helyette null szerepel.

A mintavétel 5 másodpercenként a szolgáltatásban fut, böngésző nélkül is. Az utolsó 24 órát UTC napok szerinti JSONL fájlok őrzik; legfeljebb a mai és az előző napi fájl marad meg. Újraindítás után a meglévő minták betöltődnek. Kimaradáskor nincs becslés vagy visszatöltött kitalált adat. A lemezre mentés esetleges hibáját az `error` mező jelzi. Ez nem hosszú távú adatbázis: a központi szerver tartósabb statisztikáit külön kell tárolni.


A profilmentési válasz `id`, `mode`, `applied`, `running`, `message` mezőket tartalmaz. Futó profil módosítása előtt az eszközütközést és a hővédelmet ellenőrzi; a leállítás után ismét ellenőrzi a hőfokot. A másolathoz a `password` kihagyható, ilyenkor a forrásprofil értékét használja. A webfelület névváltoztatáskor automatikusan másolatmentést választ; az API explicit update módban helyben át is nevezhet profilt. Sikertelen visszaindításkor a hibaválasz jelzi, hogy a régi konfiguráció visszaállítása és futtatása sikerült-e. A futó profil alkalmazása nem a miner folyamatának megszakítás nélküli átkonfigurálása: az érintett miner röviden újraindul.
