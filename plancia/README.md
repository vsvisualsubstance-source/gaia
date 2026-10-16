# Plancia

Superficie di controllo OSC/MIDI che gira nel browser di qualsiasi tablet o telefono. Un piccolo bridge Node sul computer serve la pagina e traduce i messaggi in OSC (UDP) e MIDI.

```
tablet (browser) ──WebSocket──► bridge.js ──OSC/UDP──► TouchDesigner, Resolume, Ableton (via M4L/Max), …
                 ◄─────────────           ◄──OSC/UDP── feedback sulla porta 9000
                                          ──MIDI CC──► porta MIDI (opzionale)
```

## Gaia

Plancia parla con l'ecosistema Gaia nello stesso modo delle pagine web del repo `gaia` (`patchdeck.html`, `dmx.html`, `mixeraudio.html`): **MQTT su WebSocket** direttamente dal browser al broker di Core, senza backend in mezzo. Il contratto di riferimento è `GAIA_INTERFACE.md` nel repo TD4Gaia.

| Widget | Ascolta | Comanda |
|---|---|---|
| **Gaia** | `gaia/td/canvas`, `gaia/brain/state` (mood, pensieri), `gaia/voice/tts/+`, `gaia/voice/command/+` | chat: `gaia/voice/command/<stanza>` `{text, stanza, ts}`; mood −/+: `gaia/touchdesigner/mood/<dim>` (delta) |
| **PatchDeck** | `gaia/device/+/status`, `gaia/devices/+/patchdeck_matrix` | `gaia/device/<id>/command` `{action:"enable", service:"load_xN_a"}`, toggle deck |
| **Device TD** | status + `patchdeck_matrix` (`fx_params`) / `dmx_matrix` (piatta o multi-rig) | servizi `enable`/`disable`, parametri `{action:"set", param, value}` |
| **DMX stanza** | `gaia/dmx/+/status` | `gaia/dmx/<stanza>/command`: `set_palette`, `set_brightness`, `blackout`, `timeline_load`/`start`/`stop`, `audio_reactive_start`/`stop` |

- I device non sono scritti nel codice: vengono scoperti da chi pubblica davvero status e matrici retained, come fanno le pagine di Gaia. Dall'ispettore puoi fissare un device o una stanza precisa.
- **Profili di rete** (`⋯` → Gaia): *Casa* (broker e Admin su Core `.142`, Node-RED su OPS `.240`) e *Portatile (OPS)* (tutto su `.240`). Ogni profilo contiene broker MQTT (porta WebSocket), fallback, Node-RED (HTTP e WS `/gaia`), Gaia Admin e ingresso OSC di Gaia. Si possono modificare, duplicare e verificare con **Verifica connessioni**. Dopo 10 s scollegato si prova il fallback.
- Avvio diretto da URL, utile per tablet e kiosk: `http://<bridge>:8080/?profilo=ops`, oppure singoli indirizzi con `?broker=…&nodered=…&admin=…&osc=…&stanza=…`.
- Node-RED (WS `/gaia`, lo stesso flusso della dashboard) fa da fonte di riserva per mood e pensieri se `gaia/td/canvas` non arriva.
- I tasti mood richiedono il consumer **touchdesignerMood** acceso in Admin → Automazioni.
- Senza broker raggiungibile i widget Gaia mostrano una simulazione (pallino ambra "Gaia · simulazione").
- Lato OSC il bridge instrada ogni indirizzo che inizia con `/gaia/` all'ingresso OSC di Gaia (`osc_bridge.py`, porta 9008, variabili `GAIA_OSC_HOST`/`GAIA_OSC_PORT`). Così un qualsiasi fader di Plancia può mandare, per esempio, `/gaia/td/lighting/<ItemOpenHAB>/Luminosita` o `/gaia/td/mood/calm`.
- `vendor/mqtt.min.js` è lo stesso file delle pagine di Gaia ed è servito dal bridge: niente dipendenza da internet in club.

## Avvio

```bash
npm install
npm start
```

Il bridge stampa l'indirizzo da aprire sul tablet (es. `http://192.168.1.20:8080`). Tablet e computer devono essere sulla stessa rete.

| Variabile | Default | A cosa serve |
|---|---|---|
| `PORT` | `8080` | porta della pagina e del WebSocket |
| `OSC_HOST` / `OSC_PORT` | `127.0.0.1` / `7000` | dove inviare l'OSC (modificabile anche dall'interfaccia) |
| `OSC_IN` | `9000` | porta UDP su cui il bridge riceve OSC per aggiornare i controlli |
| `MIDI_OUT` | prima porta disponibile | nome della porta MIDI in uscita |

Il MIDI usa il pacchetto opzionale `easymidi`. Su Windows serve una porta virtuale come loopMIDI.

## Interfaccia

