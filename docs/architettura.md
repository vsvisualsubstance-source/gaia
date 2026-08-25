# Architettura Gaia — mappa di sistema

Riferimento interno, aggiornato 2026-08-25. Copre la topologia fisica, il
protocollo comune degli agenti (Pi/OPS/Core/TouchDesigner), come le pagine
web parlano col sistema, e il canale di collaborazione con la sessione
TD/Mac. Complementa `README.md` (struttura repository, componenti software)
e `docs/discovery-protocol.md` (dettaglio scoperta/fallback rete) — non li
sostituisce.

## 1. Topologia

Tutto passa dal broker MQTT su Core. Node-RED — orchestrazione e Device
Registry — vive su OPS dall'8 agosto 2026; Core resta il nodo di rete
(broker, LLM locale, memoria). Pi, OPS e il Mac TouchDesigner sono client
alla pari verso il broker, nessuna gerarchia tra loro.

```
                         LAN 192.168.1.0/24
┌───────────────────────┐        ┌──────────────────────────┐
│  RASPBERRY PI × N      │        │  OPS — Windows            │
│  (una per stanza)      │        │  192.168.1.240 · pre-prod │
│                        │        │                            │
│  pi/agent — systemd,   │        │  Node-RED :1880            │
│    OTA                 │        │    Device Registry          │
│  camera + YOLO +       │        │    orchestrazione/brain     │
│    MediaPipe           │        │    web statico (gaia-web)   │
│  voice — wakeword/     │        │  ops/agent.py — camera/     │
│    STT/TTS             │        │    yolo/mediapipe/voice/    │
│  kiosk / mediaplayer   │        │    kiosk                    │
│                        │        │  td-silvermini2 (TD Agent)  │
│  discovery: beacon →   │        │    istanza TD locale        │
│    mDNS → Tailscale    │        └──────────────┬─────────────┘
│    (fallback)          │                       │ status/command
└───────────┬────────────┘                       │
            │ status/command                     │
            │            ┌──────────────────────▼──┐
            │            │        CORE — miniPC      │
            └───────────►│   192.168.1.142 · Linux   │◄───────────┐
                         │                            │            │
┌───────────────────────┐│  mosquitto MQTT            │  status/command/set
│  BROWSER — LAN         ││    :1883 lan · :9001 ws    │            │
│                        ││  Ollama — LLM locale       │ ┌──────────┴────────────┐
│  admin · dashboard ·   ││  Qdrant — memoria          │ │  MAC — TouchDesigner   │
│    welcome              │  OpenHAB — luci/sensori    │ │  192.168.1.135 · dev   │
│  patchdeck · mixer-     ││  gaia_admin.py :8765       │ │                        │
│    audio · dmx          ││  local-agent (device Core) │ │  PatchDeck — mixer 48ch│
│                        │└──────────────▲─────────────┘ │  ControllerV7 — audio  │
│  mqtt.js — publish/     │               │ HTTP :1880    │  DMX × N scenari       │
│  subscribe diretto dal  │               │ (Device        │    — chase             │
│  browser, nessun        └───────────────┘  Registry,     │  ognuno: gaia_device_  │
│  backend nuovo                              web)         │    agent.py nativo,    │
│                        WS :9001 (controllo live)          │    Envoy/MCP → §4      │
└────────────────────────┴─────────────────────────────────┴────────────────────────┘
```

**Fallback Tailscale**: quando un Pi (o altro device) è fuori dalla LAN di
Core, `net_resolve.py` prova prima l'IP LAN poi l'IP Tailscale — stesso
principio ovunque nel repo, dettaglio completo in
`docs/discovery-protocol.md`.

**N macchine, un solo agent** (`docs/core-distribuito.md`): qualunque
macchina nuova (Pi, OPS, Core, o una futura macchina "media" per
streaming) usa lo stesso agent — un manifest per-macchina
(`/etc/gaia/services.json`, campo `machine_role`) dichiara quali servizi
PUÒ ospitare; Pi Manager la vede automaticamente, zero lavoro UI in più.

**Attenzione fisso vs dinamico** (bug reale successo due volte in
produzione — Pi Manager e `musica.html` con la WS risolta erroneamente
verso OPS): `mosquitto` (:1883/:9001), `gaia_admin.py` (:8765) e
`gaia-camera` (:8766) restano **sempre su Core**, IP esplicito — non
seguono mai `location.hostname`. Solo **Node-RED** (:1880) è dinamico e
segue la macchina che lo ospita davvero (oggi OPS). Non confondere "dove
gira Node-RED" con "dove vive il broker".

