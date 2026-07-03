# GAIA ↔ TouchDesigner — bridge OSC

Componente nuovo (2026-07-03): scambia dati in tempo reale tra Gaia e TouchDesigner via OSC,
così TD può generare contenuti (visuali, audio, luce) a partire dallo stato reale della casa,
e viceversa Gaia può reagire a ciò che TD genera (palette, preset, parametri) senza che nessun
altro componente debba sapere nulla di OSC.

```
Gaia (Node-RED, ws://miniPC:1880/gaia) ──WS──▶ osc_bridge.py ──OSC/UDP──▶ TouchDesigner
TouchDesigner ──OSC/UDP──▶ osc_bridge.py ──MQTT (gaia/touchdesigner/...)──▶ Node-RED / altri
```

Servizio indipendente: se TouchDesigner è spento il bridge continua a girare (riprova la
connessione), e se il bridge è giù nessun altro componente Gaia ne risente.

## Setup

```bash
source ~/core-node-0/venv/bin/activate
pip install -r requirements.txt   # python-osc, websocket-client, paho-mqtt

# Test manuale
python3 osc_bridge.py

# Come servizio systemd
sudo cp gaia-touchdesigner.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now gaia-touchdesigner
journalctl -u gaia-touchdesigner -f
```

Config via `/etc/gaia/touchdesigner.conf` (stesso pattern layered env>file>default degli
altri componenti, vedi `config.py`):

| Chiave | Default | Note |
|---|---|---|
| `GAIA_WS_HOST` / `GAIA_WS_PORT` / `GAIA_WS_PATH` | `localhost` / `1880` / `/gaia` | sorgente dati (stessa WS di dashboard/arte visiva) |
| `TD_OSC_HOST` / `TD_OSC_PORT` | `127.0.0.1` / `7000` | dove gira TouchDesigner (di norma sulla stessa macchina) |
| `OSC_IN_PORT` | `9008` | porta su cui il bridge ascolta i messaggi da TouchDesigner |
| `SEND_INTERVAL_MS` | `100` | ogni quanto inviare lo snapshot Gaia→TD (10Hz) — **non abbassare senza motivo**: la WS di Gaia è stata misurata a migliaia di broadcast/sec in certe condizioni, molto più di quanto documentato altrove; il bridge disaccoppia deliberatamente il rate di arrivo da quello di invio |
| `MQTT_HOST` / `MQTT_PORT` | `192.168.1.142` / `1883` | dove pubblicare i dati che arrivano da TouchDesigner |
| `MQTT_TD_TOPIC_BASE` | `gaia/touchdesigner` | prefisso topic per il relay TD→MQTT |

## Gaia → TouchDesigner: schema indirizzi OSC

Un indirizzo OSC per ogni valore scalare del payload WS (stesso payload documentato nella
memory `project-gaia-web` — vedi lì per lo schema completo campo per campo). Esempi:

```
/gaia/soul/mood            "calm"
/gaia/soul/lifeIndex        67
/gaia/soul/stress           0.2
/gaia/progression/level     3
/gaia/progression/activeClass  "Esploratore"
/gaia/thought               "Sto osservando il silenzio della casa."
/gaia/voiceStatus/status    "listening"
/gaia/people/Mauro/room     "salotto"
/gaia/people/Mauro/emotion  "happy"
/gaia/rooms/salotto/persons_count  1
/gaia/lights/Luce_Salotto/power     1
```

Liste con elementi che hanno `name`/`id` (persone, stanze, luci, piante) usano quel valore
nell'indirizzo invece dell'indice numerico — più facile da collegare a mano in un network
TouchDesigner. Liste di elementi senza nome (es. `events`) usano l'indice.

**Lato TouchDesigner:** un OSC In CHOP (o OSC In DAT per i valori stringa) in ascolto su
`127.0.0.1:7000` riceve automaticamente un canale per ogni indirizzo univoco — non serve
mappare i campi uno per uno lato TD, basta referenziare il canale con lo stesso path.

## TouchDesigner → Gaia: convenzione indirizzi in ingresso

Il bridge ascolta su `OSC_IN_PORT` (default 9008) e ripubblica **qualsiasi** indirizzo OSC
ricevuto su MQTT come `gaia/touchdesigner/<path>`. Convenzione consigliata lato TD: prefissare
con `/gaia/td/...` (il prefisso `gaia/td/` o `gaia/` viene tolto automaticamente nel topic
MQTT risultante, per evitare `gaia/touchdesigner/gaia/td/...` ridondante):

```
TD invia  /gaia/td/palette/warmth 0.73   → MQTT gaia/touchdesigner/palette/warmth = 0.73
TD invia  /gaia/td/preset "nebula_01"    → MQTT gaia/touchdesigner/preset = "nebula_01"
```

Da Node-RED, sottoscrivere `gaia/touchdesigner/#` per reagire ai parametri generati da TD
(es. usare una palette generata da TD per pilotare le luci Hue via `MoodSceneSync`, vedi
`docs/maggiordomo.md`) — nessuna modifica al bridge necessaria per aggiungere nuovi parametri,
basta iniziare a mandarli da TD.

## Roadmap

- **Primo consumatore naturale**: `gaia-art/` (Arte Visiva, vedi `docs/web-sections.md`) genera
  già una composizione astratta dagli stessi dati in browser — TouchDesigner può fare lo stesso
  con più potenza (particellari, shader, video mapping reale in stanza). Nessun lavoro
  aggiuntivo lato Gaia: i dati sono già gli stessi.
- Non ancora implementato: filtro/selezione di quali campi mandare (oggi il bridge appiattisce
  *tutto* il payload) — se il volume di canali OSC diventa un problema lato TD, aggiungere un
  allow-list in config invece di continuare a mandare tutto.
