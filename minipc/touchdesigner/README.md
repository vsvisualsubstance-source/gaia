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

## Controllo dispositivi da dentro TD — due moduli complementari

- **`td_internal_agent.py`** — fa comparire QUESTA istanza TD come UN
  device controllabile in Admin (Pi Manager la vede, può inviarle comandi).
- **`td_service_control.py`** — il contrario: TD come CONTROLLORE, ascolta
  lo stato di TUTTI i device (Pi, OPS, Core) e può avviarne/fermarne i
  servizi (play/stop/restart), stessa cosa che fa Pi Manager nel browser.

Coesistono nello stesso progetto senza conflitti (moduli indipendenti,
stesso broker).

**GOTCHA con Embody** (esternalizzazione TD in git — se il progetto usa
[Embody](https://github.com/vsvisualsubstance-source/TD4Gaia), verificato
dal vivo 2026-08-05): l'Execute DAT `onStart`/`onExit` di entrambi i moduli
NON deve vivere dentro il sottoalbero gestito da Embody (es. dentro il COMP
`gaia_agent`/`gaia_control`) a meno di esternalizzarlo esplicitamente —
altrimenti il ciclo strip/restore di Embody lo cancella al riavvio di TD e
l'agent smette di partire. Metterlo alla radice del progetto come `.tox`
indipendente (fuori dall'albero gestito) risolve. `start()`/`stop()` di
entrambi i moduli sono idempotenti, quindi è sicuro chiamarli anche da un
trigger esterno oltre a un eventuale `onCreate` interno al COMP.

### `td_internal_agent.py` — vedere un'istanza TD in Admin (Pi Manager)

`td_internal_agent.py` **gira dentro il progetto TD stesso** (Text DAT +
Execute DAT, Python embedded di TD) — non è un processo di sistema esterno,
non tocca `TouchDesigner.exe`, non ha un manifest con path sul filesystem.
Configurazione via parametri di un COMP, salvata nel `.toe`: portabile da
una macchina all'altra senza toccare nulla fuori dal progetto (ogni
macchina può avere TD installato in modo diverso).

Stesso protocollo MQTT degli agent Pi/OPS (`gaia/device/{id}/status|command`,
vedi `pi/agent/agent.py`/`ops/agent/agent.py`), ma qui i "servizi" sono
azioni interne al network TD (es. "riscollega l'OSC In"), non l'intero
processo — riavviare l'intera istanza TD da dentro se stessa non è
possibile né sensato.

**Setup** (istruzioni complete e commentate nella docstring in cima al
file):
1. COMP contenitore (es. `gaia_agent`) con Custom Page: `Deviceid`,
   `Stanza`, `Name`, `Mqtthost`, `Mqttport` (tutti opzionali, default
   sensati se assenti).
2. Text DAT `gaia_device_agent` dentro quel COMP, File = path di
   `td_internal_agent.py` (Sync to OS ON per ricaricare le modifiche fatte
   fuori da TD).
3. Execute DAT nello stesso COMP: `onStart` chiama
   `op('gaia_device_agent').module.start()`, `onExit` chiama `.stop()`.
4. (Facoltativo) dal tuo script di progetto, `register_service(nome,
   start=, stop=, status=)` per collegare un controllo vero — senza
   nessuna registrazione l'agent compare comunque in Admin (presenza +
   heartbeat), i comandi restano no-op loggati finché non colleghi
   qualcosa.

Verificato offline (logica pura + un vero round-trip enable via MQTT contro
il broker reale, con `me`/`op`/`run` di TD simulati): il dispatch dei
comandi e il marshalling sul thread principale via `run()` funzionano come
previsto. **Non ancora collaudato dentro una vera istanza TD** — la firma
esatta di `run()` va confermata alla prima prova reale.

### `td_service_control.py` — play/stop/restart dei servizi da TD

Ascolta `gaia/device/+/status` (TUTTI i device, non serve sapere gli id in
anticipo) e mantiene una **Table DAT** `devices_table` con una riga per
ogni coppia device+servizio (`device_id, name, stanza, role, service,
state, offline`) — bind diretto per un List COMP: è il modo più naturale
in TD per una UI a righe con bottoni play/stop, senza che questo script
debba sapere nulla di come la disegni.

**Setup**:
1. COMP contenitore (es. `gaia_control`), Custom Page opzionale
   (`Mqtthost`/`Mqttport`, default 192.168.1.142:1883 se assenti).
