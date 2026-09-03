# Ruolo macchina "installation" — kit per venue touring

Terzo ruolo macchina del progetto, dopo `ops`/`pi` (fissi, macchine di
casa): `installation` è per macchine Windows temporanee, non presidiate,
portate fuori casa per un'installazione (video-mapping, mostre, eventi).
Nato 2026-09 per Palazzo Ducale (Genova, 1 mese) ma pensato riusabile per
venue future — a differenza di [`demo-portatile.md`](demo-portatile.md)
(Core/OPS/Pi in trasferta insieme, rete propria) qui è **una singola
macchina Windows sola** che si connette al Core di casa via Tailscale, con
requisiti diversi: non presidiata per settimane, deve riavviare da sola
ciò che cade, deve poter essere spenta/riaccesa da remoto.

Codice in `minipc/installation/` (kit generico riusabile) +
`minipc/madmapper/` (bridge OSC↔MQTT specifico della family MadMapper,
vedi il suo [README](../minipc/madmapper/README.md) — modulo separato
apposta, stesso principio di [`minipc/touchdesigner/`](../minipc/touchdesigner/README.md):
un modulo per family, non tutto ammucchiato nel kit macchina generico).

## Perché non riusare `ops/agent/agent.py` così com'è

`minipc/installation/agent.py` parte da una copia di `ops/agent/agent.py`
(unico agent Windows già production-proven: gestione subprocess,
adozione processi orfani, Device Registry, Task Scheduler "AtLogOn" +
`.vbs` per evitare che chiudere la finestra console termini l'intero
albero) più tre aggiunte reali che OPS (sempre in LAN di casa, sempre
presidiata) non aveva bisogno di avere:

1. **Watchdog vero** (`_watchdog_loop`, ogni `WATCHDOG_INTERVAL`=30s):
   per ogni servizio `enabled` in configurazione, se non è in esecuzione
   lo riavvia da solo, ritenta a oltranza. Dopo `WATCHDOG_ALERT_AFTER`=5
   fallimenti CONSECUTIVI dello stesso servizio, un alert via
   `_notify_telegram()` (`gaia/notify/telegram`) — poi continua comunque
   a ritentare. **Mai un reboot automatico dell'intera macchina** (deciso
   esplicitamente: troppo rischioso da remoto per un mese, rischio di
   loop su un problema strutturale che un reboot non risolverebbe).
2. **`reboot`/`shutdown` reali via MQTT** — `ops/agent.py` li rifiuta
   esplicitamente ("non è un Pi headless: ignorato"). Qui sono abilitati
   sul serio (`shutdown.exe` di Windows) come rete di sicurezza software
   sopra allo scheduling BIOS/Task Scheduler (power on/off pensato
   **solo** BIOS RTC wake + Task Scheduler, niente hardware extra tipo
   prese smart).
3. **`discovery.py`** (portato da `pi/agent/discovery.py`, cascata a 4
   livelli: cache su file → beacon UDP → mDNS → Tailscale) chiamata
   PRIMA della connessione MQTT (`discovery.discover(cached_host=...)`).
   Gap reale trovato verificando esplicitamente prima di scrivere
   codice: `ops/agent.py` si auto-riporta su Tailscale nel proprio status
   ma non lo usa MAI per RAGGIUNGERE il broker — `MQTT_HOST` è una
   costante LAN fissa, va bene su OPS (sempre in LAN di casa), non va
   bene per una macchina su una rete completamente diversa. Il tier
   Tailscale si attiva solo se `GAIA_CORE_TAILSCALE_HOST` è impostato
   (vedi `run_agent.bat`), altrimenti `None` immediato — innocuo per gli
   altri due ruoli macchina.

**OTA**: nessuna modifica necessaria. `_ota_update()` (ereditato da
`ops/agent.py`) è già generico per-servizio (download → verifica MD5 →
replace atomico → restart) — qualunque servizio elencato in
`services.json` lo eredita gratis, `madmapper`/`madmapper_bridge`
inclusi. Come su Pi/OPS, l'agent stesso non si auto-aggiorna via OTA
(resta un redeploy manuale) — coerente con l'architettura esistente, non
un gap specifico di questo ruolo.

## `services.json` — data-driven, nessun codice nuovo per aggiungere un servizio

