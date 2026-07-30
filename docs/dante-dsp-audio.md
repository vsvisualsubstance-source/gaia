# Rete audio Dante + DSP modulare — scenari possibili (2026-07-27)

Idea in roadmap, non ancora iniziata. L'utente ha disponibilità di un DSP
Solaro modulare con supporto **OSC su UDP** e **TCP puro**, più un catalogo
di script LUA documentato in una sessione Claude separata (non presente in
questo repo — da recuperare quando si passa all'implementazione).

**Perché è rilevante**: il supporto OSC lo fa incastrare esattamente nello
stesso pattern già usato per TouchDesigner (`minipc/touchdesigner/`) — un
bridge dedicato che ascolta MQTT e traduce in comandi OSC/TCP verso il DSP,
zero modifiche a Node-RED/al resto del sistema. Il pezzo tecnico è quindi
già rodato; il punto aperto è **quale funzione vale la spesa/complessità di
integrazione hardware** (cablaggio Dante, configurazione routing, mapping
LUA↔eventi Gaia).

## Cosa cambia rispetto a oggi

Oggi l'audio in GAIA è **decentralizzato per stanza**: ogni Pi/OPS fa Piper
TTS locale (→ `aplay`), musica locale (mpv IPC), ducking coordinato via
IPC per-processo. Un DSP Dante in mezzo sposta parte di questa logica in un
**mixer/matrix centrale**, controllabile da Gaia via rete invece che
cablaggio fisico fisso.

## Scenari possibili (nessuno ancora implementato)

### 1. Sting sincronizzato multi-stanza
Eventi Gaia con un momento preciso (level-up, sogno nuovo, allarme
citofono/caduta — vedi [[project_pet_disability]], [[project_web_gaming_rpg]])
oggi suonano un Pi alla volta, non sincronizzati. Un comando OSC al DSP può
far partire lo stesso suono in tutte le zone campione-per-campione — cosa
impossibile con `aplay` locale indipendente per stanza.

### 2. Ducking centralizzato musica/voce
Il ducking oggi è coordinato via IPC mpv per singola stanza (un processo
per stanza, fragile). Il DSP potrebbe abbassare la musica nel mixer
hardware con un solo comando OSC quando Gaia parla, indipendentemente dalla
sorgente musicale in quella stanza (anche non-mpv: TV, giradischi via
ingresso Dante).

### 3. TTS itinerante tra stanze
Invece di far girare Piper localmente su ogni Pi (CPU periferica spesa per
sintesi vocale), un solo motore TTS centrale sintetizza una volta e il DSP
instrada l'audio via matrix alla stanza dove si trova la persona (da
`brain.rooms`/presence, stesso dato già usato per instradare le risposte
vocali — vedi bug fix "Bentornato" in [[project_architettura_core_ops]]).
Libera CPU sui Pi, ma centralizza un single point of failure per la voce.

### 4. Effetti/spazializzazione per l'AV Herbarium
Il synth SF2 multi-timbrico su Carla ([[project_av_herbarium]]) genera già
l'audio delle piante sul Pi. Il DSP (via script LUA) potrebbe aggiungere
riverbero/ambienza per-stanza o spazializzazione senza appesantire il Pi
con plugin extra in Carla.

### 5. Telemetria DSP → brain
Via TCP il DSP può riportare livelli/mute/routing attivo come un sensore in
più per `brain.sensors` — stesso pattern del BrickNorm (vedi
[[project_esp32_roadmap]]): Gaia "sa" cosa sta suonando dove, senza dover
dedurlo da altri segnali.

### 6. Camere PTZ pilotate da audio/presenza
Aggiunto su richiesta esplicita dell'utente: le camere PTZ potrebbero
muoversi (pan/tilt/zoom) in base a dove il DSP rileva audio (direzione/
livello su un array di mic Dante) o dove YOLO/mediapipe rilevano persone —
"la telecamera segue chi parla/chi c'è". Diverso dagli altri scenari:
qui il DSP è la SORGENTE del dato (localizzazione audio), non solo
l'attuatore — serve capire quali metriche di localizzazione il DSP espone
via OSC/TCP prima di sapere se è realistico, e il controllo PTZ è un
protocollo a parte (tipicamente VISCA o ONVIF, non Dante) da aggiungere
come nuovo bridge.

## Aperture da chiarire prima di implementare

- Recuperare il catalogo script LUA (sessione Claude separata) per capire
  cosa il DSP può già fare "in casa" vs cosa deve orchestrare Gaia dall'esterno.
- Verificare quali metriche espone il DSP via TCP (solo controllo, o anche
  lettura livelli/routing/localizzazione audio per lo scenario 6).
- Nessun hardware ancora cablato/testato — tutto quanto sopra è design,
  non verificato dal vivo.

## Aggiornamento 2026-07-30 — scenario 6 già in corso, OSC abbandonato

Hardware collegato per davvero (Sennheiser TCCM + Solaro QR1-UC in rete
Dante, vedi [[project-architettura-core-ops]] per l'integrazione mic). Per
lo scenario 6 (localizzazione audio) l'utente ha testato dal vivo l'invio
dati dal Solaro verso Core: **OSC deciso abbandonato** ("non uso OSC visto
che abbiamo nativo udp e tcp") a favore di **UDP nativo, un canale/porta,
un valore ASCII per pacchetto** — molto più semplice da debuggare e già
verificato affidabile. Canali confermati funzionanti: Horizontal/Vertical
Angle (localizzazione reale dell'array mic, esattamente il dato che
serviva per questo scenario), Mic Level, Far End Audio, Camera Preset, più
VISCA-over-IP (porta 52381, binario) per i comandi camera reali già in uso
dal FollowMe. Dettagli completi (porte, formati, storia dei test) in
[[project-solaro-dsp]]. Non ancora fatto: nessun consumo di questi dati nel
brain/Node-RED — finora solo verifica del trasporto lato driver esterno
dell'utente.

## Ordine consigliato quando si parte

Stesso principio già seguito per gli altri moduli (vedi
`docs/pi-moduli-futuri.md` §Ordine consigliato): partire dallo scenario più
semplice da validare il pattern (probabilmente **2. Ducking centralizzato**
o **1. Sting sincronizzato** — entrambi solo OSC out, nessun bisogno di
leggere dati dal DSP), poi eventualmente telemetria/PTZ una volta rodato il
bridge di base.