## 2. Il motore cognitivo — Node-RED (`gaiaBrain`)

Node-RED (su OPS) non è solo il Device Registry — ospita lo **stato
cognitivo centrale** (`global.get('gaiaBrain')`: rooms, people, soul/mood,
progression RPG, lights, sensors, plants, thoughts, memories, dreams) e la
pipeline che lo alimenta e lo racconta.

```
SORGENTI                     NODE-RED (gaiaBrain)                USCITE
┌────────────────┐          ┌──────────────────────┐          ┌────────────────────────┐
│ Pi/OPS frame     │─────────►│                        │─────────►│ WS ws://host:1880/gaia   │
│ YOLO/MediaPipe   │          │  gaiaBrain              │          │  dashboard · welcome ·  │
│                  │          │  rooms · people ·       │          │  gaia-art (ogni tick)   │
│ Hue via OpenHAB   │─────────►│  soul/mood · lights ·   │          └────────────────────────┘
│ (regola busmqtt,  │ HueNorm │  sensors · plants ·     │
│ Docker :8080)     │          │  progression RPG        │          ┌────────────────────────┐
│                  │          │                        │─────────►│ Pensieri Profondi        │
│ Mattoni ESP32     │─────────►│                        │          │  (dettaglio sotto)       │
│ (BrickNorm,       │          │                        │          └────────────────────────┘
│ simulatore)       │          │                        │
│                  │          │                        │          ┌────────────────────────┐
│ Voce / comandi     │─────────►│                        │─────────►│ Bot Telegram             │
│ Telegram          │          │                        │          │  /stato /attiva /dillo… │
└────────────────┘          └──────────────────────┘          │  + linguaggio naturale   │
                                                                │  → Hue via OpenHAB       │
                                                                └────────────────────────┘
```

**Hue/OpenHAB**: OpenHAB gira in Docker su Core (`:8080`). Una regola
(`busmqtt`) pubblica ogni cambio del gruppo `gAllHueDevices` su
`openhab/hue/{Item}/state`, letto da Node-RED (`HueNorm`) e scritto in
`brain.lights`. I comandi vanno nella direzione opposta: `POST
http://localhost:8080/rest/items/{Item}` (testo semplice, nessuna auth
richiesta per un item già esistente — solo la creazione di nuovi item via
REST la richiede). Il bridge fisico (Hue Bridge Pro, sostituito il
2026-08-22) è raggiunto in API v1 con bridge-id fisso `4c442d6265`: l'IP
del bridge è riconfigurabile senza toccare i ~90 item/canali OpenHAB
esistenti, perché il bridge-id (non l'IP) è ciò che li lega.

**Telegram**: una sola function Node-RED ("Gestisci messaggi Telegram", 3
output: chat/reply/mqtt-array) gestisce sia i comandi slash (`/stato`,
`/attiva`, `/musica`, `/promemoria`, `/dillo`, `/sogno`, `/aiuto`) sia il
linguaggio naturale per le luci Hue (scene, colori, percentuali) — quello
che non matcha nessun pattern cade a conversazione libera via Ollama.
Dietro le quinte quattro canali MQTT: `gaia/notify/telegram` (solo
Telegram), `gaia/echo/say` (solo Echo, via binding amazonechocontrol di
OpenHAB), `gaia/voice/tts/{stanza}` (solo voce locale Piper), e
`gaia/notify/all` (fan-out sui tre sopra, per automazioni future).

**Mattoni ESP32** (`esp/sim/brick_node.py`, oggi un simulatore Python, non
firmware reale — la roadmap ESP32/Arduino vera non è ancora iniziata,
bassa priorità): parla lo stesso protocollo MQTT di Pi/OPS
(announce/config/profile/comandi), esteso con due campi del "DNA
Costruttivo" del progetto sorella **Casa Zero** (casa stampata in 3D,
repo separato) — `interfaces` (power/data/mesh) e `position.neighbors`
(topologia locale dichiarata dal nodo stesso, nessuna mappa centrale).
`web/mattoni.html` calcola la mappa emergente via BFS dalle relazioni di
vicinato — stesso principio del Device Registry, ma senza un grafo
autorevole preesistente.

