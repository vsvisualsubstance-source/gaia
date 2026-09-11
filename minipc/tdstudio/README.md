# GAIA TD-Studio Agent (macOS)

Agent per un Mac mini che gira principalmente TouchDesigner (TD) con
Herbarium, più altri due progetti TD (`project2`/`project3`) usati uno
alla volta. Stessa interfaccia MQTT/Pi-Manager di `pi/agent` e
`ops/agent` — `role: "tdstudio"` nel profilo del device.

Porting macOS di `ops/agent/agent.py` (Windows): gestisce processi via
`subprocess.Popen` invece di systemd/launchd nativi per i servizi
applicativi, lock singleton via `fcntl` (POSIX) invece di `msvcrt`,
ricerca processi orfani via `pgrep -f` invece di PowerShell/CIM. In più
rispetto a `ops/agent.py` ha la cascata di discovery completa (cache →
broadcast UDP → mDNS → Tailscale) di `pi/agent.py`, utile se questa
macchina non è sempre sulla LAN di Core.

## Mutua esclusione TD (`conflicts` in services.json)

I tre `.toe` (`herbarium`/`project2`/`project3`) sono dichiarati in
conflitto reciproco in `services.json` — avviarne uno ferma
automaticamente gli altri prima di partire (stesso ruolo del
`Conflicts=` di systemd usato per `kiosk`/`screen` sul Pi, qui esplicito
in `_stop_conflicts()` perché non gestiamo unit systemd/launchd per
questi processi).

## Prima del deploy — cose da NON dare per scontate

`services.json` ha path placeholder (`CONFIGURA`). **Verificare dal
vivo su questa macchina specifica** prima di abilitare un servizio:

1. Path reale di `TouchDesigner.app` (dipende dalla versione
   installata — di norma `/Applications/TouchDesigner.app/Contents/MacOS/TouchDesigner`).
2. Path assoluto reale di ogni `.toe`.

Finché questi non sono corretti, l'agent risponde "File non trovato" e
non avvia nulla — comportamento sicuro by design (stesso principio già
seguito per MadMapper/Palazzo Ducale: non costruire contro un'API/percorso
mai verificato dal vivo).

## Setup

1. Su questa macchina: **Impostazioni di Sistema → Condivisione →
   Accesso remoto** (SSH) attivo, per poter fare deploy/debug da remoto.
2. Copiare questa cartella sulla macchina (es. `scp -r` o `rsync` via
   Tailscale).
3. `bash install.sh` — crea il venv, installa `paho-mqtt`, copia il
   LaunchAgent in `~/Library/LaunchAgents/` (sostituendo il placeholder
   `__SCRIPT_DIR__` col path reale).
4. Modificare `services.json`: `device_id`/`stanza` in cima, e i tre
   path `CONFIGURA` per TD/`.toe` (vedi sopra).
5. Caricare il LaunchAgent:
   ```
   launchctl load -w ~/Library/LaunchAgents/com.gaia.tdstudio.agent.plist
   ```
   Parte subito e ad ogni login (LaunchAgent, non LaunchDaemon — deve
   girare nella sessione GUI per poter mostrare TD su schermo, stesso
   motivo per cui OPS usa Task Scheduler "AtLogOn" invece di un servizio
   di sistema).
6. Log: `tail -f agent.log` (nella cartella dell'agent).
7. Per fermare: `launchctl unload ~/Library/LaunchAgents/com.gaia.tdstudio.agent.plist`.

## Raggiungibilità da remoto (Tailscale)

Il LaunchAgent imposta già `GAIA_CORE_TAILSCALE_HOST=100.94.220.65` —
**non opzionale su questo Mac**: verificato dal vivo 2026-09-11 che non
ha una rotta diretta verso `192.168.1.0/24` (connessione MQTT sulla LAN
va in timeout), quindi la discovery arriva sempre fino al tier
Tailscale. Su una macchina che invece È sulla LAN di casa questo tier
resterebbe comunque a costo zero se cache/broadcast/mDNS bastano da
soli. Vedi `docs/discovery-protocol.md`.

## Spegnimento/riavvio remoto

Comandi MQTT `reboot`/`shutdown` (`gaia/device/{id}/command`) → AppleScript
via `osascript`/System Events (`restart`/`shut down`), non `sudo shutdown`:
nessuna modifica ai permessi di sistema richiesta (una regola sudoers
NOPASSWD è stata valutata e scartata il 2026-09-11 — bloccata dai
controlli di sicurezza dell'ambiente di sviluppo usato per costruire
questo agent, e comunque più delicata da mantenere). Limite noto: se
altre app hanno documenti non salvati può comparire un dialogo di
conferma invece di spegnere subito.

## Watchdog

Ogni `WATCHDOG_INTERVAL` (30s) l'agent controlla ogni servizio con
`enabled: true` in config — se non risulta attivo lo riavvia da solo
(`_restart_service`), **sempre**, mai un reboot automatico della macchina
(stesso principio della touring machine di Palazzo Ducale,
`minipc/installation/`). Dopo `WATCHDOG_ALERT_AFTER` (3) tentativi falliti
consecutivi manda un avviso su `gaia/notify/telegram` (stesso pattern di
`TDDeviceRegistry._notify()` in `minipc/touchdesigner/osc_bridge.py`) e
continua comunque a ritentare — utile se il `.toe` configurato è sbagliato
o TD non riesce proprio a partire, così non resta silenzioso all'infinito.
