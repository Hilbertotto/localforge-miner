# LocalForge v0.4.1

Stabil hibajavító kiadás Ubuntu minerekhez és a helyi központhoz.

- Wallet és profil hozzáadása helyi IP-címes HTTP-elérésnél is működik: biztonságos véletlen azonosító készül akkor is, ha a böngészőben a crypto.randomUUID nem érhető el.
- A telepített SRBMiner 3.7.9 mind a 66 algoritmusa szerepel a katalógusban. A 34 GPU-algoritmus választható hardverjelöléssel; a 32 CPU-only algoritmus külön, letiltott csoportban látszik, mert az SRBMiner-adapter jelenleg GPU-módú.
- Új, kompakt terminálstílusú minerfelület, monospace betűk, cián/magenta grafikonok, alsó F1–F6 navigáció és egységes modálok.
- Az Ubuntu telepítő Apache-jelszófájljának könyvtárjogosultsága javítva. A már telepített gépek frissítése is javítja az ismert /etc/localforge/web.htpasswd elérést, miközben a szöveges webes jelszó root-only marad.
- Windows ISO-kiíró: javított UInt32 hozzáférési jelző, kötetazonosítós megnyitás, írásvédelem-ellenőrzés és meghajtóbetű nélküli USB SSD támogatás.

A programfrissítés mentést készít, röviden újraindítja a miner szolgáltatást, és visszaindítja a korábban futó profilokat. Drivert nem frissít. A hashrate-kijelzés korábban megfigyelt SRBMiner-kimeneti pufferelése ebben a kiadásban még nincs javítva; a mérési frissesség ellenőrzése megmarad.

A telepítő ISO az első SSD-s induláskor a legújabb stabil GitHub Release-csomagot tölti le. A régi ISO-ba beépített elsőindítási Apache-beállítás továbbra is kézi javítást igényelhet az első webes belépéshez; a programfrissítés a már meglévő jelszófájl jogosultságait helyreállítja.