### Pensieri Profondi — la pipeline cognitiva

```
evento (presenza, voce, tick)
   │
   ▼
Cognitive Trigger  (filtro + throttle 3 min)
   │
   ▼
Prepara Query LTM ──► Qdrant recall :8000  (memoria episodica)
   │
   ▼
Inietta Memoria + brain.memories  (ultimi 3 riassunti notturni)
   │
   ▼
Build Prompt (Contestuale)  — mood + lexicon (parole ricorrenti) + maturità RPG
   │
   ▼
Ollama qwen2.5:3b-instruct
   │
   ▼
Extract Thought & Push TTS ──► brain.thoughts (max 300) ──► payload WS "thought"
   │
   ▼
QdrantStore  (persiste il pensiero)

── ogni notte, ore 21:00 ──────────────────────────────────────────────────
Night Reflection ──┬─► Night Summary Prompt (riassume brain.diary)
                    └─► Night Dream Prompt (temperature 1.15, libera associazione)
                          │                                    │
                          ▼                                    ▼
                 Save Daily Memory                        Save Dream
                 brain.memories (365 gg)                  brain.dreams (30, viola)
                                                                │
                                                                ▼
                                                  gaia/brain/dream (MQTT retained)
                                                  → stile asemico "dream" · /sogno Telegram
```

**Modelli Ollama** (Docker su Core, nessuna GPU — Intel HD 530, scelta
modelli piccoli deliberata): `qwen2.5:3b-instruct-q4_K_M` (tutti i prompt
di conversazione/pensiero), `moondream` (visione, solo
`scene_worker.py`, ogni 15 min), `mxbai-embed-large` (embedding per
Qdrant).

### Due modi in cui Gaia raggiunge TouchDesigner

Il canale 4 (§3, `gaia/device/{id}/command`) non serve solo a controllare
manualmente PatchDeck/ControllerV7/DMX dal web o da Telegram — è anche la
base di un secondo percorso, distinto e più importante concettualmente:
Gaia stessa che **decide** di attivare qualcosa su TD in risposta alla
propria vita interiore, non solo su comando umano.