2. Table DAT vuota `devices_table` nello stesso COMP — la riscrive questo
   script, non editarla a mano.
3. Text DAT `td_service_control` con questo file come sorgente esterna.
4. Execute DAT: `onStart` → `.start()`, `onExit` → `.stop()`.
5. Dai tuoi bottoni (Button COMP, List COMP onClick...):
   ```python
   op('gaia_control/td_service_control').module.send_command(
       device_id, service_name, 'enable')    # play
   # oppure 'disable' (stop) / 'restart'
   ```
   `send_command()` è sicura da un callback UI diretto — gira già sul
   thread principale, nessun `run()` necessario lì (solo la *ricezione*
   degli status, che arriva dal thread di rete MQTT, passa da `run()`
   prima di toccare la Table DAT).

Device offline (nessuno status da >90s, stesso timeout di Pi Manager):
colonna `offline` a `"True"` nella tabella, filtrabile lato TD.

Verificato offline (logica pura: stati/servizio-solo-in-config/offline
tutti coperti da test) più un round-trip reale contro il broker MQTT
(connessione, subscribe, un status reale ricevuto senza errori). Stessa
nota degli altri moduli: `run()`/Table DAT non ancora provati dentro una
vera istanza TD.

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

### Consumer già collegati (Node-RED)

Due canali reali già cablati su questa convenzione, entrambi **spenti di default**
(vanno accesi in Admin → Automazioni prima di usarli):

- **Luci** (`touchdesignerLighting`): `/gaia/td/lighting/<ItemOpenHAB>/<campo>` —
  campo in `Potenza`/`Luminosita`/`Colore`/`Color_Temperature`, valore scritto
  direttamente sull'item OpenHAB reale (nessuna mappa stanza→item, l'item va
  indicato per nome esatto lato TD).
- **Mood** (`touchdesignerMood`, 2026-08-04): `/gaia/td/mood/<dimensione>` con
  UN float come argomento = **delta** da sommare (non un valore assoluto — il
  mood ha già un decadimento naturale nel tempo, un delta è coerente con tutte
  le altre sorgenti). `dimensione` ∈ `stress`/`calm`/`social`/`curiosity`
  (clamp 0-1) o `energy` (clamp 0-100). Esempio: `/gaia/td/mood/curiosity 0.1`
  aggiunge 0.1 a `brain.mood.curiosity`. **Chiude il loop**: il nuovo mood
  torna a TD al giro successivo del feed `/gaia/canvas/...` sotto (mood +
  palette), senza bisogno di altro — TD vede i propri effetti tornare indietro
  come nuovi colori. Testato dal vivo 2026-08-04 (nudge reale su `calm`,
  0.02→0.32 confermato).

## Gaia → TouchDesigner: feed curato `/gaia/canvas/...` (2026-07-25)

Il flatten grezzo sopra manda **tutto** il payload dashboard (~1900 indirizzi
misurati — utile come firehose/debug, ma non pensato per pilotare
immagini/DMX/effetti: mescola log storici, sensori Hue mal-nominati, ecc.).
Per quello esiste un secondo feed, molto più piccolo e **strutturato apposta
per TD**, costruito in Node-RED ("Build TD Canvas", tab Gaia Engine, tick
ogni 2s) e pubblicato su MQTT `gaia/td/canvas` — il bridge lo ascolta e lo
manda sotto `/gaia/canvas/...`, **sulla porta 7001** (`TD_EVENT_OSC_PORT`,
non sulla 7000 della WS grezza — vedi il box subito sotto per il perché):

```
/gaia/canvas/soul/mood                 "curiosity"
/gaia/canvas/soul/mood_rgb/r,g,b       190, 135, 255   (stessa palette di web/asemic.js)
/gaia/canvas/soul/stress,calm,social,curiosity,energy,lifeIndex

/gaia/canvas/rooms/salotto/presence_count, activity, temperature, darkness
/gaia/canvas/rooms/salotto/emotion, pose, gesture        (da mediapipe)
/gaia/canvas/rooms/salotto/objects/person/count           1
/gaia/canvas/rooms/salotto/objects/person/seed             1402450561

/gaia/canvas/lights/{id}/power, brightness, color         (solo luci vere, filtrate)
/gaia/canvas/bricks/{id}/variant, room, temperature, humidity, vibration
/gaia/canvas/lexicon/{parola}/count, seed                  (lessico personale di Gaia)
/gaia/canvas/dream/mood, words/{parola}/seed                (ultimo sogno notturno)
```

