# GAIA ↔ TouchDesigner — contratto di integrazione (riferimento unico)

Documento pensato per chi lavora **lato TouchDesigner** (incluse sessioni
Claude dedicate a quel lato): riassume in un punto solo tutto ciò che serve
per parlare con GAIA via OSC, senza dover leggere il codice Node-RED o i
vari README sparsi nel repo. Per il dettaglio completo di ciascun pezzo, i
riferimenti restano `minipc/touchdesigner/README.md` e
`pi/mediapipe/README.md` — questo file è un indice/contratto, non li
sostituisce.

## Le tre reti OSC — non confonderle

Sulla stessa infrastruttura esistono **tre canali OSC indipendenti** che
hanno poco a che fare tra loro. Confonderli è l'errore più facile da fare:

| Canale | Chi parla | Porta | Cosa porta |
|---|---|---|---|
| **1. Bridge Gaia↔TD** | Core (miniPC) ↔ TD | 7000 (flatten grezzo) + 7001 (canvas curato + eventi) out / 9008 in | Stato della casa: mood, stanze, luci, persone, lessico |
| **2. Mocap diretto** | OPS → TD | 7000 (stessa porta del flatten grezzo, indirizzi diversi) | Landmark grezzi viso/mani/pose in tempo reale |
| **3. Driver Solaro DSP** | Solaro QR1 ↔ driver esterno utente | 4554-4558, 52381, ecc. | Angoli mic array, livelli audio, preset camera — **NIENTE a che fare con Gaia**, sistema audio a parte |

Il canale 3 non è documentato qui: è un progetto separato dell'utente, non
passa da Node-RED/MQTT. Se un lavoro riguarda quel driver, il riferimento è
altrove (memoria di progetto lato Core, non in questo repo).

---

## Canale 1 — Bridge Gaia↔TD (`minipc/touchdesigner/osc_bridge.py`)

Host Core: `192.168.1.142`. Servizio: `gaia-touchdesigner.service`.

### Gaia → TD (Core manda, TD ascolta)

Il flatten grezzo (sotto) resta sulla **porta 7000**. **Tutto il resto**
(feed curato canvas, tick continuo E eventi one-shot) va sulla **porta
7001** — vedi la sezione dedicata più sotto per il perché.

- **`/gaia/...`** — flatten grezzo di TUTTO il payload dashboard (~1900
  indirizzi). Firehose/debug, non pensato per pilotare effetti — mescola log
  storici, sensori Hue mal-nominati, ecc. **Fino al 2026-08-04 solo
  `vision/rooms` era catalogato**; qui sotto la mappa completa di primo
  livello (`payloadData`, costruito da `ThreeViewEngineGAME` in Node-RED) —
  ogni chiave diventa `/gaia/<chiave>/...` nel flatten:

  | Chiave | Cosa contiene |
  |---|---|
  | `soul` | mood corrente (stress/calm/social/curiosity/energy + label) — stesso dato di `/gaia/canvas/soul/...` ma qui grezzo |
  | `people` | lista persone presenti: nome, stanza, emozione, posa, **visits** (quante volte vista), **affinity**, durata sessione corrente, confidenza |
  | `lights` | luci Hue reali (esclusi sensori mal-nominati): luminosità, colore (hex), temperatura colore, accesa/spenta |
  | `plants` | piante monitorate: umidità, salute (0-1), stato (`critical`/`warning`/`good`) |
  | `sensors` | sensori ambientali: temperatura, luce ambiente, buio/luce diurna, movimento, batteria (livello + basso sì/no) |
  | `rooms` / `vision/rooms` | dato per stanza — vedi tabella dettagliata sotto |
  | `metrics` | contatori aggregati: persone/luci/sensori-movimento attivi, dispositivi batteria bassa, temperatura media, trend mood/attività |
  | `progression` | stato RPG di Gaia: livello, xp, classe attiva, asset sbloccati, statistiche |
  | `thought` | **testo** dell'ultimo pensiero spontaneo di Gaia |
  | `lastMemory` | riassunto dell'ultimo ricordo salvato |
  | `lastDream` / `lastDreamWords` / `lastDreamTs` | ultimo sogno — stesso dato di `/gaia/canvas/dream/...` (porta 7001) ma qui grezzo |
  | `roomGraph` / `roomGraphLearned` | grafo di adiacenza tra le stanze (statico + appreso) |
  | `events` | log degli ultimi eventi del brain |
  | `hourlyStats` | statistiche orarie |
  | `voiceStatus` / `voiceCommands` / `tts` | stato voce, ultimi comandi, ultimo testo pronunciato |
  | `herbarium` | note musicali recenti delle piante (se il modulo è attivo) |
  | `stats` | conteggi totali: persone totali, persone presenti, luci attive |

  **Vision/rooms in dettaglio** (per stanza, sotto `rooms/{stanza}/...` e
  identico sotto `vision/rooms/{stanza}/...`):
  ```
  persons_count      quante persone rilevate
  activity            working/resting/sitting/present/empty/idle
  objects/...          oggetti YOLO rilevati, conteggio per classe
  currentEmotion       ultima emozione rilevata (mediapipe)
  currentPose          ultima posa rilevata
  gesture              ultimo gesto rilevato
  temperature|humidity|ambient_light|darkness   sensori ambientali, se presenti
  yoloActive|mediapipeActive   booleani, quali servizi vision girano davvero lì
  speaking             nome di chi sta parlando (se rilevato negli ultimi 15s)
  scene                descrizione scena dal VLM (moondream), se attivo
  ```

  Il resto (dentro `metrics`, `hourlyStats`, `roomGraph`, ecc.) va comunque
  scoperto indirizzo per indirizzo se serve — questa tabella copre il primo
  livello e i campi più probabilmente utili per l'arte generativa
  (`people`, `lights`, `plants`, `sensors`, `thought`), non ogni sotto-campo.

