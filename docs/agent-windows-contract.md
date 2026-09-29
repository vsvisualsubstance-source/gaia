# Contratto agent Windows (GAIA)

Stato: 2026-09-29. Risponde alla domanda "abbiamo una versione finale, un
contratto per farle tutte uguali, sono tutte uguali?" — prima di oggi la
risposta onesta era NO (due file divergenti, funzionalità diverse su OPS
vs installazioni touring). Da oggi: **sì, stesso `agent.py` ovunque**,
differenze solo in `services.json`.

## Il principio

Una sola implementazione di riferimento (`ops/agent/agent.py`), duplicata
byte-per-byte (a parte 8 etichette cosmetiche: nome macchina nei print,
`client_id` MQTT, i default di `MACHINE_ROLE`/`device_id`) in ogni
cartella-macchina del repo:

- `ops/agent/agent.py` — ops-silvermini2 (presidiata, casa)
- `minipc/installation/agent.py` — installazioni touring (non presidiate,
  fuori casa: Palazzo Ducale oggi, silver-filoq/nuove installazioni domani)

Il repo duplica invece di importare cross-directory (stesso principio già
in uso per `net_resolve.py`: ogni cartella di deploy è autosufficiente,
copiabile su una macchina con `scp`/clone senza portarsi dietro il resto
del repo). **Quando cambi la logica in uno dei due file, propaga la stessa
modifica anche all'altro** — è l'unico modo in cui la duplicazione resta
un contratto e non due codebase alla deriva (come lo erano fino ad oggi:
vedi "Cosa è cambiato oggi" in fondo).

Il comportamento per-macchina non nasce da `if machine_role == ...` nel
codice, ma da **campi in `services.json`**:

| Campo manifest | Significato | ops-silvermini2 | installazioni touring |
|---|---|---|---|
| `machine_role` | valore del campo `role` pubblicato su MQTT | `"ops"` | `"installation"` |
| `watchdog` | riavvio automatico dei servizi `enabled` caduti | `false` | `true` |
| `services.*.conflicts` | mutua esclusione tra servizi (es. webcam) | usato (camera/TD) | non presente |
| `camera_consumers` | ref-count per accendere/spegnere la webcam | usato | non presente |

Se un campo è assente o vuoto, la relativa funzione (`_sync_camera`,
`_watchdog_loop`, ecc.) è semplicemente un no-op — il codice pieno è
sempre lì, pronto se un domani un'installazione avesse anche lei una
webcam o dei servizi in conflitto, senza dover riscrivere nulla.

## Capacità garantite su OGNI macchina Windows (il contratto vero e proprio)

1. **Accensione/spegnimento da remoto**
   - `{"action":"reboot"}` / `{"action":"shutdown"}` su
     `gaia/device/{id}/command` — sempre onorati (non più rifiutati su
     OPS come prima del 2026-09-29).
   - `{"action":"set_config","shutdown_at":"HH:MM"|null}` — spegnimento
     programmato, controllato dal loop watchdog/heartbeat, niente Task
     Scheduler fisso da riconfigurare via SSH per cambiare orario.
   - Accensione fisica: BIOS RTC wake (da configurare a mano per ogni
     macchina, non pilotabile da software) + Wake-on-LAN dove la scheda
     di rete lo supporta.
   - UI: Pi Manager (`web/admin.html`) mostra i pulsanti Reboot/Spegni e
     il campo "spegnimento programmato" per ogni device con
     `role` in `ops`/`installation`/`pi`.

2. **SSH sempre attivo** — OpenSSH Server installato/abilitato via
   `setup_windows.ps1` (sezione 1), porta 22 aperta sul firewall Windows,
   chiave pubblica di Core in `administrators_authorized_keys` (accesso
   senza password, stessa chiave usata per Pi/OPS). Login utente/password
   resta disponibile come fallback.

3. **MQTT robusto**
   - Discovery a cascata prima del primo connect (`discovery.py`: cache →
     broadcast UDP → mDNS → Tailscale) — non solo per le macchine fuori
     LAN: anche OPS ora si riprende da sola se l'IP LAN di Core cambiasse
     (visto dal vivo il 2026-09-29, incidente rete demo).
   - Ri-discovery automatica se disconnesso da MQTT per più di
     `RECOVERY_THRESHOLD` (90s) — senza, un `agent.py` che si è agganciato
     a un host diventato irraggiungibile ci resta appeso per sempre (bug
     reale trovato due volte dal vivo prima di oggi).
   - `reconnect_delay_set(2, 30)` — reconnect automatico di paho-mqtt dopo
     un riavvio del broker, non solo alla prima connessione.

