---
name: ops-agent-mqtt-crash-2026-07-09
description: "Agent OPS crashato al login per timeout MQTT (fix: retry con backoff); admin.py sul Core non riceve piu' gli stats live nonostante il broker li consegni correttamente"
metadata:
  node_type: memory
  type: project
---

# Agent OPS non partito al login + admin Core "disconnesso" (2026-07-09)

**Why:** l'utente ha acceso la macchina la mattina del 2026-07-09 e non vedeva
nessuna attivita' MQTT/servizi attivi, nonostante lo Scheduled Task `GAIA-OPS-Agent`
(vedi [[ops-test-risultati]], Missione 4) sia configurato `AtLogOn`.

## Problema 1 — agent.py crashava al login (RISOLTO)

Il task si avviava regolarmente (log: `LastRunTime 09:22:28`, `LastTaskResult=0`)
ma il processo Python moriva subito dopo con `TimeoutError` nel connettersi al
broker (`192.168.1.142:1883`) — causa probabile: `AtLogOn` scatta prima che la
rete/Tailscale sia pronta a instradare verso il Core (race condition al boot,
non riproducibile a comando: il broker risultava raggiungibile pochi minuti dopo).

`agent.py:445` faceva `_mqtt.connect(...)` **senza retry**: un fallimento fa
risalire l'eccezione fino a `main()` e killa l'intero processo, portandosi giu'
anche i servizi gia' avviati da `apply_initial_config()` (in questo caso `voice`,
rimasto orfano).

**Fix applicato** (`ops/agent/agent.py`, funzione `main()`): loop di retry con
backoff esponenziale (5s → max 60s) attorno a `_mqtt.connect()`, rispetta
`_running` per uscita pulita su segnale. Nessun'altra logica cambiata.

**Nota a margine**: nella config persistita (`ops/agent/agent_config.json`) solo
`voice` risultava `enabled` (camera/yolo/mediapipe `false` da un test del
2026-07-07) — comportamento voluto dall'utente ("video lo accendo manualmente
per adesso"), non un bug.

**Falso allarme investigato e chiuso**: dopo il riavvio manuale si vedevano due
processi `agent.py` (uno da `C:\gaia\venv\Scripts\pythonw.exe`, uno da
`C:\Program Files\Python311\pythonw.exe`, quest'ultimo figlio del primo). Non e'
una doppia istanza: il venv e' basato su quell'installazione (`pyvenv.cfg` →
`home = C:\Program Files\Python311`) e il suo `pythonw.exe` e' un redirector che
rilancia l'interprete base — comportamento normale di questo venv, si vede per
ogni processo lanciato tramite `venv\Scripts\python(w).exe` (infatti anche
`voice/main.py` mostra lo stesso pattern a coppie). Il lock singleton
(`msvcrt.locking` su `agent.lock`) funziona correttamente, verificato in
precedenza in [[ops-test-risultati]].

## Problema 2 — admin page Core "disconnesso", slider mic fermo (NON RISOLTO, lato Core)

Dopo il fix sopra, l'utente segnala che la pagina admin (Core, porta 8765,
`gaia_admin.py`) mostra stato disconnesso e lo slider del microfono non si
muove. **Diagnosi eseguita da qui (OPS), esclude il lato OPS/broker:**

- Il servizio voice di OPS pubblica regolarmente su `gaia/voice/stats/cucina`
  ogni 5s (confermato nei log, `[voice] [Stats] vol=...`).
- Sottoscrizione diretta al broker da OPS (`gaia/voice/stats/+`, script
  usa-e-getta con paho-mqtt) conferma che **il broker consegna correttamente
  tutti e tre i flussi in tempo reale**: `cucina` (OPS, `device_id=ops-silvermini2`),
  `ingresso` (Pi, `device_id=pi-fd75d8`), `minipc` (`device_id=gaia-main`).
- Query diretta a `http://192.168.1.142:8765/api/status`: **`stats` e `pi_stats`
  risultano entrambi vuoti (`{}`)** — dovrebbero contenere rispettivamente i dati
  di `minipc` e `{"cucina": ..., "ingresso": ...}` (routing in `gaia_admin.py`,
  `_on_message`, chiave = ultimo segmento del topic).

**Conclusione**: dati sani fino al broker, il problema e' nel processo
`gaia_admin.py` sul Core — il suo client MQTT interno non sta ricevendo/
processando i messaggi (disconnesso, subscribe non ripartita dopo un riavvio,
o simile). Non investigato oltre da qui: broker/brain/web UI sono territorio
del Core per convenzione (`ops/CLAUDE.md`, "Regole della casa") e non ho
accesso SSH da OPS verso il Core per controllare il processo dal vivo.

### Prossimi passi (per chi lavora sul Core)

- Verificare se `gaia_admin.py` gira e se il suo `_on_connect` si e' davvero
  risottoscritto (log del servizio, es. `journalctl` se e' un systemd unit).
- Probabile fix: riavvio del servizio admin. Se il problema si ripete dopo un
  riavvio del broker/rete, considerare lo stesso pattern di retry-con-backoff
  applicato qui in `ops/agent/agent.py` anche al client MQTT di `gaia_admin.py`
  (stesso tipo di race condition, causa diversa).
