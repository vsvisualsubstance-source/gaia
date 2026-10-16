# GAIA ↔ TouchDesigner — contratto di integrazione (riferimento unico)

Documento pensato per chi lavora **lato TouchDesigner** (incluse sessioni
Claude dedicate a quel lato): riassume in un punto solo tutto ciò che serve
per parlare con GAIA via OSC, senza dover leggere il codice Node-RED o i
vari README sparsi nel repo. Per il dettaglio completo di ciascun pezzo, i
riferimenti restano `minipc/touchdesigner/README.md` e
`pi/mediapipe/README.md` — questo file è un indice/contratto, non li
sostituisce.

## I canali tra Gaia e TD — non confonderli

Sulla stessa infrastruttura esistono **quattro canali OSC indipendenti**
(dati) più **un canale MQTT** (presenza/controllo, non dati) che hanno
poco a che fare tra loro. Confonderli è l'errore più facile da fare:

| Canale | Chi parla | Porta | Cosa porta |
|---|---|---|---|
| **1. Bridge Gaia↔TD** | Core (miniPC) ↔ TD | 7000 (flatten grezzo) + 7001 (canvas curato + eventi) out / 9008 in | Stato della casa: mood, stanze, luci, persone, lessico |
| **2. Mocap diretto** | OPS → TD | 7010 default, **personalizzabile per istanza** dal 2026-10-15 (vedi sotto) | Landmark grezzi viso/mani/pose in tempo reale |
| **3. Driver Solaro DSP** | Solaro QR1 ↔ driver esterno utente | 4554-4558, 52381, ecc. | Angoli mic array, livelli audio, preset camera — **NIENTE a che fare con Gaia**, sistema audio a parte |
| **4. Controllo dispositivi** | TD (dentro il progetto) ↔ Core | MQTT, non OSC — `gaia/device/{id}/status\|command` | Non dati: presenza/controllo. Due direzioni indipendenti, vedi sotto |
| **5. Plancia → DMX Master** | Plancia (bridge.js) → **DMX Master** (TD, famiglia `dmx`), DIRETTO | **7020**, nuovo, da costruire — vedi sotto | Show control generico: scene, teste mobili, LED, blackout |

Il canale 3 non è documentato qui: è un progetto separato dell'utente, non
passa da Node-RED/MQTT. Se un lavoro riguarda quel driver, il riferimento è
altrove (memoria di progetto lato Core, non in questo repo).

### Canale 5 — Plancia → DMX Master (lavoro da fare, 2026-10-15)

Contratto completo in `plancia/GAIA_PLANCIA_INTEGRATION.md` — qui solo il
riassunto per chi prepara l'OSC In lato TD, senza dover aprire anche
quel file.

**Chi manda**: Plancia (superficie di controllo web per tablet, bridge
Node `plancia/bridge.js`) — NON passa da Gaia/MQTT per questo canale,
`bridge.js` è un relay OSC puro che instrada per prefisso (`/gaia/...`
va al canale 1 sopra, tutto il resto — `/dmx/`, `/mh/`, `/led/`,
`/show/` — va qui).

**Cosa serve costruire in DMX Master**: un **OSC In DAT nuovo**, in
ascolto sulla porta **7020** (fissa, non auto-profilata come il mocap —
un solo DMX Master alla volta), che interpreta gli indirizzi qui sotto
e li traduce in output Art-Net reale sul rig vero (oggi quegli stessi
indirizzi li simula solo in locale, nel browser, il widget "Palco" di
Plancia — DMX Master deve fare la stessa cosa ma sulle teste/LED fisici).