4. **Lancio/gestione servizi (TD o altro)** — `services.json` data-driven:
   `cmd`/`cwd`/`env_extra` per processo, `enable`/`disable`/`restart` via
   MQTT, adozione di processi orfani (avviati fuori da questa istanza
   dell'agent — riavvii, TD lanciato a mano) tramite `_find_os_pid` +
   verifica economica via `psutil` sui giri successivi (vedi sotto,
   "Bug dello sfarfallio").

5. **Tailscale** — ogni macchina in tailnet (`tailscale up` manuale, non
   scriptabile in modo affidabile: richiede consenso browser al primo
   join). L'agent pubblica il proprio IP Tailscale
   (`net_resolve.local_tailscale_ip()`) nello status, usato come ultimo
   tier di discovery dalle altre macchine.

6. **OTA per gli script dei servizi** — `{"action":"ota_update","service":
   "<key>","url":...,"md5":...}`: scarica, verifica MD5, sostituisce
   atomicamente il file nel `cwd` del servizio, riavvia. Generico,
   funziona su qualunque entry di `services.json` senza codice dedicato.
   **Non è self-update dell'agent stesso** — `agent.py` va ridistribuito
   a mano (scp/redeploy), per design: un self-update che si rompe
   lascerebbe la macchina senza controllo remoto per ripararlo.

7. **Log con rotazione** — `agent.log` non cresce più indefinitamente
   (era arrivato a 483MB su OPS, mai ruotato). `_RotatingConsole` in
   `agent.py` sostituisce `sys.stdout`/`stderr`, rotazione a 20MB, 5
   backup (`agent.log.1` … `.5`). `run_agent.bat` non fa più da solo il
   redirect su file (rischio di handle bloccato in rotazione su Windows,
   vedi sotto) — redirige su `NUL` solo come rete di sicurezza.

## Il bug dello sfarfallio delle finestre cmd (risolto 2026-09-29)

Sintomo riportato dall'utente su OPS: finestre nere che compaiono e
spariscono molto rapidamente, "sembra il watchdog". Causa reale, trovata
con un osservatore di processi WMI dal vivo: `_is_running()` rilanciava
un `powershell.exe` (+ `conhost.exe` visibile) per ogni servizio non
tracciato direttamente dal `Popen` di questa istanza dell'agent (TD
Herbarium/Yolo/DMX, kiosk — tutti "orfani" per definizione, lanciati come
.exe diretto), quasi ad ogni heartbeat: la cache degli orfani
(`_ORPHAN_CHECK_TTL`) scadeva PRIMA del prossimo heartbeat (30s), quindi
la scansione ripartiva in continuazione.

Fix: una volta trovato un PID orfano, i giri successivi lo verificano con
`psutil.Process(pid).cmdline()` (chiamata nativa in-process, zero
sottoprocessi) invece di rilanciare la scansione PowerShell completa;
`_ORPHAN_CHECK_TTL` alzato sopra l'heartbeat (45s) così anche i servizi
davvero spenti non vengono ripescansionati ad ogni giro.

**Nota sul "processo duplicato" (venv):** sia questa indagine sia una
precedente (2026-09-02, vedi `project-architettura-core-ops`) sia
l'installazione touring (`services.json`, nota storica) hanno in passato
scambiato per un bug il normale comportamento del launcher-stub di un
venv Windows (`Scripts\pythonw.exe` rilancia l'interprete base come
processo FIGLIO, sempre — è così che funziona `venv` su Windows, non un
sintomo di Defender). Verificato dal vivo il 2026-09-29 su OPS via
`netstat`/`Get-NetTCPConnection`: **una sola connessione MQTT reale**,
nessun ping-pong. Prima di eliminare un venv altrove per questo motivo
(costoso se ci sono dipendenze ML pesanti pinnate), riverificare con
`netstat -ano | findstr :1883` invece di assumerlo.

## services.json — schema di riferimento

```jsonc
{
  "machine_role": "ops" | "installation",
  "watchdog": true | false,
  "device_id": "ops-<hostname>" | "installation-<hostname>",
  "stanza": "<nome stanza/venue>",
  "camera_consumers": ["yolo", "mediapipe", "kiosk"],   // opzionale
  "services": {
    "<key>": {
      "cmd": ["C:\\path\\eseguibile.exe", "argomenti", "..."],
      "cwd": "C:\\path\\di\\lavoro",
      "check_script": true,           // false per un .exe diretto (TD, MadMapper, Edge)
      "conflicts": ["altra_key"],     // opzionale, mutua esclusione
      "type": "http_check",           // opzionale, per servizi gestiti esternamente (Ollama)
      "check_url": "http://...",      // richiesto se type=http_check
      "env_extra": {"VAR": "valore"}
    }
  }
}
```

## Deploy di una nuova macchina Windows (checklist)

1. Copia la cartella agent giusta (`ops/agent/` per una macchina
   presidiata tipo-OPS, `minipc/installation/` per una touring) in
   `C:\gaia\...` sulla macchina nuova.