### Porta **7001** — feed curato canvas (tick continuo + eventi)

Costruito in Node-RED ("Build TD Canvas", tab Gaia Engine, tick ogni 2s),
pubblicato su MQTT `gaia/td/canvas` — il bridge lo ascolta e lo manda sotto
`/gaia/canvas/...`, **tutto su questa porta, non sulla 7000**.

**Perché non sulla 7000 (2026-08-04)**: prima si era provato a spostare
solo `lexicon`/`dream` (testo) qui e lasciare `soul`/`rooms`/`lights`/
`bricks` sulla 7000 (pensata per un OSC In CHOP, canali numerici continui)
— ma verificato campo per campo che **ogni** categoria ha almeno un valore
testuale mischiato ai numeri: `soul.mood`, `rooms.activity/emotion/pose/
gesture`, `lights.color`, `bricks.variant/room/interfaces`. Non aveva senso
separare "i numeri" dal resto quando quasi tutto ha del testo dentro —
tutto il canvas va quindi sulla stessa porta `TD_EVENT_OSC_PORT` (default
**7001**, configurabile in `/etc/gaia/touchdesigner.conf`). Su questa porta
TD punta un **OSC In DAT** dedicato invece di un CHOP. La 7000 resta libera
per il solo flatten grezzo sopra.

Tick continuo:
```
/gaia/canvas/soul/mood                 "curiosity"
/gaia/canvas/soul/mood_rgb/r,g,b       190, 135, 255   (stessa palette di web/asemic.js)
/gaia/canvas/rooms/{stanza}/...        oggetti YOLO con seed FNV-1a deterministico
/gaia/canvas/lights/...                luci pulite per DMX
/gaia/canvas/bricks/{id}/...           variant, room, temperature, humidity, vibration
/gaia/canvas/lexicon/{parola}/count, seed    lessico personale di Gaia
/gaia/canvas/dream/mood, words/{parola}/seed ultimo sogno notturno
```

**"Le frasi che Gaia dice e mostra" (2026-08-04)** — tutto ciò che prima
esisteva solo internamente in Node-RED (mai esposto), più i campi già nel
flatten grezzo ma qui riesposti sul canale testo-friendly:
```
/gaia/canvas/thought                     ultimo pensiero spontaneo (stringa)
/gaia/canvas/thoughts/{i}/text, ts        ultimi 20 pensieri
/gaia/canvas/tts                          ultimo testo pronunciato ad alta voce, IN QUALSIASI STANZA
/gaia/canvas/ttsTs                        timestamp di quel testo
/gaia/canvas/ttsRoom                      dove è stato detto (null se via Echo "tutte")
/gaia/canvas/lastMemory                   riassunto dell'ultimo ricordo
/gaia/canvas/memories/{i}/summary, ts     ultimi 20 ricordi
/gaia/canvas/diary/{i}/source, category, value, person, ts   ultime 20 voci del diario interno
/gaia/canvas/voiceCommands/{i}/text, ts, stanza, via   ultimi 10 comandi vocali DELLE PERSONE (non risposte di Gaia)
```
**`diary` non è testo libero** — sono voci strutturate (source/category/
value, es. `{"source":"hue","category":"brightness","value":0}`), usate
internamente per costruire il prompt del sogno notturno. Se cerchi frasi
leggibili, sono `thought`/`thoughts`/`tts`/`lastMemory`/`memories`, non
`diary`. Tutte le liste sono capate a una finestra recente (10-20 voci) —
gli array completi (`brain.diary` fino a 2000 voci, `brain.thoughts` fino
a 300) non vengono mandati per intero a ogni tick da 2s, sarebbe sprecato.

