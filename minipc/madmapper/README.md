# GAIA ↔ MadMapper — bridge OSC↔MQTT

Modulo a parte, stesso schema di [`minipc/touchdesigner/`](../touchdesigner/README.md):
codice + doc vivono insieme nella cartella del modulo, non sparsi tra
`docs/` e la memoria privata dell'agente. Separato da
[`minipc/installation/`](../installation/) apposta — quel modulo è il kit
generico riusabile per qualunque macchina touring futura (agent, watchdog,
discovery, power on/off), questo è specifico della family `madmapper` e
gira solo dove serve MadMapper. `installation/services.json` lo lancia
come servizio a parte (vedi sotto), ma i due moduli non condividono altro
codice.

Nato 2026-09 per l'installazione a Palazzo Ducale (Genova, 1 mese,
video-mapping). `family: "madmapper"` è una family nuova, stesso principio
già in produzione per DMX/PatchDeck su TouchDesigner: un device che si
annuncia su MQTT con quel campo, una pagina web dedicata
([`web/madmapper.html`](../../web/madmapper.html)) che lo scopre da sola
per quel campo — stesso schema client-side di `mixeraudio.html` per
`family === 'mixeraudio'`.

## Perché un processo separato da MadMapper.exe

Stesso principio già validato per il watchdog TouchDesigner in
`osc_bridge.py`: un self-check dentro l'app controllata condividerebbe il
suo stesso destino se si blocca. Il bridge gira come servizio a parte
(`madmapper_bridge` in `minipc/installation/services.json`), monitorato
dal watchdog di `installation/agent.py` come ogni altro servizio.

## Cosa è generico oggi, cosa è placeholder

Letto dal vivo il giorno del deploy — mai un'ipotesi non verificata
spacciata per certa (stessa regola imparata con i 5 knob FX di PatchDeck
questa sessione: un'API mai vista dal vivo va sempre verificata prima di
costruire la UI finale contro di essa).

- **Relay OSC completamente generico**: qualunque indirizzo, in entrambe
  le direzioni. Nessun nome di parametro/superficie/scena hardcoded —
  esattamente come `brain._tdFxParams` non hardcoda mai i nomi FX.
- **Unica azione "named"**: `blackout` (`/surfaces/*/opacity` → 0),
  perché è documentata ufficialmente da MadMapper (Help → OSC Channels
  List / docs.madmapper.com) — sicura da costruire senza aver visto il
  progetto reale.
- **`MADMAPPER_OSC_OUT_PORT`/`MADMAPPER_OSC_IN_PORT`** sono PLACEHOLDER
  (default 8010/8011) — da confermare contro le preferenze OSC reali di
  MadMapper una volta online (Preferences → OSC, o "Live Performance &
  Control").
- **Liveness SOLO passiva** (età dell'ultimo messaggio OSC ricevuto,
  esposta nello status) — NON dichiara mai MadMapper "morto" e non chiede
  un restart da sola. Non è confermato se MadMapper mandi traffico OSC
  spontaneo a scena statica/inattiva: un trigger automatico su "silenzio
  OSC" rischierebbe falsi positivi (restart di un'istanza viva ma solo
  silenziosa) — peggio di nessun watchdog. Il riavvio automatico reale
  resta quello di `agent.py` sul PROCESSO (affidabile: se `MadMapper.exe`
  crasha, sparisce davvero). Da rafforzare in seguito se si conferma dal
  vivo che MadMapper risponde a una query OSC esplicita ("Get" — sintassi
  esatta da vedere coi propri occhi).

## Protocollo MQTT

- `gaia/device/{device_id}/status` (retained, ogni 30s) — `role:"device"`,
  `family:"madmapper"`, `osc_out_target`, `osc_in_port`,
  `last_osc_in_age_s`/`last_osc_in_address` (informativi), `uptime`.
- `gaia/device/{device_id}/command` — `{action:"osc_set", address, value}`
  (relay generico), `{action:"blackout"}`, `{action:"status"}` (forza un
  republish).
- `gaia/device/{device_id}/osc_in/{indirizzo_sanificato}` — ogni messaggio
  OSC ricevuto da MadMapper, rilanciato su MQTT (indirizzo con `/` → `_`,
  stesso schema di sanificazione di `osc_bridge.py`).

`device_id` di default: `madmapper-{hostname}` (env `MADMAPPER_DEVICE_ID`
per override).

## Setup

Niente venv su questa macchina (vedi `_nota` in
`minipc/installation/services.json`: Windows Defender rilanciava una
seconda copia di ogni processo lanciato da un interprete copiato in un
venv — doppio bridge, stesso `device_id` in conflitto su MQTT). Si
installa direttamente nel Python di sistema (winget, utente `vs`):

```
C:\Users\vs\AppData\Local\Programs\Python\Python312\python.exe -m pip install -r requirements.txt
```

Lanciato da `installation/agent.py` come servizio (`madmapper_bridge` in
`services.json`, `cwd: C:\gaia\minipc\madmapper`) — non va avviato a mano
in produzione, solo per test manuale:

```
C:\Users\vs\AppData\Local\Programs\Python\Python312\python.exe madmapper_bridge.py
```

## Da fare al primo giorno online (AnyDesk)

1. Confermare le porte OSC reali da Preferences → OSC in MadMapper,
   aggiornare `MADMAPPER_OSC_OUT_PORT`/`MADMAPPER_OSC_IN_PORT` in
   `services.json` (`env_extra`) o via variabili d'ambiente.
2. Leggere l'elenco OSC reale del progetto (Help → OSC Channels List) →
   solo allora ha senso aggiungere widget specifici (scene, opacità per
   superficie) in `web/madmapper.html`, oggi limitata a blackout + invio
   grezzo + log.
3. Verificare se MadMapper risponde a una query OSC esplicita — se sì,
   valutare di rafforzare la liveness (vedi sopra).