Stesso schema di `ops/agent/services.json` (`machine_role`, `device_id`,
`services{cmd,cwd,env_extra,check_script}`). Il file attuale contiene
`madmapper` (lancio `MadMapper.exe`) e `madmapper_bridge` (lancio del
bridge Python) — entrambi coperti dal watchdog del punto 1 senza altro
codice.

**Placeholder espliciti, da confermare online (AnyDesk), mai inventati:**

- `device_id` (`installation-CHANGEME`) e `stanza` — hostname reale letto
  quando la macchina è online.
- ~~Path/argomenti reali di `MadMapper.exe`~~ **RISOLTO 2026-09-03**:
  `C:\Program Files\MadMapper 6.1.5\MadMapper.exe`. Auto-caricamento
  progetto CONFERMATO possibile passando il file come secondo argomento
  — ma attenzione, `.madproject` è una **cartella pacchetto**
  (Backup/FX/Info/Media/Modules/Scratch + più file `.mad` dentro, non
  un file singolo): passare la cartella riparte a vuoto, serve il path
  del file `.mad` specifico dentro (per questa installazione:
  `...\npoe26.madproject\npoe26-1.mad`). Verificato dal vivo:
  kill+riavvio del watchdog ricarica il progetto vero (memoria di
  processo ~1.9-2GB, non ~1.1GB come con avvio vuoto).
- Porte OSC reali (`MADMAPPER_OSC_OUT_PORT`/`IN_PORT`) — vedi
  [`minipc/madmapper/README.md`](../minipc/madmapper/README.md).
- `GAIA_CORE_TAILSCALE_HOST` in `run_agent.bat` — IP noto da lavoro
  Tailscale precedente, da riverificare con `tailscale status` su Core al
  momento del deploy (può essere cambiato).
- Verifica pratica del wake da BIOS (dipende dalla scheda madre
  specifica, non ipotizzabile da remoto).

## Telegram

Dispatcher in `node-red/flows.json` (nodo "Gestisci messaggi Telegram").
`/stato`/`/servizi` elencano già qualunque servizio di qualunque device
via `profile.services` — zero lavoro. Il toggle (`/attiva`/`/disattiva`)
ha invece un `Set` `TOGGLEABLE` hardcoded: `madmapper` ci è stato
aggiunto insieme agli altri servizi toggleabili.

## Deploy e verifica end-to-end (una volta online)

1. Deploy dei file (`minipc/installation/`, `minipc/madmapper/`) sulla
   macchina, dipendenze installate direttamente nel Python di sistema
   (`pip install -r requirements.txt` in entrambe le cartelle) — **niente
   venv**: verificato dal vivo 2026-09-01 che con un interprete copiato in
   un venv, Windows Defender (real-time protection) rilanciava una
   seconda copia di ogni processo tramite l'installazione Python "reale",
   duplicando agent.py e il bridge con lo stesso `device_id` in conflitto
   su MQTT. Vedi `_nota` in `minipc/installation/services.json`.
2. Avvio agent, verifica che compaia in `GET /gaia/devices/profiles` con
   `role: "installation"`.
3. **VERIFICATO DAL VIVO 2026-09-03** (sulla macchina in uso reale a
   Palazzo Ducale): kill manuale di `MadMapper.exe` → il watchdog lo
   rilancia entro il giro successivo (30-60s) senza intervento, **e
   ricarica il progetto giusto** (vedi nota sul path `.mad` sopra).
4. Kill del bridge stesso → riavviato dallo stesso watchdog (è un
   servizio come un altro).
5. Blackout da `web/madmapper.html` → conferma visiva sull'output video.
6. `/servizi`, `/attiva madmapper`, `/disattiva madmapper` da Telegram.
7. Spegnimento schedulato via Task Scheduler + wake reale da BIOS
   (verifica pratica, non ipotizzabile da remoto).
8. Reboot/shutdown via MQTT come rete di sicurezza software.

Collegamenti: [`architettura.md`](architettura.md) (protocollo comune
Pi/OPS/Core/TouchDesigner, esteso qui a un quarto ruolo), memoria di
progetto `project-installation-ducale` (stato del deploy specifico di
Palazzo Ducale — date, cosa è stato verificato dal vivo su QUESTA
macchina; questo file resta il riferimento tecnico del ruolo/kit in sé).