Mappa indirizzi completa (copiata da `plancia/README.md`, "Mappa
indirizzi dello show" — fare riferimento lì se cambia):

```
/dmx/scene                indice        richiama la scena con crossfade
/dmx/fade                 secondi       tempo di crossfade
/dmx/master                0-1          master generale
/dmx/blackout, /dmx/strobe 0/1          blackout, strobo generale
/dmx/strobe/rate           Hz           velocità strobo
/dmx/chase                 indice        Off/Lento/Veloce/Rainbow/Random/Sound
/dmx/group/front|back|mh|ledbar|ledwall|haze|blinder   0-1   livello di gruppo
/mh/select                 elenco 0/1    teste selezionate
/mh/pantilt                x y (-1..1)   pan/tilt delle teste selezionate
/mh/color                  r g b         colore
/mh/dimmer, /mh/zoom, /mh/focus   0-1    parametri
/mh/gobo, /mh/position     indice        gobo, posizione preset
/mh/strobe, /mh/home       0/1           strobo teste, reset
/led/color, /led/mode, /led/bright   r g b / indice / 0-1   contenuto LED wall
```

Tutti i numeri arrivano come float OSC (anche gli indici/0-1). Nessun
MQTT coinvolto in questo canale — è OSC puro, locale alla rete, come il
canale 2 (mocap).

**Vincolo di deploy**: Plancia (bridge+pagina) gira SOLO su OPS, mai su
Core (Core non viaggia). Quindi l'host che DMX Master vede come sender
del canale 5 è sempre OPS (`192.168.1.240`), non Core.

**In parallelo, canale 1b (design dello show, non OSC)**: proposta
(non ancora costruita) per creare/patchare le fixture DIRETTAMENTE da
Plancia invece che a mano in TD — via lo stesso meccanismo "Device TD"
già esistente (`gaia/device/td-dmx-win/command`,
`{action:"set",param,value}`), non la 7020. Una volta che le fixture
esistono (create da Plancia o a mano in TD, indifferentemente), il
canale 5 sopra (7020) le controlla dal vivo in entrambi i casi. Schema
completo e cronologia in `plancia/GAIA_PLANCIA_INTEGRATION.md`, sezione
"Canale 1b" — qui solo il riassunto per chi legge solo questo file.

**Schema reale già presente su DMX Master** (`status.params`, trovato
dal vivo 2026-10-15, diverso dalla prima proposta):
```json
{"id": 11, "name": "Head 1", "group": "heads", "unit": 1,
 "profile": "Generic Spot 11ch 16bit", "port_id": "2.1.1.2:2",
 "address": 100, "x": -9.0, "y": -3.5, "enabled": 1, "palette": "", "uid": ""}
```
Indirizzamento per `port_id` (IP:porta Art-Net reale), non un
`universe` astratto; `profile` è il nome del profilo (canali derivati
da lì); `group` qui è un raggruppamento fisico del rig (`heads`,
`rig_a`...), **non** il vocabolario `/dmx/group/...` del canale 3 —
due cose diverse, stesso nome di campo. `dmx_fixture_add`/`update`/
`remove` sono slot comando (oggi `null`, write-only). `dmx_patch_report`:
`{"id","status":"off"|"offline"|"conflict"|forse"ok","port_id","universe","start","end"}`.

**Risposta da TD (2026-10-15, TD/Win-PD 17 in `TD4Gaia`
`GAIA_INTERFACE.md`, commit `TD4DMX` `3c69e21`): entrambe le strade,
la (B) è già attiva.** Il canale 1b esiste già su DMX Master (nota 16).
- **(B)**: `dmx_fixture_add`/`dmx_fixtures` accettano la fixture
  Plancia così com'è — `{id, type, name, group, universe, address, x,
  y, enabled}`. `id` stringa → diventa il loro `uid`; `universe` →
  tradotto in `port_id`; `group` mancante/non riconosciuto dedotto dal
  `type`. `wall` e `speaker` sono saltati (non DMX-patchabili).
- **(A)**: già pubblicato. Profili per gruppo in
  `dmx_matrix.fixtures.groups[].profiles`; nodi Art-Net disponibili in
  `dmx_matrix.patch.ports` — stesso topic `gaia/devices/+/dmx_matrix`
  già sottoscritto da Plancia per il widget "Device TD" generico.
- `front`/`back`/`mh` (vocabolario live-control, canale 3) sono alias
  di `rig_a`/`rig_b`/`heads` (vocabolario fisico, canale 1b/TD): stessi
  nomi accettati su entrambi i canali, non due vocabolari davvero
  separati.

**Implementato lato Plancia**: il bottone "Manda a DMX Master"
nell'editor fixture (assente per `wall`/`speaker`) manda
`{action:"set",param:"dmx_fixture_add"|"dmx_fixture_update"|
"dmx_fixture_remove",value:{id,type,name,group,universe,address,x,y,
enabled}}` su `gaia/device/td-dmx-win/command` (stesso meccanismo
generico "Device TD" già citato sopra).

**Giro completo verificato dal vivo da TD** (nota interface 18,
TD4Gaia): add/update/remove funzionano. Tre fix lato Plancia lo stesso
giorno — TD accetta il comando anche quando lo scarta (gruppo/profilo/
indirizzo invalido), quindi ora `_synced` si marca solo dopo aver
visto l'`id` comparire come `uid` in `dmx_fixtures` (non sul semplice
invio); `uid()` lato Plancia ora ha prefisso `p-` (poteva uscire tutto
cifre, confuso con un `id` numerico di TD); l'editor mostra ora (solo
lettura) anche le fixture già patchate in TD, per non duplicarle.
Dettaglio completo in `plancia/GAIA_PLANCIA_INTEGRATION.md`.

**Nota interface 20 (TD4Gaia, 2026-10-16) — fatto lato Plancia**: TD ha
trovato 19 gruppi di doppioni sulla patch reale (ogni dispositivo con
Plancia aperta generava fixture locali con `uid` diverso) e costruito
`dmx_universe_map`/`dmx_patch_conflicts`/`dmx_patch_resolve` e
`on_conflict` (`accept`/`reject`/`auto`) su `dmx_fixture_add`/
`update`. Lato Plancia: all'apertura ricostruisce le fixture da
`status.params.dmx_fixtures` (uid `p-...`) invece che dalla copia
locale — fonte unica il palco di TD; editor con universo/indirizzo
libero reali da `dmx_universe_map`; invio con `on_conflict` invece di
scrivere doppioni alla cieca; bottone di resolve per pulire i doppioni
già presenti. Verificato dal vivo (import automatico silenzioso,
import manuale, editor con indirizzo reale). Dettaglio completo in
`plancia/GAIA_PLANCIA_INTEGRATION.md`, nota TD 20.

**Non ancora fatto**: leggere `dmx_matrix.fixtures.groups[].profiles`
per offrire una scelta reale di profilo nell'editor invece del default
automatico di DMX Master; catalogo modelli/tipi condiviso (nota
interface 19) — `FIX_TYPES.ch` è ancora fisso lato Plancia, non legge
`dmx_models`/`dmx_types`/`dmx_matrix.catalog`; `dmx_patch_check`
(anteprima batch) non usato, si manda `on_conflict` diretto su ogni
add/update.

Il canale 4 non è OSC (per questo non ha una porta nella tabella nel senso
degli altri) ed è l'unico dei quattro in cui TD *scrive* verso Gaia invece
di limitarsi a leggere — vive interamente dentro il `.toe`, due moduli
indipendenti che possono coesistere:
- `td_internal_agent.py` — TD *come device*: fa sapere ad Admin che
  quell'istanza esiste ed è controllabile (enable/disable/restart).
- `td_service_control.py` — TD *come controllore*: ascolta lo stato di
  tutti i device (Pi/OPS/Core) e può avviarne/fermarne i servizi — stesso
  play/stop/restart che fa Pi Manager nel browser, nativamente da TD.

Setup e dettagli di entrambi: `minipc/touchdesigner/README.md`, sezione
"Controllo dispositivi da dentro TD".

---

## Canale 1 — Bridge Gaia↔TD (`minipc/touchdesigner/osc_bridge.py`)

Host Core: `192.168.1.142`. Servizio: `gaia-touchdesigner.service`. Il
processo stesso resta sul Core, MA la sua **sorgente dati** (`GAIA_WS_HOST`,
la WS `/gaia` di Node-RED che legge per costruire il feed OSC) da qui in
avanti **non è più `localhost`/Core**: dal cutover Node-RED→OPS del
2026-08-08 (vedi `docs/core-distribuito.md`, sezione "Runtime attuale"),
Node-RED gira su OPS — `GAIA_WS_HOST` va impostato a `192.168.1.240` in
`/etc/gaia/touchdesigner.conf` (non versionato, default nel codice resta
`localhost` in `config.py`, va sovrascritto su questa macchina). Senza
questo, il bridge entra in un loop di riconnessione silenzioso — nessun
errore visibile, il feed OSC semplicemente si ferma (già capitato in
produzione la mattina dopo il cutover). MQTT e le porte OSC (7000/7001/9008)
restano invariate, ancorate al Core come sempre — solo la sorgente WS è
cambiata.

**Multi-istanza (2026-08-06)**: il bridge manda lo stesso feed a TUTTE le
istanze TD vive contemporaneamente — le scopre da sé via MQTT
(`gaia/device/+/status`, `role=="touchdesigner"`), nessun IP fisso in
config. Basta che l'istanza TD esponga il proprio `ip` nello status
(canale 4, sotto) perché il bridge inizi a mandarle il feed. Da Admin
(Pi Devices → "🌉 TouchDesigner — Flussi OSC") si può mettere in pausa il
feed verso UNA istanza specifica senza toccare le altre — vedi README.md.

### Gaia → TD (Core manda, TD ascolta)

Il flatten filtrato (sotto) resta sulla **porta 7000**. **Tutto il resto**
(feed curato canvas, tick continuo E eventi one-shot) va sulla **porta
7001** — vedi la sezione dedicata più sotto per il perché.

- **`/gaia/...`** — **FILTRATO dal 2026-08-08** (`_scope_for_td()` in
  `osc_bridge.py`), non più il flatten grezzo di tutto il payload
  dashboard. Fino ad allora mandava tutto (~1900 indirizzi misurati,
  arrivati a **9474 canali live** lato TD — ogni sotto-campo, es. mocap
  x/y/z, contava a parte) come firehose/debug — TD/Mac ha verificato
  ogni consumer reale (2 round di audit: prima solo testo DAT/espressioni,
  poi anche il valore RAW `par.val` dei parametri `chops` dei select
  CHOP — il primo round aveva perso 4 categorie intere, causando errori
  di cook attivi in produzione prima di essere corretto; vedi
  `GAIA_INTERFACE.md` "TD/Mac, 2" e "TD/Mac, 5" per il dettaglio) e ora
  **solo questi campi vengono mandati**:

  | Chiave | Cosa contiene | Filtrato a |
  |---|---|---|
  | `people` | lista persone presenti | tutto (name/stanza/emozione/affinity/visits/confidenza/...) |
  | `rooms` | dato per stanza | solo `id`, `objects` (oggetti YOLO), `persons_count` |
  | `vision/rooms` | mirror di `rooms`, namespace separato | solo `id`, `mediapipeActive`, `mediapipe` (usato da `script_mediapipe_agg` per la sfera reattiva al sorriso) |
  | `metrics` | contatori aggregati | solo `activeLights`, `activePeople`, `averageLight` |
  | `soul` | mood corrente | tutto (mood/lifeIndex/stress/calm/social/curiosity/energy) |
  | `lights` | luci Hue reali | solo `id`, `brightness`, `power`, `motion` (per tutte le luci, non solo quelle usate oggi — niente elenco nomi hardcoded) |
  | `stats` | conteggi totali | solo `totalPeopleCount` |

  **Tutto il resto del payload dashboard NON viene più mandato su questo
  canale**: `plants`, `sensors`, `progression`, `thought`, `lastMemory`,
  `lastDream`/`lastDreamWords`/`lastDreamTs`, `roomGraph`/
  `roomGraphLearned`, `events`, `hourlyStats`, `voiceStatus`/
  `voiceCommands`/`tts`, `herbarium`, e i campi di `rooms`/`lights` non
  elencati sopra (`temperature`, `color`, `colorTemp`, `activity`,
  `currentEmotion`, `scene`, ecc.). Nessuno di questi aveva un consumer
  verificato in TD al momento del filtro. **Se in futuro TD inizia a
  leggere un campo qui sotto, aggiungerlo a `_scope_for_td()`** — il
  canale 2 curato (porta 7001, sotto) resta comunque la via preferita
  per dati nuovi, mai aggiungere qui senza verificare prima se ha senso
  spostarlo lì invece.

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
/gaia/canvas/lights/{itemId}/power, brightness, color   luci pulite per DMX
/gaia/canvas/lights/{itemId}/colorTemp        0-100% (item Hue *_Color_Temperature, 0=2000K caldo, 100=6500K freddo)
/gaia/canvas/lights/{itemId}/colorTempKelvin  Kelvin assoluto — usa la lettura reale (*_Color_Temperature_Abs)
                                               se sana, altrimenti derivato dalla % (aggiunto 2026-08-05)
/gaia/canvas/bricks/{id}/...           variant, room, temperature, humidity, vibration
/gaia/canvas/lexicon/{parola}/count, seed    lessico personale di Gaia
/gaia/canvas/dream/mood, words/{parola}/seed ultimo sogno notturno
```

