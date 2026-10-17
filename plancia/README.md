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

### Stato DMX: cosa è live e cosa no

Sono presenti tre superfici diverse, con contratti distinti:

| Superficie | Dati e comandi | Stato |
|---|---|---|
| **DMX V8 / Device TD** | `gaia/devices/<id>/dmx_matrix` per servizi, parametri, enum e rig; `gaia/device/<id>/status` per stato/valori; `gaia/device/<id>/command` con `enable`/`disable` o `{action:"set", param, value}` | La pagina **DMX V8** presenta i servizi e i parametri pubblicati per il device scelto; la pagina **DMX** aggiunge menu palette dinamici distinti per rig A/B, con opzioni e stato derivati dalla matrice/status. Tutti i parametri restano selezionabili nelle cue timeline. |
| **DMX stanza Gaia** | `gaia/dmx/<stanza>/status` (`palettes_rgb`, `timeline_presets`, fixture e stato); `gaia/dmx/<stanza>/command` (`set_palette`, `timeline_load/start/stop`, blackout, luminosità, audio-reactive) | Controlli operativi per palette RGB e preset di timeline della stanza. Non rappresentano le palette o le scene del DMX V8. |
| **Show / Timeline OSC** | `/dmx/scene`, `/dmx/chase`, `/show...` e altri indirizzi della [mappa OSC](#mappa-indirizzi-dello-show) | I nomi delle scene/chase mostrati dai template sono esempi statici. Il widget timeline salva le cue nel layout OPS ed è configurabile dall'ispettore, ma clock, avanzamento e cue corrente sono runtime locali del browser: non sono una timeline condivisa o un engine scene ricevuto da DMX V8. |

Quando la matrice DMX V8 aggiorna le opzioni di un enum, i widget dinamici aggiornano il menu e mantengono il tipo originale del valore (per esempio stringa invece di convertirla implicitamente in numero). La pagina **DMX** conserva le scene OSC del DMX Master separate dai menu **Palette · Rig A/B**; la pagina **DMX V8** raccoglie i servizi e i parametri dinamici del device selezionato. Una cue può richiamare una scena OSC, impostare uno o più parametri DMX V8 (anche enum di rig diversi) o fare entrambe le cose. Il nome/valore del parametro deve essere esattamente quello pubblicato dalla matrice e l'enum deve corrispondere a un'opzione corrente; non viene inventato un catalogo scene/look che DMX V8 non abbia pubblicato.

Formato cue: `1:24 Ritornello > 5` richiama la scena OSC 5; `1:40 Warm > dmx_a_palette=Warm` imposta il parametro DMX V8 `dmx_a_palette`; `1:50 Look misto > dmx_a_palette=Warm; dmx_b_palette=Cool` applica entrambi i rig. Il device DMX può essere scelto dall'ispettore della timeline o lasciato su **Automatico**. Le cue vengono eseguite dal browser come gli altri controlli MQTT/OSC: il clock resta locale e non equivale a un engine timeline sincronizzato in TD.

**Verifica live in sola lettura su OPS (2026-10-17)**: sono stati rilevati `td-dmx-win`, `td-pddmx-win` e `td-dmx-ops`; la matrice espone enum distinti per rig A/B, inclusi `dmx_a_palette` e `dmx_b_palette`, profili fixture e servizi. Il menu rig A ha mostrato 19 opzioni. Questa verifica conferma ricezione e rendering, non l'invio/riscontro di un cambio palette: nessun comando live è stato mandato.

#### Timeline: creazione, modifica e salvataggio

Il widget Timeline si aggiunge da **Modifica griglia** o dal template
**Timeline e clock**. In uso normale, **CUE** apre l’editor per creare,
rinominare, spostare nel tempo, riordinare ed eliminare cue; si può anche
trascinare un blocco direttamente sulla traccia. Ogni cue può richiamare
un indice di scena OSC, uno o più parametri DMX V8, o entrambi. Le cue
restano compatibili con il formato precedente `M:SS Nome > richiamo`.

L’editor salva le cue nel layout corrente condiviso su OPS, come le altre
modifiche della Plancia. Per aggiornare anche lo snapshot di un progetto
nominato, usare **⋯ → Progetti → Aggiorna**. La durata e le cue sono
persistenti; play/stop, posizione corrente e clock restano locali al
browser e non sono un engine timeline sincronizzato in TD.

#### Scaletta per completare il flusso DMX

1. **Verifica comando DMX V8** — baseline `dmx_matrix`/`status` già osservata su OPS per il rig A (palette, profili, servizi e valori); concordare una prova live controllata per cambiare e ripristinare una palette, verificando il feedback. Acquisire anche il rig B se presente.
2. **Scene e look DMX V8** — individuare nel device un elenco e un comando di richiamo realmente pubblicati. Se non esistono, concordare prima il contratto TD (nomi/ID, recall, feedback, eventuale fade); non riutilizzare automaticamente `/dmx/scene`, che è un altro flusso OSC.
3. **Timeline show** — il formato cue ora supporta scene OSC e set di parametri DMX V8; resta da creare un editor cue dedicato per aggiungere, modificare, riordinare ed eliminare cue e definire come sincronizzare play/stop/GO/back e posizione con il consumer TD. Il runtime non è autorevole lato TD.
4. **Feedback e affidabilità** — distinguere comando inviato da comando applicato, mostrare stato online/stale, errori e feedback per rig; provare disconnessione e riconnessione senza assumere che l'invio OSC equivalga a conferma.
5. **Verifica palco e deploy** — provare fixture, teste mobili, blackout, palette e scene su hardware/live TD, poi aggiornare documentazione e pubblicare su OPS con backup e verifica della UI.

## Avvio

```bash
npm install
npm start
```

Il bridge stampa l'indirizzo da aprire sul tablet (es. `http://192.168.1.20:8080`). Tablet e computer devono essere sulla stessa rete.

| Variabile | Default | A cosa serve |
|---|---|---|
| `PORT` | `8080` | porta della pagina e del WebSocket |
| `OSC_HOST` / `OSC_PORT` | `192.168.1.73` / `7020` | destinazione OSC predefinita, oggi DMX Master (modificabile anche dall'interfaccia) |
| `OSC_IN` | `9000` | porta UDP su cui il bridge riceve OSC per aggiornare i controlli |
| `MIDI_OUT` | prima porta disponibile | nome della porta MIDI in uscita |

Il MIDI usa il pacchetto opzionale `easymidi`. Su Windows serve una porta virtuale come loopMIDI.

## Interfaccia

- **Modifica griglia**: aggiungi fader, manopole, pulsanti, pad XY, indicatori e testi; trascina i widget per disporli sulla griglia 16×10 e usa l'angolo per ridimensionarli. Questa modalità riguarda solo l'impaginazione dei widget, non le luci nella Pianta.
- **Pianta del palco**: senza attivare "Modifica griglia", trascina una fixture per spostarla, toccala per aprirne le proprietà e tocca uno spazio vuoto per aggiungerne una. Modifiche ai widget, coordinate e proprietà delle fixture vengono salvate automaticamente nel layout corrente condiviso su OPS; non serve un pulsante Salva. La spia in alto conferma quando il server ha ricevuto il layout.
- L'autosalvataggio Plancia non equivale all'invio della patch a TouchDesigner: `⇪ TD` invia le fixture DMX patchabili, mentre LED wall, casse e laser restano gestiti dal layout Plancia. Le modifiche a una fixture DMX già sincronizzata possono richiedere "Aggiorna su DMX Master" nel suo editor.
- Ogni controllo ha indirizzo OSC, range min/max, colore, e per fader/manopole/pulsanti un CC MIDI facoltativo. In modalità **Modifica**, l’ispettore permette di assegnargli un canale OSC.
- Da `⋯` → **Canali OSC per progetto o istanza** puoi definire più destinazioni con nome, famiglia, istanza, host e porta; ad esempio un endpoint distinto per DMX, PatchDeck e Controller Audio. Gli endpoint non sono preconfigurati dove il progetto TD non pubblica ancora un contratto OSC verificato. Le destinazioni sono salvate localmente nel browser; il JSON del layout esporta gli assegnamenti dei widget, non gli host/porte dei canali. Per usare lo stesso layout su un altro browser, ricrea i canali con la stessa famiglia e lo stesso nome o identificativo di istanza: l’identità OSC resta così uguale senza esportare gli endpoint di rete.
- Il canale **Predefinito** mantiene la destinazione OSC storica. Gli indirizzi `/gaia/...` continuano sempre a passare a `osc_bridge.py`, indipendentemente dal canale selezionato. I widget Gaia-nativi continuano a usare MQTT.
- **Pagine**: più layout nello stesso progetto, come tab in alto.
- **Bidirezionale**: l'OSC che arriva sulla porta 9000 con lo stesso indirizzo muove il controllo. Se l’IP sorgente identifica un solo canale configurato, aggiorna i widget di quel canale; altrimenti il feedback resta globale. Per feedback senza ambiguità, assegna IP sorgenti distinti ai canali o indirizzi OSC distinti.
- Layout corrente e progetti salvati sono condivisi dal server Plancia su OPS e aggiornati sugli altri browser connessi. Il bridge li persiste in `plancia/data/state.json` (sovrascrivibile con `PLANCIA_STATE_FILE`); l’indicatore in alto mostra se il salvataggio del layout è arrivato al server. In caso di disconnessione resta una copia locale in attesa di sincronizzazione.
- Il progetto nominato è uno snapshot separato: l'autosalvataggio aggiorna il layout corrente, ma non lo snapshot. In `⋯` → Progetti, usare "Aggiorna" per sostituire lo snapshot del progetto corrente con il layout attuale, oppure "Salva come nuovo" per crearne uno distinto.
- Se più device modificano lo stesso layout, prevale l’ultimo salvataggio ricevuto dal server e gli altri browser vengono aggiornati. Apri la Plancia tramite lo stesso bridge OPS (`http://192.168.1.240:8080`): `localhost`, l’IP LAN e ciascun browser sono origini/archivi locali distinti, ma tutti i client collegati allo stesso bridge condividono l’archivio OPS.
- Le preferenze di connessione e i canali OSC (host/porte) restano locali al browser; il layout condiviso conserva gli ID stabili delle assegnazioni widget. Configura gli stessi canali su ciascun device che deve inviare OSC. Da `⋯` puoi ancora copiare o incollare il JSON del layout.

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
| Teste mobili | selezione delle teste identificate da TD, pan/tilt, colore, gobo, posizioni, dimmer, zoom, focus, follow/release e home |
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
| `/mh/select/heads` | elenco di UID/nome/unità | seleziona le teste identificate dal TD |
| `/mh/select` | elenco 0/1 nell’ordine pubblicato da TD | selezione per maschera (compatibilità) |
| `/mh/pantilt` | x y (−1…1) | pan/tilt delle teste selezionate |
| `/mh/color` | r g b | colore |
| `/mh/dimmer` `zoom` `focus` | 0–1 | parametri |
| `/mh/gobo`, `/mh/position`, `/mh/preset/recall` | indice | gobo, posizione, richiamo preset |
| `/mh/strobe`, `/mh/home` | 0/1 | strobo teste, reset |
| `/led/color`, `/led/mode`, `/led/bright` | r g b / indice / 0–1 | contenuto LED wall |

Il template **Teste mobili** popola la selezione con UID e nomi pubblicati da DMX Master (`heads_list` e ordine della programmer in `dmx_matrix`); se TD non è collegato, mostra l’attesa invece di presumere otto teste. Anche il vecchio selettore standard “MH 1–8” viene migrato preservando la maschera di selezione. La selezione manda `/mh/select/heads` con gli identificativi selezionati, come previsto dal contratto TD/Win-PD 23. Pan/tilt, colore, dimmer, gobo, posizioni, strobo, home, follow e release usano gli indirizzi OSC della tabella.

Il widget **Preset PTZ** salva snapshot nominati dei controlli PTZ presenti
nella pagina (pan/tilt, colore, dimmer, gobo e gli altri controlli
compatibili). I preset sono nel layout condiviso OPS e si possono
richiamare, aggiornare, rinominare, riordinare o eliminare; il richiamo
invia i valori OSC alle teste selezionate in quel momento. Sono preset
della Plancia, non vengono scritti nel motore TD e non hanno conferma di
avvenuta applicazione. Per avere preset nativi TD serve ancora il
contratto di store/recall e feedback del progetto ricevente. Le pagine
PTZ già salvate ricevono il widget nella colonna libera accanto a
**Posizioni**; il resto del layout non viene riordinato.

Il layout del palco include dimensioni in metri (larghezza, profondità, quota del piano e altezza truss) e aree configurabili per platea e FOH. Nella Pianta si possono posizionare le fixture; il Render ne segue le coordinate, le altezze e, per le teste mobili, il truss.

Ogni LED wall può usare il contenuto procedurale, un URL diretto HTTP(S) a un video MP4/H.264 o WebM compatibile col browser, oppure una sorgente **NDI** via il Video Service (`ops/video-gateway`, PoC funzionante dal 2026-10-16): scegli "NDI" come sorgente nell'editor, poi "Cerca sorgenti NDI" per trovare e inserire il nome esatto di una sorgente NDI reale sulla rete. L'anteprima è muta e la luminosità segue master/gruppo LED. Se il browser blocca l'avvio automatico (solo per URL), fai clic sul pannello Render per avviare o riprovare la preview; gli errori di formato/codec/connessione sono indicati sul Render. Pagine web, HLS non supportato dal browser, file locali e RTSP non sono ancora supportati dal Video Service. Le preview non devono diventare una dipendenza del controllo show — il servizio è isolato (processo e porta propri, nessun contatto con TD/DMX/laser). Sono supportate più LED wall nel layout, ciascuna con sorgente indipendente.

I laser sono visualizzati localmente e non inviano comandi OSC/DMX.