**Il seed è la parte importante**: stesso algoritmo FNV-1a del vocabolario
asemico (`web/asemic.js`, `pi/screen/asemic_engine.py`) — la stessa parola o
classe YOLO produce sempre lo stesso numero, ovunque. Un network TD può
seedare il proprio generatore con quel valore per disegnare "sedia" in modo
astratto ma **coerente ogni volta**, la stessa identità visiva già usata su
welcome.html e il display del Pi. È questo che rende Gaia un vero direttore
artistico invece di una sorgente dati qualsiasi.

Eventi one-shot (non nel tick continuo, mandati subito all'arrivo, stessa
porta 7001): `/gaia/canvas/event/level_up/...`,
`/gaia/canvas/event/dream_new/...`, `/gaia/canvas/event/face_enrolled/...`,
`/gaia/canvas/event/person_recognized/...`, `/gaia/canvas/event/plant_note/...`.
Stesso meccanismo per aggiungerne altri (citofono, allarme caduta, ecc.):
basta un mqtt-in in più sul topic giusto, nessuna modifica al bridge.

**Perché tutto il canvas è sulla 7001, non sulla 7000 (2026-08-04)**: prima
si era provato a spostare solo `lexicon`/`dream` (testo) sulla 7001 e
lasciare `soul`/`rooms`/`lights`/`bricks` sulla 7000 (pensata per un OSC In
CHOP, canali numerici continui) — ma verificato campo per campo che
**ogni** categoria ha almeno un valore testuale mischiato ai numeri
(`soul.mood`, `rooms.activity/emotion/pose/gesture`, `lights.color`,
`bricks.variant/room/interfaces`). Non aveva senso separare "i numeri" dal
resto quando quasi tutto ha del testo dentro — l'intero canvas (tick +
eventi) va quindi sulla stessa porta `TD_EVENT_OSC_PORT` (default **7001**,
configurabile in `/etc/gaia/touchdesigner.conf`), e su quella porta TD
punta un **OSC In DAT** dedicato invece di un CHOP. La 7000 resta libera
per il solo flatten grezzo sopra.

## Gotcha: canali fantasma (persone/oggetti spariti restano "presenti" in TD)

OSC non ha un messaggio "elimina questo canale" — un OSC In CHOP tiene
l'ultimo valore ricevuto per sempre. Se Gaia smette di mandare
`/gaia/people/Mauro/confidence` perché Mauro è uscito, quel canale resta
bloccato al suo ultimo valore (es. `0.77`) in TD, anche ore dopo, pur con
la WS di Gaia già correttamente vuota — visto dal vivo (2026-07-25):
"Ospiti" fittizi e persone uscite da tempo ancora "presenti" secondo TD.

Fix: `OscAddressTracker` in `osc_bridge.py` ricorda gli indirizzi mandati
nel giro precedente e, per quelli che spariscono, manda esplicitamente un
valore azzerato (0 per numeri, stringa vuota per testo) invece di lasciarli
bloccati. Applicato al feed grezzo `/gaia/...` e al tick continuo di
`/gaia/canvas/...` (non agli eventi one-shot, che sono bang per natura).

**Limite noto**: il tracker parte vuoto ad ogni riavvio del servizio, quindi
non "ricorda" canali lasciati fantasma da PRIMA del riavvio/fix — quelli
restano bloccati in TD finché non li azzeri manualmente lì (reset/re-cook
dell'OSC In CHOP), oppure finché la stessa persona/oggetto non ricompare e
sparisce di nuovo (a quel punto si azzera correttamente da solo).

## Roadmap

- **Primo consumatore naturale**: `gaia-art/` (Arte Visiva, vedi `docs/web-sections.md`) genera
  già una composizione astratta dagli stessi dati in browser — TouchDesigner può fare lo stesso
  con più potenza (particellari, shader, video mapping reale in stanza). Nessun lavoro
  aggiuntivo lato Gaia: i dati sono già gli stessi.
- ~~Non ancora implementato: filtro/selezione di quali campi mandare~~ **Fatto (2026-07-25)**:
  vedi feed curato `/gaia/canvas/...` sopra.