**GOTCHA `{itemId}` in `lights/`**: `brain.lights` ha una entry per ogni
*item* OpenHAB, non una per lampadina fisica — `Sala_Potenza`,
`Sala_Luminosita`, `Sala_Colore` e `Sala_Color_Temperature` sono quattro
indirizzi OSC separati, ognuno con solo il proprio campo valorizzato (gli
altri restano ai default). Per ricostruire una lampadina in TD, raggruppa
gli `{itemId}` per prefisso comune (`Sala`, `Soggiorno`, `luce_Ingresso`,
`Zona_Notte_Zone`, `Area_TV_Zone`, `Luce_Salotto`, `Luce_Corridoio` —
stessa mappa di [docs interne] `ROOM_ITEM_PREFIX`).

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
TD sulla porta **7010 di default** (indirizzi nel namespace `/gaia/mocap/...`
— TD li distingue dal canale 1 per porta, non più per prefisso sulla
stessa 7000 come in origine: cambiato il 2026-09-29 perché un progetto
con sia un OSC In CHOP del canale 1 sia il mocap entrambi sulla 7000
falliva il bind per davvero). I DATI bypassano Core/Node-RED (è mocap ad
alta frequenza, ~12Hz, non un evento semantico per il brain) — la
SCOPERTA/abilitazione delle destinazioni invece passa da MQTT (vedi
sotto), come tutto il resto del Device Registry.

