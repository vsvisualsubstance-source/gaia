# GAIA semantico — la base solida per N device consapevoli

Design 2026-07-09 (richiesta utente: "base super solida" prima dei prossimi moduli).
Visione: ogni nuovo device (Pi, OPS, core, futuro) si accende, dichiara **chi è, cosa ha,
cosa sa fare**; il Core lo colloca nello spazio (stanza, vicini), attiva i moduli giusti
per l'hardware presente, e usa i flussi AV di tutti per la coscienza spaziale di Gaia
(chi parla dove, com'è fatta la casa) — con la videosorveglianza come sottoprodotto.

## Cosa esiste GIÀ (non ripartire da zero — estendere questo)

| Pezzo | Dove | Stato |
|---|---|---|
| Rilevamento hardware | `pi/agent/agent.py::detect_capabilities()` | embrione: camera+mic, già nel payload status |
| Manifest per-macchina | `/etc/gaia/services.json` (Fase 0) | fatto: dichiara cosa PUÒ girare |
| Device Registry + stanza | Node-RED `DeviceRegistry`, topic retained `gaia/devices/{id}/config` | fatto, con verifica YOLO |
| Firme semantiche stanza | `ROOM_SIGNATURES` (oggetti YOLO tipici per stanza) | fatto: già "capisce" se il claim stanza è plausibile |
| Stream camera consumabile | MJPEG `:8766` su minipc/OPS (`minipc/camera`) | manca su `pi/camera` (solo shared-memory) |
| Identità/presenza centrale | face service (snapshot MQTT), brain.presence | fatto |
| Voce per stanza | `gaia/voice/stats|status/{stanza}` | fatto (minipc, ingresso, cucina) |

## I 4 contratti da standardizzare (la "base solida")

### 1. Profilo semantico del device (chi sono, cosa ho, cosa offro)
Topic retained `gaia/devices/{id}/profile`, pubblicato dall'agent al boot e a ogni cambio:
```json
{
  "device_id": "ops-silvermini2",
  "role": "ops",                      // dal manifest
  "room": "cucina",
  "capabilities": {                   // HARDWARE rilevato (esteso da camera+mic)
    "camera": true, "mic": true, "audio_out": true,
    "display": true, "touch": true, "midi": [], "gpio": false
  },
  "services": {                       // cosa GIRA e come consumarlo
    "camera":   {"state": "active", "endpoints": {"mjpeg": "http://192.168.1.239:8766/video"}},
    "voice":    {"state": "active", "endpoints": {"tts": "gaia/voice/tts/cucina"}},
    "mediapipe":{"state": "active"}
  },
  "sw_version": "1.0.2", "ts": 0
}
```
Gli `endpoints` sono la chiave: chiunque (welcome, scene worker, sorveglianza, altro device)
scopre DOVE consumare un flusso senza hardcodare IP. Implementazione: estendere il payload
status esistente (già ha capabilities/services) — un campo in più, non un sistema nuovo.

### 2. Capability → moduli (l'hardware decide cosa si attiva)
Mappa unica sul Core (Node-RED o gaia_admin):
```
camera        → camera_server, yolo, mediapipe
mic           → voice
audio_out     → tts locale, mediaplayer
display/touch → kiosk welcome (URL con ?cam=&room= già pronto)
midi/i2c      → av-herbarium
```
Al primo announce di un device nuovo, il Core risponde (oltre alla stanza) con i **moduli
suggeriti** per le sue capability; Pi Manager li mostra come "attivabili" (opt-in, mai
auto-start di default — le sorprese in una casa non piacciono). `detect_capabilities()`
va esteso: audio_out (aplay -l / SoundVolumeView su Win), display (X/EDID / Win API),
midi (aconnect -l / mido), i2c (bus scan).

### 3. Grafo delle stanze (vicinato spaziale)
- **v1 (subito, statico)**: mappa dichiarata nel brain — `brain.roomGraph =
  {ingresso: [corridoio], corridoio: [ingresso, salotto, cucina], ...}` — bastano 5 righe
  e sblocca "chi è vicino a me": `neighbors(device) = device della stessa stanza +
  stanze adiacenti`.
- **v2 (imparato)**: le transizioni di presenza sono GIÀ in `brain.events` (person exit
  ingresso → enter salotto entro pochi secondi = arco di adiacenza). Un contatore di
  co-transizioni costruisce il grafo da solo e corregge la mappa statica.

### 4. Rete AV: LAN piatta per i flussi, Tailscale per la gestione
**Policy**: tutto ciò che streama (MJPEG, audio, futuro icecast) resta in LAN — banda,
latenza, privacy (mai flussi video fuori casa). Tailscale = canale di amministrazione e
fallback (SSH, rsync, emergenze). Conseguenza pratica: il Pi ingresso dietro il NAT Google
va **riportato sulla LAN principale** quando diventa sorgente AV consumata da altri (oggi
il suo video esce solo come snapshot MQTT, che il NAT non blocca — quindi non urgente).

## Sopra la base: coscienza spaziale (in ordine di costo)

1. **MJPEG su pi/camera** — porting dalla versione minipc (stessa architettura seqlock).
   Sblocca: kiosk ovunque, scene worker, griglia sorveglianza.
2. **Chi sta parlando** — correlazione già possibile col dato esistente: stanza con
   `voice state=recording|processing` + mediapipe `mouth_open=true` + identità face della
   stessa stanza ⇒ `brain.rooms[X].speaking = "mauro"`. Solo logica brain, zero hardware.
3. **Scene worker sul Core** — ogni N minuti (o su evento) prende un frame da ogni MJPEG e
   lo descrive con un piccolo VLM locale (moondream/llava via Ollama, ~2GB) →
   `brain.rooms[X].scene = "cucina con tavolo in legno, finestra a destra, due sedie..."`.
   Nutre i Pensieri Profondi e dà a Gaia l'idea di COM'È FATTA la casa, non solo di chi
   c'è. Le ROOM_SIGNATURES yolo restano il check veloce; il VLM è il livello ricco.
4. **Sorveglianza v1** — pagina web griglia di tutti gli MJPEG (`cameras.html`, riusa il
   profilo per scoprire gli endpoint). v2: clip su evento (yolo person + orario notturno →
   salva frames su D). Se un giorno serve NVR vero: Frigate in docker sul Core (pesante,
   valutare solo con hardware Core dedicato).

## Stato implementazione (2026-07-09, sessione F1-F5)

- **F1 profilo semantico: FATTO** — i 3 agent pubblicano `gaia/devices/{id}/profile`
  (retained, con endpoint); `ProfileRegistry` in brain.devices; `GET /gaia/devices/profiles`.
- **F2 MJPEG ovunque: FATTO** — porting su pi/camera (encode solo con client connessi,
  MJPEG_PORT=0 per spegnere); `cameras.html` = griglia sorveglianza v1 a scoperta
  automatica dai profili; link nelle nav.
- **F3 room graph + chi parla: FATTO** — `brain.roomGraph` statico (IPOTESI da far
  correggere all'utente!) + `roomGraphLearned` dalle co-transizioni di presenza (<20s);
  `SpeakerAttribution` (voice recording + mediapipe mouth_open + identità) →
  `rooms[].speaking` nel payload WS.
- **F4 capability→moduli: FATTO** — detect esteso (audio_out, display, midi[], i2c;
  su Windows cache + MAI probare la webcam: è esclusiva); `CAP_MODULES` in
  ProfileRegistry → `suggested_modules` nei profili. Il Pi ingresso già suggerisce
  av-herbarium (ha i2c+audio). UI in Pi Manager: da fare.
- **F5 scene worker: FATTO** — `minipc/script/scene_worker.py` (servizio `scene` del
  local_agent, moondream via Ollama, 1 frame/camera ogni 15min) → `gaia/scene/{room}`
  → `rooms[].scene` nel brain/WS + scena nel prompt dei Pensieri Profondi.

Rimasti: UI moduli suggeriti in Pi Manager · correzione roomGraph dall'utente ·
sync bocca/voce per lo speaking multi-persona · registrazione clip sorveglianza (v2).

## Fasi consigliate

1. **Profilo semantico** (contratto 1): estendere status/announce dei 3 agent + registry.
2. **MJPEG su pi/camera** + `cameras.html` (griglia) — subito utile, valida gli endpoint.
3. **Room graph v1 + "chi parla"** — solo brain, alto valore per la coscienza.
4. **Capability estese + mappa moduli** (contratto 2) — quando arriva il prossimo device
   nuovo (o l'hardware herbarium) la si prova sul campo.
5. **Scene worker VLM** — quando il Core ha respiro (o dopo la separazione fisica Core).

Regola trasversale: ogni pezzo nuovo parla MQTT col contratto del profilo, mai canali
privati — è ciò che rende il sistema scalabile "a prescindere da cosa si collega".

## Stanze vs Device (2026-07-13)

**Principio: le stanze sono luoghi, i device sono sensori mobili.** Tutto ciò che
riguarda l'*identità fisica* (dataset wakeword, modelli, calibrazioni mic) segue il
**device_id** — i mic non cambiano acustica spostandosi di poco, e soprattutto i
campioni non devono mai finire nel dataset di un'altra macchina
(`GAIA_WW_DIR_BY_DEVICE` in gaia_admin.py; i voice mandano `device_id` nel sample).
Tutto ciò che riguarda il *contesto* (topic tts/command/status, presenze, scene,
speaker attribution) segue la **stanza assegnata** nel Device Registry.

**Cambio stanza — endpoint CANONICO: `POST /api/provision/assign`** (gaia_admin.py,
porta 8765; usato da Pi Manager "💾 Salva" dal 2026-07-20). È l'unico che
sincronizza TUTTI E TRE i registri in un colpo solo:
1. `provision_registry.json` (gaia_admin) — **letto dall'agent ad OGNI riavvio
   del processo** (`_provision_register()` in agent.py, non solo al boot del
   Pi: anche in un crash-loop). Se resta indietro, la prossima volta che
   l'agent si riavvia la stanza TORNA a quella vecchia, silenziosamente.
2. Registro Node-RED (`POST /gaia/device/assign` interno) — config retained +
   **auto-pulizia** della stanza vecchia se resta senza device (dati live in
   brain.rooms + clear dei retained `gaia/scene/{room}` e `gaia/voice/status/{room}`).
3. Comando diretto `set_config` all'agent via MQTT — applica subito se online.

**Bug reale successo il 2026-07-19/20** (device pi-fd75d8, cucina→ingresso):
un assign fatto chiamando SOLO il registro Node-RED (punto 2, via curl diretto)
ha lasciato indietro `provision_registry.json` (punto 1). Al riavvio successivo
dell'agent — innescato da un restart di mosquitto che ha mandato l'agent in
crash-loop — `_provision_register()` ha richiesto la stanza a gaia_admin e si
è visto rispondere "cucina", tornando indietro. Il bottone "💾 Salva" del Pi
Manager aveva lo STESSO buco dal lato opposto (mandava solo il punto 3, via
MQTT diretto dal browser, saltando 1 e 2) — corretto nello stesso commit.
**Non chiamare mai `/gaia/device/assign` o un `set_config` diretto da soli:
sempre `/api/provision/assign`.**

**Pulizia manuale** (stanze sbagliate/orfane):
- `GET  /gaia/rooms` — stato stanze: device assegnati, in_map, scene, presenze
- `POST /gaia/rooms/clean {room, force?}` — rimuove dati live, archi nei grafi
  APPRESI (learned/motion) e retained; rifiuta se la stanza ha device (409)
- admin.html → Pi Manager → bottone "🧹 Stanze orfane"

La mappa disegnata (`roomGraph`, ora `_v:3` con `soggiorno`) non viene mai toccata
dalla pulizia: quella è la casa, non i dati.

Nota storica: il device `ops-silvermini2-mp` era un RELITTO del mediapipe
standalone pre-manifest (muto da 9 giorni) — rimosso il 2026-07-15 con il
nuovo `POST /gaia/device/forget {device_id}` (rifiuta se il device è vivo,
pulisce entry nel registry + retained config/profile/status). Il mediapipe
attuale eredita DEVICE_ID dall'agent: nessuna doppia identità.

## Contratto Agent Universale — proposta 2026-08-30 (IN REVISIONE, niente costruito)

**Why:** richiesta esplicita dell'utente ("chi sono, dove sono, cosa faccio,
che servizi offro... ma in una visione più aperta") dopo il lavoro di questa
sessione su palette/kick/device TD in `index.html`/`game.html` e sulle piante
posizionate per stanza — l'idea è dare a QUALSIASI agent Gaia (non solo i
mattoni) un modo di dichiarare la propria posizione in modo più ricco di un
semplice nome-stanza.

**Punto di partenza, non ripartire da zero**: verificato oggi che esistono
già 3 pezzi separati che rispondono ciascuno a un pezzo della domanda, mai
riconciliati tra loro:

1. **Contratto 1 sopra (profilo semantico, 2026-07-09)** già risponde a "chi
   sono / cosa ho / cosa offro" per OGNI agent (Pi/OPS/Core): `device_id`,
   `role`, `room`, `capabilities`, `services` (con `endpoints`), `sw_version`.
2. **`family`** (aggiunto 2026-08-29, SOLO per gli agent TD — vedi
   TD4Gaia/`GAIA_INTERFACE.md` sezione "1b"): distingue il PROGETTO
   (dmx/patchdeck/mixeraudio/gaia/...) dall'ISTANZA (`device_id`) — un
   livello che il Contratto 1 originale non aveva previsto, mai generalizzato
   agli agent non-TD.
3. **Il modello "mattone"** (`esp/sim/brick_node.py`, `web/mattoni.html`,
   2026-07-24): `position.neighbors` (`nord`/`sud`/`est`/`ovest`/`sopra`/
   `sotto`, verso ALTRI device_id) + `interfaces` (`power`/`data`/`mesh`) —
   **verificato dal vivo per la prima volta oggi** (mai testata la resa
   visiva prima d'ora): funziona, mappa emergente corretta, nessun piano
   centrale. Ma resta un'isola: SOLO i mattoni lo usano, e non è mai stato
   collegato al `roomGraph` (Contratto 3 sopra).

**Il gap concreto**: oggi esistono DUE sistemi di "dove sono" che non si
parlano — il `roomGraph` (stanze come nodi con nome, adiacenza SENZA
direzione, quello usato da `index.html`/`game.html` per il layout 3D
tutta questa sessione) e `position.neighbors` dei mattoni (direzione VERA
N/S/E/O, ma solo tra device, mai a livello di stanza). Un mattone in
"ingresso" e un Pi in "ingresso" condividono solo il nome stanza, non un
riferimento spaziale comune.

### Proposta (in revisione — NON costruita, da discutere prima di scrivere codice)

**A. Generalizzare `family` a tutti gli agent**, non solo TD — stringa
libera opzionale (`"pi-agent"`, `"ops-agent"`, variante mattone, ecc.),
stesso trattamento già in uso per TD (minuscolo sempre, mai dedotto dal
device_id). Costo quasi zero: il campo esiste già nel protocollo, solo
il consumo lato Node-RED (`brain._tdDeviceFamily`, oggi popolato solo da
`td_room_presence_fn`) andrebbe generalizzato a QUALSIASI `role`.

**B. Estendere il `roomGraph` con `neighbors` direzionali OPZIONALI per
stanza** — stesso vocabolario dei mattoni (`nord`/`sud`/`est`/`ovest`/
`sopra`/`sotto`), scritti a mano nello stesso punto dove oggi vive
l'adiacenza (`GAIA Brain`, Node-RED). Retrocompatibile per costruzione:
una stanza senza `neighbors` dichiarati si comporta esattamente come
oggi (solo adiacenza, nessuna direzione) — non è un cambio di schema,
un'aggiunta.

**C. Un agent qualsiasi può opzionalmente dichiarare la propria
posizione LOCALE dentro la stanza**, non solo "sono in salotto" ma "sono
a nord nel salotto, vicino a X" — riuso letterale di
`position.neighbors`, esteso da "solo mattone↔mattone" a "qualunque
device↔device nella stessa stanza". Un device che non lo dichiara
resta come oggi (solo `room`, nessuna posizione locale) — di nuovo
additivo, non un requisito.

**D. `index.html`/`game.html`**: quando esistono `neighbors` direzionali
per le stanze, usarli per un layout spaziale REALE invece del BFS
approssimato attuale (`computeRoomLayout`) — con fallback identico a
oggi per il grafo senza direzioni. Non cambia nulla per l'utente finché
nessuna stanza ha `neighbors` dichiarati.

**E. `web/mattoni.html` e la scena 3D restano DUE viste diverse dello
stesso mondo**, non da fondere in una sola pagina — ma un mattone con
`room` valorizzato potrebbe comparire anche in `index.html`/`game.html`
come oggetto nella sua stanza, stesso pattern già in produzione oggi per
i device TD e le piante (stessa sessione, vedi [[project-gaia-web]] in
memoria).

### Domande aperte, da rispondere PRIMA di scrivere codice

- Chi scrive i `neighbors` direzionali delle STANZE (punto B)? A mano nel
  `roomGraph` come l'adiacenza esistente, o serve un editor dedicato in
  Admin? Il `roomGraph` oggi è scritto direttamente nel codice di `GAIA
  Brain` — un errore lì è "silenzioso" finché qualcuno non nota il layout
  storto (è già successo, vedi correzioni di questa sessione).
- Punto C ha senso PRIMA di avere un secondo device (oltre ai mattoni) che
  lo dichiari davvero, o è prematuro senza un caso d'uso reale?
- Punto E: collegare SUBITO i mattoni alla scena 3D, o prima chiudere il
  contratto generale (A-C) così i mattoni non restano l'unico caso che lo
  usa per davvero?
- Il vocabolario `nord`/`sud`/`est`/`ovest` presuppone un orientamento
  reale della casa (rispetto a cosa? bussola vera, o solo "convenzione
  interna coerente")? I mattoni oggi non lo specificano — va chiarito
  prima di scriverlo anche per le stanze, altrimenti "nord" significa
  cose diverse in punti diversi del sistema.

## Robustezza (2026-07-15)

- **Backup notturno** (cron core 03:30, `minipc/script/gaia_backup.sh`):
  campioni wakeword, faces, voice_db, brain/memories/thoughts, flows →
  /media/core/D/backups/gaia + Pi ~/gaia-backup. Esito retained su
  `gaia/backup/status`.
- **Health check** (tab Device Registry, ogni 60s): device muto >3 min →
  alert Telegram con messaggio di rientro; dead-man backup (>26h o fallito).
  Gotcha: un full-deploy riconsegna i profili retained e azzera i lastSeen —
  nei 3 minuti dopo un deploy gli offline sono mascherati.
- **Web UI versionata**: /media/core/D/gaia-web è un symlink a `web/` nel repo.