Eventi one-shot (non nel tick, mandati subito all'arrivo):

```
/gaia/canvas/event/level_up            evento one-shot
/gaia/canvas/event/dream_new           evento one-shot
/gaia/canvas/event/face_enrolled/name         nome della persona appena registrata
/gaia/canvas/event/face_enrolled/camera       stanza/camera dove è avvenuto
/gaia/canvas/event/face_enrolled/snap_index   indice dello snapshot salvato
/gaia/canvas/event/face_enrolled/ts           timestamp
```
`face_enrolled` (2026-08-04): evento discreto quando un enrollment volto
salva davvero uno snapshot (admin.html → "Registra volto"). **Porta solo i
metadati, non l'immagine** — OSC non è adatto a spedire pixel. Per la
composizione visiva vera, TD legge lo **stream MJPEG live della camera**
(`http://<host>:8766/video`, Video Stream In TOP — stesso pattern già
usato per la camera in produzione, vedi `ops/CLAUDE.md`): l'evento dice a
TD *quando* e *dove* reagire, lo stream gli dà i pixel.

```
/gaia/canvas/event/person_recognized/person       nome della persona riconosciuta
/gaia/canvas/event/person_recognized/camera       stanza/camera dove è avvenuto
/gaia/canvas/event/person_recognized/confidence   confidenza del riconoscimento
/gaia/canvas/event/person_recognized/track_id     id della traccia YOLO
```
`person_recognized` (2026-08-04): evento discreto quando una persona NOTA
  (non 'unknown') entra in una stanza o viene identificata — non ogni uscita
  o traccia anonima, filtrato lato Node-RED apposta. Stesso principio di
  `face_enrolled`: solo metadati, i pixel arrivano dallo stream MJPEG.
  Seed FNV-1a: stesso algoritmo di `web/asemic.js`/`pi/screen/asemic_engine.py`
  — la stessa parola/classe produce sempre lo stesso numero, per disegnare in
  modo astratto ma coerente (stessa identità visiva ovunque in Gaia).

```
/gaia/canvas/event/plant_note/note       numero nota MIDI (0-127)
/gaia/canvas/event/plant_note/velocity   velocity MIDI (0-127)
/gaia/canvas/event/plant_note/channel    canale MIDI
/gaia/canvas/event/plant_note/room       stanza (es. "ingresso")
/gaia/canvas/event/plant_note/ts         timestamp
```
`plant_note` (2026-08-04): un evento per ogni nota suonata dall'AV Herbarium
(piante→MIDI→Carla, vedi `docs/pi-moduli-futuri.md`) — più frequente degli
altri eventi (può arrivare più volte al secondo con preset arpeggiati), ma
stessa natura "one-shot per bang" degli altri, quindi stessa porta 7001.
**Gotcha**: l'AV Herbarium ha DUE servizi separati che vanno accesi
ENTRAMBI — `herbsim`/`herbmp` (sorgente note: simulatore o mediapipe) E
`herbarium` (motore che le riceve e le fa suonare via Carla). Accendere solo
la sorgente non produce suono né questo evento — le note vengono scritte su
un bus MIDI che nessuno ascolta.

### TD → Gaia (TD manda, Core ascolta sulla 9008)

Convenzione generica: **qualunque** indirizzo `/gaia/td/...` (o `/gaia/...`)
mandato da TD diventa un publish MQTT `gaia/touchdesigner/<path>` (prefisso
tolto automaticamente). Da lì Node-RED può reagire — ma senza un consumer
scritto apposta, il messaggio arriva su MQTT e non fa nient'altro.

**Due consumer reali già cablati** (entrambi spenti di default — vanno
accesi in Admin → Automazioni prima di usarli):

- **Luci** (`touchdesignerLighting`):
  ```
  /gaia/td/lighting/<ItemOpenHAB>/<campo>   campo ∈ Potenza/Luminosita/Colore/Color_Temperature
  ```
  Scrive direttamente sull'item OpenHAB reale — l'item va indicato per nome
  esatto lato TD, nessuna mappa stanza→item automatica.

- **Mood** (`touchdesignerMood`, aggiunto 2026-08-04):
  ```
  /gaia/td/mood/<dimensione>   float = DELTA da sommare (non un valore assoluto)
  dimensione ∈ stress/calm/social/curiosity (clamp 0-1) oppure energy (clamp 0-100)
  ```
  Esempio: `/gaia/td/mood/curiosity 0.1` aggiunge 0.1 a `brain.mood.curiosity`.
  **Chiude il loop**: il mood aggiornato torna a TD al giro successivo del
  feed `/gaia/canvas/...` sopra (mood + palette) — TD vede i propri effetti
  tornare indietro come nuovi colori, senza bisogno di nient'altro lato Core.
  Testato dal vivo 2026-08-04 (nudge reale su `calm`, 0.02→0.32 confermato).

Per aggiungere un nuovo consumer (es. "TD pilota anche X"): serve un nuovo
nodo Node-RED (mqtt-in su `gaia/touchdesigner/<nome>/#` + function), non una
modifica al bridge — il trasporto è già generico.

---

## Canale 2 — Mocap diretto (`pi/mediapipe/mediapipe_node.py`, `OSC_LANDMARKS=1`)

Chi manda: **OPS** (non i Pi — flag acceso solo lì), direttamente all'IP di
TD sulla porta 7000 (stessa porta del canale 1, indirizzi però nel namespace
`/gaia/mocap/...` — TD li distingue per prefisso). Bypassa completamente
Core/Node-RED/MQTT: è mocap ad alta frequenza (~12Hz), non un evento
semantico per il brain.

```
/gaia/mocap/{device_id}/meta/room                      stanza corrente
/gaia/mocap/{device_id}/meta/faces|hands|poses         conteggi

/gaia/mocap/{device_id}/face/{person_id}               478 punti × (x,y,z), mesh completa
/gaia/mocap/{device_id}/face/{person_id}/lips          40 punti — solo le labbra
/gaia/mocap/{device_id}/face/{person_id}/eye_left      16 punti
/gaia/mocap/{device_id}/face/{person_id}/eye_right     16 punti
/gaia/mocap/{device_id}/face/{person_id}/eyebrow_left  10 punti
/gaia/mocap/{device_id}/face/{person_id}/eyebrow_right 10 punti
/gaia/mocap/{device_id}/face/{person_id}/nose          24 punti
/gaia/mocap/{device_id}/face/{person_id}/oval          36 punti — contorno volto

/gaia/mocap/{device_id}/hand/left/{person_id}          21 punti × (x,y,z)
/gaia/mocap/{device_id}/hand/right/{person_id}         21 punti × (x,y,z)
/gaia/mocap/{device_id}/pose/{person_id}               33 punti × (x,y,z,visibility)
```

**`person_id` è coerente tra volto/mani/posa nello stesso frame** (fix
2026-08-03): `face/0`, `hand/left/0` e `pose/0` sono garantiti essere la
stessa persona fisica in quel frame — non un'identità persistente nel
tempo (una persona può cambiare id da un frame all'altro se cambia l'ordine
orizzontale in scena, best-effort per vicinanza).

I gruppi con nome (`lips`, `eye_left`, ecc.) sono un'AGGIUNTA alla mesh
completa, stesso dato solo già suddiviso per parte anatomica — pensati per
chi non vuole ricostruire l'intera topologia dei 478 punti. Le mani (21
punti, ordine fisso e noto) non ne hanno bisogno, sono già interpretabili
così come sono.

Un messaggio per volto/mano/posa, non uno per coordinata: tutti i punti di
una parte viaggiano in un solo pacchetto UDP come lista di float.

---

## Cosa NON esiste (per evitare di cercarlo)

- Nessun "schema MQTT" a sé stante da dare a TD — MQTT è il trasporto
  interno di Gaia, TD non lo parla mai direttamente, ci arriva solo tramite
  OSC via il bridge (canale 1). Se in futuro si vuole far parlare MQTT
  nativo a TD (fattibile via Python DAT, TD incorpora un ambiente Python),
  sarebbe una scelta diversa da quella presa finora — oggi si resta su OSC
  bidirezionale perché TD lo parla già bene su tutti i canali esistenti.
- Nessuna autenticazione/sicurezza sui canali OSC — rete locale fidata,
  stesso principio del resto di Gaia (MQTT non autenticato).