2. Scrivi `services.json` per QUESTA macchina (device_id, stanza, path
   reali dei .exe — mai copiare i path da un'altra macchina alla cieca).
3. `pip install -r requirements.txt` — venv solo se la macchina ha
   bisogno di dipendenze ML pesanti (torch/mediapipe/whisper, come OPS);
   altrimenti Python di sistema, più semplice (come le installazioni
   touring). Il "processo duplicato" del venv è innocuo (vedi sopra), non
   è un argomento per evitarlo se serve davvero.
4. `powershell -ExecutionPolicy Bypass -File setup_windows.ps1 -AgentDir
   "C:\gaia\..." -AgentUser "<utente>"` — SSH, Task Scheduler AtLogOn
   nascosto, power plan.
5. Aggiungi la chiave pubblica SSH di Core a
   `%ProgramData%\ssh\administrators_authorized_keys` (istruzioni stampate
   dallo script).
6. `tailscale up`, join alla tailnet.
7. Riavvia, verifica `GET /gaia/devices/profiles` su OPS (Node-RED) mostra
   il device online con lo stato servizi corretto.

## Client TD Gaia

Ogni macchina Windows che ospita progetti TouchDesigner ha in più il
client `td_internal_agent.py` DENTRO ai singoli progetti .toe (non
gestito da `agent.py` — si annuncia da solo via MQTT con `role:
"touchdesigner"`, `family` per progetto: `patchdeck`/`dmx`/`mixeraudio`/
`gaia`/`yolo`/`herbarum`). Non fa parte di questo contratto (è per
progetto, non per macchina) — resta come oggi.

## services.json per-macchina — convenzione di naming (dal 2026-09-29)

Il file `minipc/installation/services.json` tracciato in repo rappresenta
la macchina touring **attualmente live** (oggi: Palazzo Ducale,
`installation-vs-mini-silver`) — è quello che finisce su
`C:\gaia\minipc\installation\services.json` quando si fa deploy lì.

Per una SECONDA macchina touring in preparazione in parallelo (es.
silver-filoq), il file di riferimento vive sotto un nome distinto,
`services.<nome-macchina>.json` (es. `services.silver-filoq.json`), finché
non è quella la macchina attiva — evita di sovrascrivere la config di una
macchina live mentre se ne prepara un'altra offline. Quando si fa il
deploy vero su quella macchina, il file va copiato come `services.json`
nella sua cartella (non rinominato in repo: resta comunque comodo avere
entrambe le versioni sotto controllo versione per confronto).

## Prossimi passi (non ancora fatti)

- **Pi**: stesso esercizio di unificazione per `pi/agent/agent.py` (oggi
  un solo file, non due — meno urgente, ma verificare che
  `_ORPHAN_CHECK_TTL`/rotazione log valgano anche lì) + pattern per un
  nuovo servizio hardware (es. pulsantiera MIDI USB → OSC verso TD): si
  modella come un nuovo `service` in `services.json` di tipo processo
  Python dedicato (libreria `python-rtmidi` o `mido` per leggere i
  pulsanti, `python-osc` per inviarli — stessa libreria già in uso in
  `osc_bridge.py`), non serve una `family` MQTT nuova a meno che non debba
  anche apparire come device separato in una pagina web dedicata.
- **silver-filoq**: offline al momento di questo giro (Tailscale "last
  seen 1h ago") — deploy del contratto aggiornato rimandato al prossimo
  avvio. `services.silver-filoq.json` preparato con madmapper/
  madmapper_bridge (stesso kit di Ducale) ma path PLACEHOLDER, da
  verificare dal vivo appena la macchina è online (versione MadMapper,
  progetto .mad reale, interprete Python) prima di distribuirlo.
- **Portatile Windows di test** (menzionato dall'utente, per TD
  Gaia/PatchDeck/Herbarium): visto sulla LAN di casa come `Nitai.lan`
  (192.168.1.249) ma non confermato — servono IP/credenziali confermati
  prima di un deploy.
- Timestamp nei log: oggi molte righe non ce l'hanno (dipende da dove il
  singolo `print()` lo include a mano) — valutare se prefissare ogni riga
  in `_RotatingConsole.write()`.

## Cosa è cambiato oggi (2026-09-29)

Prima: `ops/agent.py` e `minipc/installation/agent.py` erano due
codebase partite dallo stesso punto e poi divergenti — l'installazione
aveva discovery/Tailscale, watchdog reale, `shutdown_at`, ma **non** il
fix del polling PowerShell (stesso bug di sfarfallio latente, mai
segnalato lì solo perché non presidiata); OPS aveva conflitti/camera
ref-count e il fix del polling, ma **non** discovery/watchdog/
`shutdown_at`/rotazione log. Nessuna delle due aveva SSH garantito da
uno script ripetibile. Unificati in questo giro: entrambe hanno ora
l'intero set di capacità sopra, differenziato solo da `services.json`.