**Multi-istanza, opt-in (2026-08-06)**: a differenza del canale 1 (che ora
va a TUTTE le istanze TD automaticamente), il mocap NON fa fan-out
automatico — è pesante (centinaia di punti a ~12Hz), mandarlo a ogni TD
scoperta sarebbe uno spreco per chi non lo usa. Default che preserva il
comportamento di sempre: **solo l'istanza TD sulla STESSA macchina** del
sender si autoabilita. Ogni altra istanza (es. mandare a un Mac il mocap
generato su OPS) va abilitata esplicitamente da Admin (Pi Devices →
"🎭 Mocap diretto") o via MQTT: `gaia/mocap-bridge/{sender_device_id}/command`
`{"device_id":"<td-id>","action":"enable"|"disable"}`, stato su
`gaia/mocap-bridge/{sender_device_id}/status` (retained) — `{sender}` è il
`device_id` di chi genera il mocap (es. `ops-silvermini2`), non della TD.

**Porta per istanza (2026-10-15)** — risolve il conflitto reale di più
istanze TD sulla stessa macchina che vogliono ricevere mocap: ognuna
ascoltava di default sulla stessa 7010 fissa, bind in conflitto fra loro.
Ogni istanza TD può ora annunciare la propria porta col campo opzionale
`mocap_port` (intero) dentro il proprio `gaia/device/{id}/status` — se
presente e valido, `_MocapTargetRegistry` (lato mediapipe) manda il
mocap lì invece che sul default 7010, per QUELLA istanza. Senza il
campo (o con `mocap_port` assente/non valido), comportamento di sempre.
Lato TD basta impostare il parametro `Mocapport` sul COMP dell'agent
(`minipc/touchdesigner/td_internal_agent.py`, già aggiornato per
pubblicarlo) e far ascoltare il proprio OSC In su quel numero — fatto
questo, l'istanza riceve il mocap sulla porta giusta al prossimo
heartbeat (max 30s), senza nessuna mappa device→porta da mantenere né
lato TD né lato Gaia. **Attenzione**: cambiare SOLO `Mocapport` senza
spostare anche l'OSC In reale di TD su quella porta interrompe il mocap
per quell'istanza (Gaia manda dove annunci, se lì non ascolta nessuno il
dato si perde silenziosamente).

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