- **Modifica**: aggiungi fader, manopole, pulsanti, pad XY, indicatori e testi. Trascina per spostare sulla griglia 16×10, angolo in basso a destra per ridimensionare.
- Ogni controllo ha indirizzo OSC, range min/max, colore, e per fader/manopole/pulsanti un CC MIDI facoltativo.
- **Pagine**: più layout nello stesso progetto, come tab in alto.
- **Bidirezionale**: l'OSC che arriva sulla porta 9000 con lo stesso indirizzo muove il controllo. Più tablet collegati restano sincronizzati.
- Il layout si salva sul dispositivo; da `⋯` puoi copiarlo o incollarlo come JSON.

## Formato dei messaggi

- Fader, manopola: `/indirizzo <float>` nel range min–max
- Pulsante: `/indirizzo <min|max>` (momentaneo o interruttore)
- Pad XY: `/indirizzo <x> <y>`
- Scene: `/indirizzo <indice>` (0, 1, 2…); in selezione multipla un elenco di 0/1
- Colore: `/indirizzo <r> <g> <b>` (0–1)
- Timeline (indirizzo base `/show`): invia `/show/time <s>` (10 volte al secondo), `/show/play <0|1>`, `/show/cue <n>`; ascolta `/show/go`, `/show/back`, `/show/play`, `/show/time`

Tutti i numeri partono come float OSC.

## Template

Da `⋯` → Template puoi aggiungere o sostituire pagine pronte:

| Template | Contenuto |
|---|---|
| Show completo | tutte le pagine qui sotto |
| Panoramica show | render del palco, ora, timecode, scene, timeline, master, blackout |
| Luci DMX | 12 scene con crossfade, chase, blackout, strobo, fade time, 8 fader di gruppo |
| Teste mobili | selezione MH 1–8, pan/tilt, colore, gobo, posizioni preset, dimmer, zoom, focus, home |
| Timeline e clock | cue list a tempo, timecode 25 fps, countdown a fine show, GO/Back (anche barra spaziatrice) |
| Design palco | pianta con patch DMX e quote, render, contenuti LED wall, blinder |
| Mixer live | fader con CC MIDI, meter, effetti, pad XY |

### Mappa indirizzi dello show

Il widget Palco simula il rig in locale ascoltando questi indirizzi, gli stessi che arrivano al tuo software luci (TouchDesigner, QLC+, Chamsys, grandMA via OSC…):

| Indirizzo | Argomenti | Effetto |
|---|---|---|
| `/dmx/scene` | indice | richiama la scena con crossfade |
| `/dmx/fade` | secondi | tempo di crossfade |
| `/dmx/master` | 0–1 | master generale |
| `/dmx/blackout`, `/dmx/strobe` | 0/1 | blackout, strobo generale |
| `/dmx/strobe/rate` | Hz | velocità strobo |
| `/dmx/chase` | indice | Off, Lento, Veloce, Rainbow, Random, Sound |
| `/dmx/group/front` `back` `mh` `ledbar` `ledwall` `haze` `blinder` | 0–1 | livello di gruppo |
| `/mh/select` | elenco 0/1 | teste selezionate |
| `/mh/pantilt` | x y (−1…1) | pan/tilt delle teste selezionate |
| `/mh/color` | r g b | colore |
| `/mh/dimmer` `zoom` `focus` | 0–1 | parametri |
| `/mh/gobo`, `/mh/position` | indice | gobo, posizione preset |
| `/mh/strobe`, `/mh/home` | 0/1 | strobo teste, reset |
| `/led/color`, `/led/mode`, `/led/bright` | r g b / indice / 0–1 | contenuto LED wall |

Il layout del palco include dimensioni in metri (larghezza, profondità, quota del piano e altezza truss) e aree configurabili per platea e FOH. Nella Pianta si possono posizionare le fixture; il Render ne segue le coordinate, le altezze e, per le teste mobili, il truss.

Ogni LED wall può usare il contenuto procedurale oppure un URL diretto HTTP(S) a un video MP4/H.264 o WebM compatibile col browser; l’anteprima è muta e la luminosità segue master/gruppo LED. Se il browser blocca l’avvio automatico, fai clic sul pannello Render per avviare o riprovare la preview; gli errori di formato/codec sono indicati sul Render. URL di pagine web, HLS non supportato dal browser, file locali, NDI e RTSP richiedono il Video Service. Il documento di riferimento in TD4PatchDeck (`docs/architecture/plancia-video-service.md`) è ancora una proposta: API e signaling WebRTC vanno integrati quando il contratto sarà stabile. Le preview non devono diventare una dipendenza del controllo show. Sono supportate più LED wall nel layout, ciascuna con sorgente indipendente.

I laser sono visualizzati localmente e non inviano comandi OSC/DMX.