1. **Comando diretto** — un umano (o un'automazione esplicita) decide COSA
   accendere: `web/patchdeck.html`/`mixeraudio.html`/`dmx.html`, il tab Pi
   Manager di Admin, `/attiva <servizio>` su Telegram. Stesso protocollo
   di Pi/OPS, nessuna intelligenza nel mezzo.
2. **Nursery** — Gaia (Node-RED + Ollama) decide da sola di attivare un
   componente visivo TD pre-costruito in risposta a un evento di vita
   della casa: una persona riconosciuta, un sogno notturno, un level-up
   RPG, un volto appena registrato, una nota di una pianta.

#### Nursery — l'iniziativa di Gaia verso TouchDesigner

```
5 eventi one-shot (GAIA Brain)
person_recognized · dream_new · level_up · face_enrolled · plant_note
   │                                          (5° trigger, room_discovered
   ▼                                           → room_portal, non ancora
nursery_trigger_fn  (filtro + throttle)         costruito: richiede
   │                                             rilevare la prima comparsa
   ▼                                             di una stanza — lavoro
Ollama qwen2.5:3b                                vero, non "gratis" come
   sceglie SOLO il componente (una parola)        gli altri 4)
   │
   ▼
nursery_validate_fn — whitelist contro nursery_components.json
   │                    parametri (hue/shape/energy) derivati via
   │                    FNV-1a dal contesto — MAI da Ollama
   ▼
gaia/nursery/activate  (TTL 5 min — mai attivo per sempre)
   │
   ▼
TD — esegue SOLO dalla whitelist, mai generazione di codice a runtime
```

**Perché Ollama non sceglie anche i parametri**: bug reale trovato dal
vivo (2026-08-07) — il modello locale (`qwen2.5:3b-instruct-q4_K_M`) si
blocca in modo affidabile ogni volta che gli si chiede di generare `{ }`,
sia con `format` a schema JSON sia con un prompt che lo chiede in testo
libero. Isolato con oltre 10 test diretti, indipendente da CPU/lunghezza
prompt — una risposta a una parola invece funziona sempre. Per questo i
parametri (hue/shape/energy) si derivano deterministicamente via FNV-1a
dal contesto (persona/parola sogno), stesso principio del vocabolario
asemico — nessun JSON richiesto a Ollama in nessun punto della catena.

Attivi e verificati dal vivo con publish MQTT reali (2026-08-08):
`face_sigil`, `levelup_burst`, `plant_bloom`. `person_sigil` (da
`person_recognized`) pubblicato correttamente ma **non confermato** se
`gaia_nursery` lato TD lo applichi davvero — `gaia/nursery/status`
restava vuoto nei test, domanda aperta lasciata a TD/Mac.

## 3. Il protocollo agente — un pattern, sei istanze

Pi, OPS, Core e ogni istanza TouchDesigner parlano lo stesso protocollo
minimo (`gaia_device_agent`, stesso schema in `pi/agent/agent.py`,
`ops/agent/agent.py`, e nativo dentro TD per PatchDeck/ControllerV7/DMX).
Le estensioni sono additive: chi non le usa continua esattamente come
prima.

```
┌─────────────────────────────┐                  ┌─────────────────────┐
│      gaia_device_agent       │                  │     MQTT BROKER      │
│      Pi · OPS · Core · TD    │                  │   mosquitto · Core    │
│                               │                  │                       │
│  register_service() /        │  status ────────►│ gaia/device/{id}/     │
│  register_param()            │  ~30s, retained   │   status              │
│  — stesso schema ovunque     │                  │                       │
│                               │  profile/        │ gaia/devices/{id}/    │
│                               │  announce ──────►│   profile · announce  │
│                               │  retained         │   (Device Registry)   │
│                               │                  │                       │
│                               │  {x}_matrix ─────►│ gaia/devices/{id}/    │
│                               │  opzionale,        │   {x}_matrix          │
│                               │  retained          │   (schema meccanico)  │
│                               │                  │                       │
│                               │  audio_levels ───►│ gaia/device/{id}/     │
│                               │  opzionale,        │   audio_levels        │
│                               │  NON retained, ~1Hz│                       │
│                               │                  │                       │
│                               │◄──── command ─────│ enable · disable ·    │
│                               │                  │   restart · status ·  │
│                               │                  │   set                 │
└─────────────────────────────┘                  └─────────────────────┘
```

Ogni comando, qualunque sia, fa sempre ripubblicare lo `status` a fine
funzione — sfruttato lato web per un poll attivo (`{"action":"status"}`)
senza mai dover cambiare l'heartbeat nativo di 30s.

| Istanza          | status/command | profile/announce | matrice meccanica         | set/params        | telemetria live       |
|-------------------|:---------------:|:------------------:|:---------------------------:|:--------------------:|:------------------------:|
| Pi × N            | ✓               | ✓                  | —                           | —                    | —                        |
| OPS               | ✓               | ✓                  | —                           | —                    | —                        |
| Core (self)       | ✓               | ✓                  | —                           | —                    | —                        |
| PatchDeck         | ✓               | ✓                  | ✓ `patchdeck_matrix`        | —                    | —                        |
| ControllerV7      | ✓               | ✓                  | — (naming `ch{N}_...`)      | ✓ 588 parametri      | ✓ `audio_levels`         |
| DMX × N scenari   | ✓               | ✓                  | ✓ `dmx_matrix`              | ✓ ~27 param/scenario | —                        |

Le estensioni sono retrocompatibili per costruzione: `_params` parte vuoto
per chi non chiama mai `register_param()`, quindi PatchDeck e i Pi non
hanno mai visto cambiare il proprio payload aggiungendo queste feature a
ControllerV7/DMX.

**Dal profilo ai moduli** (`docs/gaia-semantico.md`): l'hardware rilevato
(`capabilities`) suggerisce automaticamente i moduli attivabili — camera→
YOLO/MediaPipe, mic→voice, audio_out→TTS/mediaplayer, display/touch→
kiosk, midi/i2c→AV Herbarium — mai auto-avvio, solo un'opzione proposta
in Pi Manager. Il cambio di stanza di un device passa **sempre** da un
solo endpoint canonico, `POST /api/provision/assign` (gaia_admin.py
:8765), che sincronizza in un colpo solo i tre registri coinvolti
(provision registry, Device Registry Node-RED, comando diretto
all'agent) — un bug reale (refuso "ingresso1" persistente, 2026-07-03/04)
ha insegnato che aggiornarne solo uno li fa divergere silenziosamente.

## 4. Interfacce web — client diretti del broker

Le pagine di controllo (`patchdeck.html`, `mixeraudio.html`, `dmx.html`, il
tab Pi Manager di `admin.html`) non passano da un backend intermedio:
parlano MQTT direttamente dal browser via WebSocket (`mqtt.js`, porta
9001 su Core). Node-RED resta il custode del Device Registry e serve i
file statici.

```
┌─────────────────┐   publish/subscribe live — controllo   ┌──────────────────┐
│   pagine web      ├────────────────────────────────────────►│   MQTT broker     │
│   admin ·         │                                          │   Core · WS :9001 │
│   patchdeck ·     │                                          └──────────────────┘
│   dmx …           │
│                   │   HTTP — Device Registry, config, file   ┌──────────────────┐
│                   ├────────────────────────────────────────►│   Node-RED        │
└─────────────────┘                                          │   OPS · HTTP :1880 │
                                                              └──────────────────┘
```

Il controllo (slider, pulsanti, preset) non aspetta mai un giro per
Node-RED — va e torna dal broker in meno di un secondo. Solo la parte
anagrafica (stanza, capabilities, file statici) passa da Node-RED.

## 5. Due sessioni, un solo file di confine

Questa sessione (repo Gaia, nessun accesso diretto a TouchDesigner) e la
sessione "TD/Mac" (Envoy/MCP, TD live) non si parlano direttamente —
collaborano scrivendo/leggendo un changelog datato in un repo GitHub
condiviso.

```
┌───────────────┐   scrive       ┌────────────────────────┐   scrive       ┌───────────────┐
│ sessione Core   │  diagnosi/    │  GAIA_INTERFACE.md      │  fix/verifica  │ sessione TD/Mac│
│ repo Gaia ·      │◄──test dal──►│  repo TD4Gaia · GitHub   │◄────in TD─────►│ Envoy/MCP ·    │
│ niente TD live   │   vivo        │  changelog "Core, N" /   │                │ TD dal vivo     │
└───────────────┘               │  "TD/Mac, N"             │                └───────────────┘
                                 └────────────────────────┘
```

Verificato dal vivo: il ciclo ha già chiuso bug reali in un solo giorno
(registro vuoto su `td-dmx.1`/`td-dmx.1-b` — causa: toggle Create/Frame
Start di un `executeDAT` spenti di default) grazie a questo scambio.

**Regola operativa**: prima di scrivere su `GAIA_INTERFACE.md`, rifare
sempre un fetch fresco del contenuto (non solo lo sha) — due sessioni
attive in parallelo sullo stesso file sono un rischio reale, non teorico
(incidente reale 2026-08-06, vedi memoria `project-touchdesigner-osc`).

## 6. Indice componenti

| Componente             | Macchina         | Porta / protocollo      | Ruolo                                        |
|--------------------------|-------------------|----------------------------|-------------------------------------------------|
| mosquitto                | Core              | 1883 lan · 9001 ws        | Broker MQTT — sistema nervoso del sistema        |
| Node-RED                 | OPS               | 1880 http                 | Device Registry, orchestrazione, web statico     |
| gaia_admin.py             | Core              | 8765 http                 | API admin — voce, volti, config                  |
| Ollama                    | Core (docker)     | interno                   | LLM locale                                       |
| Qdrant                    | Core (docker)     | interno                   | Memoria vettoriale/episodica                     |
| OpenHAB                   | Core (docker)     | 8080 http                 | Luci, sensori, automazioni fisiche               |
| pi/agent.py                | Pi × N            | mqtt                       | Servizi per stanza — camera/voce/kiosk           |
| ops/agent.py               | OPS               | mqtt                       | Servizi pre-prod — stesso schema dei Pi          |
| gaia_device_agent.py       | Mac TD (+ OPS)    | mqttclientDAT nativo       | PatchDeck · ControllerV7 · DMX                   |
| TD4Gaia                   | GitHub            | repo pubblico              | Progetto TD + canale di confine Core↔TD/Mac      |
| Hue Bridge                 | rete locale       | API v1 · bridge-id fisso   | Luci fisiche — `hue:bridge:4c442d6265`           |
| Bot Telegram               | Node-RED (OPS)    | function unica, 3 output   | Comandi + linguaggio naturale → Hue/Echo/voce    |
| esp/sim/brick_node.py      | Core (simulatore) | mqtt, protocollo Pi-compat.| Prototipo "mattone intelligente" (Casa Zero)     |

## 7. Moduli e automazioni

Comportamenti e servizi periferici che completano il quadro — dettaglio
completo nei doc gemelli in `docs/`, qui solo ciò che serve per
orientarsi.

### Automazioni proattive — 11 toggle (`admin.html` → Automazioni)

| id | Default | Cosa fa |
|---|---|---|
| `petConcierge` | ON | Cura animali — `docs/pet-disability.md` |
| `fallDetection` | ON | Rilevamento cadute (sicurezza) |
| `fireAlarm` | ON | Allarme incendio (sicurezza) |
| `fridgeAlarm` | ON | Frigo aperto (sicurezza) |
| `moodLighting` | OFF, per-stanza | Scena luci da mood (`MoodSceneSync`) |
| `maggiordomo` | OFF | Citofono · pioggia+finestre · spegne luci stanza vuota da >10min — `docs/maggiordomo.md` |
| `thirstyPlantAlert` | OFF | Alert Telegram pianta assetata (umidità <25%) |
| `awayMode` | OFF | Nessuno in casa da >30min → spegne tutte le luci |
| `welcomeScene` | OFF | Persona nota rientra la sera → accende ingresso |
| `touchdesignerLighting` | OFF | Luci pilotate da parametri generati in TD (`gaia/touchdesigner/lighting/#`) |
| `voiceAutoEnroll` | OFF (attivo) | Doppia conferma volto+voce → raffina il profilo vocale esistente |

Le prime 4 (sicurezza/cura) sono ON di default; tutte le altre partono
OFF, opt-in esplicito — stessa convenzione ovunque nel progetto.

### Alexa/Echo

3 Echo reali (cucina, soggiorno, bagno — etichette non ovvie: "Cassa
camera" è fisicamente in bagno) via binding `amazonechocontrol` di
OpenHAB. Un TTS Queue Manager manda pensieri/level-up su TUTTI gli Echo
indipendentemente dalle risposte vocali dirette — due canali distinti,
facili da confondere.

### AV Herbarium — le piante suonano (V1/V2 fatte)

Sensori MIDI (hotplug ALSA/pipewire, qualunque sorgente si collega da
sola) → `music_engine.py` (scale/accordi/preset, puro Python, 6 preset
pronti) → Carla headless (3× Yoshimi in catena) → audio locale sul Pi.
Eventi normalizzati alimentano XP RPG (classe Druido) e mood.curiosity.
Sorgenti alternative mutuamente esclusive: simulatore casuale o
mediapipe ("la stanza suona in risposta a chi la abita" — gesti/
emozioni/postura mappati su note).

### LiveStream (V1 fatta)

icecast2 **locale su ogni Pi**, non centralizzato — requisito esplicito
2026-08-14: nessuna dipendenza da un server raggiungibile in rete, ogni
Pi resta autosufficiente. Sorgente mic o libreria musicale locale al Pi,
cambio a caldo via MQTT. `web/livestream.html` scopre gli stream via
profilo semantico, nessun IP hardcodato.

### Gamification RPG

`brain.gamification` (livello, classe, XP per categoria — es. Druido da
Herbarium) alimenta sia `web/game.html` (biomi, diario) sia i trigger
Nursery (`level_up`, §2) — luci archetipo e rune asemiche oro al
level-up.

### Vocabolario Asemico

Lingua visiva deterministica (`web/asemic.js`) usata ovunque Gaia
"scrive" qualcosa di non testuale — sogni (stile viola), pensieri, rune
RPG. Stessa identità visiva su welcome.html, dashboard, kiosk Pi.

### Rete audio Dante/DSP — roadmap, non ancora consumata dal brain

Hardware collegato per davvero (Sennheiser TCCM + Solaro QR1-UC via
Dante), telemetria UDP nativa testata dal vivo (localizzazione mic —
Horizontal/Vertical Angle — e VISCA-over-IP per le camere PTZ) — ma
**nessun consumo di questi dati in Node-RED/brain ancora**: oggi solo
verifica di trasporto lato driver esterno dell'utente. Scenari futuri
(sting sincronizzato multi-stanza, ducking centralizzato, TTS itinerante
tra stanze) restano design, non implementazione — dettaglio completo in
`docs/dante-dsp-audio.md`.

---

Versione visiva (SVG, stessi contenuti): artifact pubblicato il
2026-08-25, link condiviso a parte — questo file è la copia
"da terminale", pensata per restare aggiornata insieme al codice.
