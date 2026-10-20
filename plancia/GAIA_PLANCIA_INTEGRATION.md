# Gaia ↔ Plancia — contratto di integrazione

Plancia (`plancia/`) è la superficie di controllo web di Gaia: fader,
manopole, pad XY, pagine, pensata per tablet/telefono in un show live.
Non è un backend — è un bridge Node (`bridge.js`) che serve la pagina
(`index.html`) e traduce i messaggi del browser in OSC/UDP (e MIDI
opzionale). Per il formato dei widget/template/indirizzi OSC generici,
vedi `plancia/README.md` — questo file descrive SOLO il contratto con
Gaia, cioè dove finiscono davvero quei messaggi.

Progetto importato il 2026-10-15 da un downlaod esterno
(`/home/core/Scaricati/plancia (1)/plancia/`), con i profili di rete già
corretti per Gaia Portable (vedi `web/README`-equivalente in
[[project-plancia-control-ui]] in memoria per la cronologia dei fix).

## Vincolo di deploy: SOLO OPS, mai Core (2026-10-15)

`bridge.js` e la pagina (`index.html`) girano **esclusivamente su OPS**
(`C:\gaia\plancia\`, Scheduled Task `GAIA-OPS-Plancia`). Non è una
preferenza, è un vincolo: Core resta fisso a casa (non viaggia), mentre
OPS è la macchina che segue l'installazione/il tour. Si può *sviluppare*
puntando a un bridge locale su Core per comodità, ma il **servizio
reale** — quello che un tablet apre davvero durante un show — deve
sempre essere quello su OPS (`http://192.168.1.240:8080`). Se mai serve
testare qualcosa su Core, è un deploy temporaneo, non quello buono.

## Persistenza di layout e progetti

Il layout corrente si salva automaticamente quando si modificano widget
o fixture nella Pianta; non serve premere un comando Salva. L'indicatore
in alto conferma la ricezione dal server. La modalità "Modifica griglia"
serve soltanto a disporre e ridimensionare i widget, mentre le fixture si
aggiungono/spostano/modificano direttamente nella Pianta, senza attivarla.
Questo autosalvataggio aggiorna il layout corrente, non lo snapshot del
progetto nominato: per aggiornare quest'ultimo usare esplicitamente
"Aggiorna" in `⋯` → Progetti. L'invio/ricezione DMX (`⇪ TD`/`⇩ TD`) è
un'operazione distinta dalla persistenza del layout.

Layout corrente e snapshot dei progetti sono condivisi fra i browser che
si collegano allo stesso bridge OPS. `bridge.js` li salva in
`plancia/data/state.json` (variabile `PLANCIA_STATE_FILE` per scegliere
un percorso diverso); gli aggiornamenti vengono inviati agli altri
client connessi. Se più device salvano modifiche, prevale l’ultimo
salvataggio ricevuto dal server. Usare `localhost` invece dell’IP OPS
non punta allo stesso origin nel browser; per i device remoti aprire
`http://192.168.1.240:8080`.

Le preferenze di connessione e gli endpoint/canali OSC restano locali
al browser, non nel file condiviso. Di conseguenza ogni device che deve
inviare OSC deve configurare i propri endpoint.

## Quattro flussi, non uno

Plancia parla con Gaia su **quattro canali indipendenti**, con
destinazioni diverse — non confonderli (stesso principio di
`minipc/touchdesigner/GAIA_TD_INTEGRATION.md`, "I canali tra Gaia e TD
— non confonderli"):

| Canale | Trasporto | Da → a | Cosa porta |
|---|---|---|---|
| **1. Widget Gaia-nativi** | MQTT su WebSocket, dal browser diretto al broker | Plancia (browser) ↔ broker Gaia (Core `.142:9001` o OPS `.240:19001`) | mood/pensieri, PatchDeck, device TD, DMX stanza (`gaia/dmx/+/...`) |
| **1b. Design dello show** (nuovo, in costruzione) | stesso trasporto del canale 1 (MQTT su WS), stesso meccanismo "Device TD" già esistente | Plancia ↔ **DMX Master**, bidirezionale | creazione/patch fixture — vedi sezione dedicata sotto |
| **2. `/gaia/...` via bridge.js** | OSC/UDP | Plancia → `bridge.js` → **osc_bridge.py** (porta 9008) → MQTT `gaia/touchdesigner/<path>` | qualunque comando semantico Gaia (luci OpenHAB, mood delta, ecc. — stesso ingresso "canale 4" di TD, vedi `GAIA_TD_INTEGRATION.md`) |
| **3. Show control generico (`/dmx/`, `/mh/`, `/led/`, `/show/`)** | OSC/UDP, bidirezionale (feedback su `OSC_IN`, porta 9000 di `bridge.js`) | Plancia → `bridge.js` → **DMX Master** (TD, famiglia `dmx`), DIRETTO | teste mobili, LED, scene, timeline — non passa da Gaia/MQTT per niente |

Il canale 1 funziona già out-of-the-box (stesso schema di
`patchdeck.html`/`dmx.html`/`mixeraudio.html`), nessun lavoro lato Gaia.
Il canale 2 esiste già (`osc_bridge.py` gira su Core e su OPS). Il
canale 3, già descritto qui, ora supporta più destinazioni selezionabili
widget per widget.

## Canale 3 — perché diretto a DMX Master, non via Gaia/MQTT

`bridge.js` è un relay OSC puro, non parla MQTT (deciso così: un solo
traduttore verso Gaia — vedi [[project-plancia-control-ui]] — altrimenti
bisognerebbe mantenere la stessa traduzione in due posti). Gli indirizzi
generici (`/dmx/scene`, `/mh/pantilt`, ecc. — mappa completa in
`plancia/README.md` "Mappa indirizzi dello show") sono pensati per
pilotare *direttamente* un software luci: su Gaia, quel ruolo lo ha
**DMX Master** (`device_id` `td-dmx-win`, famiglia `dmx`, il rig TD che
pilota davvero teste mobili/LED via Art-Net — non `osc_bridge.py`, che
non sa nulla di DMX).

`bridge.js` instrada prima `/gaia/...` verso il canale 2
(`GAIA_OSC_HOST`/`GAIA_OSC_PORT`). Gli altri widget usano il canale
selezionato nell’ispettore in modalità Modifica; senza selezione
mantengono la destinazione predefinita `OSC_HOST`/`OSC_PORT`. I canali
aggiuntivi si configurano da `⋯` → **Canali OSC per progetto o
istanza**, con nome, famiglia, istanza, host e porta. L’identificativo
del canale viaggia solo tra browser e `bridge.js`: il datagramma OSC e
i contratti esistenti di indirizzo/argomenti non cambiano.
L’identità del canale è stabile in base a famiglia e istanza (o, se
l’istanza è vuota, al nome), perciò un layout importato su un altro
browser mantiene le assegnazioni quando si ricrea lì lo stesso canale.
Gli host e le porte restano configurazione locale e non vengono esportati
con il layout.

Famiglia e istanza sono metadati di routing, non discovery né garanzia
che il progetto ricevente implementi un indirizzo. In particolare,
PatchDeck e Controller Audio hanno già superfici Gaia via MQTT; non va
dedotto da questo che ogni loro progetto TD abbia un OSC In abilitato.
Configurare solo endpoint e contratti verificati nel relativo progetto.
La destinazione predefinita resta DMX Master (`td-dmx-win`, famiglia
`dmx`, 7020).

Il feedback in ingresso continua ad arrivare sulla porta 9000. Se l’IP
sorgente corrisponde a un solo canale configurato, il bridge allega quel
canale ai messaggi per sincronizzare i widget assegnati. Se più canali
condividono lo stesso IP, la sorgente non identifica il progetto e il
feedback non aggiorna i widget assegnati a quei canali; con sorgenti non
riconosciute resta il comportamento storico (matching per indirizzo OSC).
Il riconoscimento usa l’IP sorgente, quindi un host configurato con un
nome DNS non permette l’associazione del feedback a un canale specifico.

### Feedback dell’uscita DMX per fixture

Plancia riceve lo snapshot retained TD su
`gaia/devices/+/dmx_output` (contratto TD4DMX `b0ee279`) e i messaggi OSC
`/dmx/output/source`, `/dmx/fixture/<uid>` e
`/dmx/fixture/<uid>/head` sulla porta 9000. I valori fixture sono quelli
effettivamente inviati dopo master, blackout, livelli di gruppo ed effetti;
`rgb_out` è normalizzato 0–1. Pan e tilt sono mostrati come gradi ricevuti,
senza convertirli nei valori angolari interni del Render.

Lo stato vive solo in memoria: non modifica né salva `L.fixtures` o la
griglia. Il Render usa colore/intensità freschi per le fixture associate
via UID/ID; le teste mostrano anche intensità, pan e tilt. Il riepilogo
HUD indica sorgente e fixture inviate. I dati MQTT diventano stale dopo
6 secondi senza heartbeat, quelli OSC dopo 12 secondi. Se MQTT è offline,
Plancia invia `/dmx/output/osc 1` al massimo ogni 10 secondi per rinnovare
la richiesta TD (validità 15 secondi).

**2026-10-20 (OPS), note TD/Win-PD 32-34 verificate dal vivo:**

- **Scene di TD, non i LOOKS locali** (nota 33): `/dmx/scene` in arrivo da
  TD (OSC o `dmx_output.scene`) evidenzia solo il pulsante e imposta
  `SH.scene`, senza `goScene`; il widget Scene su `/dmx/scene` mostra i
  nomi di `show_scene_catalog` (indice = `/dmx/scene`), e così l'HUD del
  Render. I 12 `LOOKS` restano solo per la simulazione senza TD.
- **Teste**: con il feedback il fascio usa `pan`/`tilt` reali in gradi,
  divisi per metà escursione del modello (`pan_range`/`tilt_range` di
  `dmx_models`, default 540/270), stesso verso del pad (nota 30); colore
  e livello da `rgb_out`; gobo aperto (non è nel feedback). Con
  `color_source: "unknown"` l'etichetta mostra "colore ?" (nota 34).
- **Haze**: la nebbia del Render usa l'`intensity` reale della macchina
  haze.
- **Palette** (`dmx-enum` `dmx_<rig>_palette`): la palette attiva prende
  la tinta che il rig sta emettendo (media degli `rgb_out` del gruppo,
  `dmxGroupColor`), "Custom" il `custom_color1` del rig. TD pubblica le
  altre palette solo per nome: restano neutre finché TD non ne pubblica
  i colori (richiesta in TD4Gaia "OPS, 2").
- **Timeline**: cue di TD senza `label` mostrano il nome della scena.

## Porte — contratto esplicito, mai indovinato

Stessa filosofia di `mocap_port` (vedi `GAIA_TD_INTEGRATION.md`, "Porta
per istanza"): ogni canale ha una porta fissa e distinta, decisa qui una
volta, non scoperta/indovinata a runtime.

| Porta | Canale | Chi ascolta |
|---|---|---|
| 7010–7013 | Mocap diretto (canale separato, non Plancia — vedi `GAIA_TD_INTEGRATION.md`) | ogni istanza TD, una porta a testa |
| **7020** | **Canale 3 — show control generico da Plancia** | **DMX Master** (`td-dmx-win`), nuovo OSC In dedicato |
| 9008 | Canale 2 — `/gaia/...` | `osc_bridge.py` (Core o OPS) |
| 9000 | Feedback OSC verso Plancia (chi controlla un fader da un altro tablet/da TD) | `bridge.js` stesso (`OSC_IN`) |

**7020 è stato scelto apposta fuori dal blocco mocap (7010-7013)**: sono
canali concettualmente diversi (sender diverso — Gaia/mediapipe per il
mocap, Plancia/bridge.js per il show control), anche se tecnicamente
niente vieta di condividere una porta per prefisso OSC. Tenerli separati
evita di dover mai chiedersi "quel pacchetto su 7010 è mocap o un fader
di Plancia?".

**Lato TD (DMX Master)**: la nota TD/Win-PD 23 in
[`TD4Gaia/GAIA_INTERFACE.md`](https://github.com/vsvisualsubstance-source/TD4Gaia/blob/main/GAIA_INTERFACE.md)
documenta il controllo selettivo delle teste sulla porta 7020, verificato
dal lato TD: selezioni, posizioni, preset e modalità follow/manual.
La numerazione differisce tra i documenti: è il **flusso 3 di Plancia**
e il **canale 5 lato TD**. Gli altri indirizzi del prospetto restano
contratti specifici del progetto TD e non sono implicati dal solo fatto
che Plancia possa inviarli.

## Canale 1b — design dello show, bidirezionale (proposta, 2026-10-15)

Obiettivo esplicito dell'utente: progettare lo show (fixture, patch,
scene) **da Plancia** (widget "Design palco", vedi `plancia/README.md`
— oggi simula solo in locale), mandare quella definizione a **DMX
Master** che crea davvero le fixture nel rig, e poi controllarle
indifferentemente **sia da TD sia da Plancia** — stato sempre
sincronizzato tra i due.

**Perché MQTT (canale 1) e non OSC (canale 3)**: il canale 3 porta
*valori di controllo live* (pan/tilt, colore, dimmer — float semplici,
alta frequenza, nessuno stato persistente). La definizione di una
fixture (id, profilo, indirizzo DMX, posizione) è invece *dato
strutturato e persistente* — stesso genere di cosa che "Device TD" (già
nel README di Plancia, tabella dei widget) manda oggi con
`{action:"set", param, value}` su `gaia/device/<id>/command`. Riusare
quel meccanismo generico invece di inventare un quinto canale OSC.

**Flusso**:
1. Plancia (Design palco) manda a `gaia/device/td-dmx-win/command`:
   `{"action":"set","param":"dmx_fixture_add","value":{...}}` (o
   `dmx_fixture_update`/`dmx_fixture_remove`).
2. DMX Master applica, salva nel proprio stato interno.
3. DMX Master ripubblica il patch intero in `gaia/device/td-dmx-win/status`
   (retained) — Plancia (e qualunque altro TD/widget) lo legge da lì,
   stesso identico pattern di `patchdeck_matrix`/`dmx_matrix` già
   documentato per gli altri device TD.

**Schema REALE trovato dal vivo su DMX Master (2026-10-15, aggiornato)**
— `status.params.dmx_fixtures` esiste già con dati veri, diverso da
quanto proposto qui inizialmente:

```json
{"id": 11, "name": "Head 1", "group": "heads", "unit": 1,
 "profile": "Generic Spot 11ch 16bit", "port_id": "2.1.1.2:2",
 "address": 100, "x": -9.0, "y": -3.5, "enabled": 1, "palette": "", "uid": ""}
```

Differenze dalla proposta iniziale: `id` numerico (non stringa);
l'indirizzamento è per **`port_id`** (IP:porta del nodo Art-Net, es.
`2.1.1.2:1`), non un `universe` astratto; `profile` è il nome del
profilo fixture (i canali si derivano da lì, nessun campo `ch`
separato); `group` qui sono raggruppamenti fisici del rig (`heads`,
`rig_a`, `rig_b`...) — **vocabolario DIVERSO** da quello usato dagli
indirizzi live `/dmx/group/...` del canale 3, non confonderli; `enabled`
è `0`/`1`; in più `palette` e `uid` (vuoti oggi). `dmx_fixture_add`/
`update`/`remove` esistono come slot comando (oggi `null`, write-only,
coerente con la proposta). `dmx_patch_report`: `{"id","status":"off"|
"offline"|"conflict"(forse "ok" a patch risolto),"port_id","universe",
"start","end"}`.

**DOMANDA APERTA PER CHI LAVORA LATO TD** (nessuna sessione Claude
raggiungibile lì in questo momento — da relayare a mano): il modello
costruito lato Plancia (`plancia/index.html`, nuovo editor "Pianta e
patch") oggi è più semplice del vostro — ogni fixture ha solo
`type`/`universe`(numero)/`address`/`x`/`y`, pensato per un utente che
piazza "una testa mobile" senza sapere nulla di profili o nodi Art-Net
specifici. Due strade per far combaciare le due parti, quale è più
semplice da costruire lato vostro?
  - **(A)** Plancia adotta i VOSTRI campi reali as-is (`port_id`,
    `profile` con lista vera dei profili disponibili, `unit`,
    `palette`) — Plancia deve conoscere/scoprire quali `port_id`
    (nodi Art-Net) e `profile` esistono davvero sul rig, probabilmente
    leggendoli da un campo nuovo che DMX Master pubblica (lista
    profili/nodi disponibili?).
  - **(B)** Plancia resta semplice (tipo generico + indirizzo
    astratto), e chi riceve `dmx_fixture_add` lato DMX Master traduce
    lui il tipo generico in un `profile`/`port_id` reali (con un
    default sensato o chiedendo conferma), scrivendo lui i campi veri
    nello stato che poi tutti leggono.

**Risposta da TD (2026-10-15)**: entrambe le strade, non una scelta
esclusiva — e la (B) è già attiva su DMX Master:
- **(B)**: `dmx_fixture_add`/`dmx_fixtures` accettano la fixture
  Plancia COSÌ COM'È — `{id, type, name, group, universe, address, x,
  y, enabled}`. `id` (stringa) diventa il loro `uid`; `universe` viene
  tradotto in `port_id`; un `group` mancante/non riconosciuto viene
  dedotto dal `type`. `wall`/`speaker` vengono saltati (non
  DMX-patchabili — bottone "Manda a DMX Master" nemmeno mostrato per
  questi tipi nell'editor).
- **(A)**: già pubblicato. Profili per gruppo in
  `dmx_matrix.fixtures.groups[].profiles`; nodi Art-Net disponibili in
  `dmx_matrix.patch.ports` — stesso topic `gaia/devices/+/dmx_matrix`
  che Plancia già sottoscrive per il widget "Device TD" generico,
  nessuna nuova sottoscrizione necessaria per leggerli.
- `front`/`back`/`mh` (vocabolario del canale 3, live-control) sono
  alias di `rig_a`/`rig_b`/`heads` (vocabolario fisico del canale
  1b/TD) — stessi nomi accettati su entrambi i canali, non sono due
  vocabolari davvero separati come temevo.

**Implementato lato Plancia**: l'editor fixture (`openFixEditor`) ha
un bottone "Manda a DMX Master" (assente per `wall`/`speaker`) che
pubblica su `gaia/device/td-dmx-win/command`:
```
{action:"set", param:"dmx_fixture_add"|"dmx_fixture_update"|"dmx_fixture_remove",
 value:{id,type,name,group,model,universe,address,x,y,enabled,on_conflict}}
```
Stesso meccanismo "Device TD" generico già in uso altrove
(`devCmd()`/`gPub()` in `plancia/index.html`), nessun nuovo trasporto.
`group` **è sempre presente**, non opzionale: ogni `FIX_TYPES` ha il
suo gruppo fisso (vedi tabella) e `mkFix()` lo imposta su ogni fixture
creata, mai lasciato vuoto.

**Mappa tipo Plancia → gruppo mandato a TD** (`FIX_TYPES`, tabella
completa — i 5 patchabili, `wall`/`speaker`/`laser` non mandano mai
nulla a DMX):

| Tipo Plancia | `group` mandato | `kind` (nota 19) | Modello di default |
|---|---|---|---|
| `mh` | `mh` (alias di `heads`) | `heads` | `Generic Spot 11ch 16bit` |
| `par` | `front` (alias di `rig_a`) | `chase` | `D+RGB 4CH` |
| `bar` | `ledbar` | `chase` | `D+RGB 4CH` |
| `blinder` | `blinder` | `level` | `Dimmer 1CH` |
| `haze` | `haze` | `level` | `Haze 2CH` |

**Verificato dal vivo per tutti e 5 i tipi** (2026-10-16, via
Playwright): ognuno confermato `_synced` con `group`/`model`/indirizzo
reali tornati da TD in `dmx_fixtures` — non solo mh/par/bar (già
verificati nelle note 18/20), anche blinder e haze creati e confermati
nello stesso giro (`dmx_fixture_add` con `on_conflict:"auto"`,
`group:"blinder"`/`"haze"`, modello assegnato `Dimmer 1CH`/`Haze 2CH`).
**Non ancora verificato dal vivo un giro completo** (serve confermare
che DMX Master riceva davvero e ripubblichi in `dmx_fixtures`).

**Giro completo verificato dal vivo da TD (nota interface 18,
2026-10-15)** — add/update/remove funzionano tutti. Tre problemi
trovati, tutti fissati lato Plancia lo stesso giorno:
1. **Conferma reale**: TD accetta il comando MQTT anche quando lo
   scarta (gruppo/profilo/indirizzo invalido) — serviva controllare
   che `id` comparisse come `uid` in `dmx_fixtures`, non limitarsi a
   "il publish è andato". Fix: polling leggero (6 tentativi) dopo
   l'invio, errore da `status.last_error` se non arriva conferma,
   avviso se `dmx_patch_report` segna la fixture in conflitto.
2. **`uid()` tutto cifre** (~1/10000): prefisso `"p-"` su ogni id
   creato in Plancia, così non è mai confuso con un `id` numerico di
   TD.
3. **Doppioni**: Plancia non leggeva mai la patch reale di TD —
   `tdFixtures()` ora mostra (solo lettura, tratteggio grigio) le
   fixture già in TD non create da Plancia, tap per un'info
   gruppo/profilo/porta/indirizzo, niente drag/edit.

**Non ancora fatto**: `nextAddress()` considera solo le fixture di
Plancia, non ancora `dmx_fixtures`/`dmx_patch_report` di TD (accettato
da TD come alternativa al fix proattivo — oggi il conflitto si vede
solo DOPO l'invio). Leggere `dmx_matrix.fixtures.groups[].profiles`/
`dmx_matrix.patch.ports` (A, già pubblicati) per offrire una scelta
REALE di profilo/porta nell'editor invece di lasciare che DMX Master
assegni un default — prossimo passo naturale, dati già disponibili.

## Config di deploy (valori attuali, 2026-10-15)

`plancia/bridge.js` via env (vedi `plancia/run_plancia.bat` se
deployato su OPS):

```
OSC_HOST=192.168.1.73      # DMX Master (TD) -- canale 3
OSC_PORT=7020
GAIA_OSC_HOST=127.0.0.1    # osc_bridge.py LOCALE a bridge.js (su OPS: mai l'IP esterno,
GAIA_OSC_PORT=9008         # stesso motivo hairpin-NAT di ops/agent e ops/dhcp)
```

Se DMX Master cambia macchina/IP, aggiornare `OSC_HOST` qui (deploy) E
il default in `plancia/index.html` (riga `let C=...`, usato da ogni
tablet che non ha ancora una preferenza salvata) — due posti, stesso
dato, nessuna scoperta automatica per questo canale (a differenza del
mocap).

## Verifiche e limiti

- Il template Teste mobili ora invia selezioni per identificativo vivo
  (`/mh/select/heads <uid>…`), leggendo `heads_list` e l’ordine della
  programmer da MQTT; senza dati TD non crea una lista fittizia di otto
  teste. I controlli pan/tilt e look seguono la mappa OSC nel README.
- La prova fisica Plancia → bridge OPS → TD DMX non è eseguibile da
  questo checkout senza accesso al TD live. Va verificata sul rig prima
  del deploy touring, inclusi feedback, disconnessione e ID teste reali.
- Il canale di ritorno OSC è un solo listener (9000); più istanze sullo
  stesso IP non si distinguono via sorgente. Per feedback simultaneo
  servono IP o indirizzi OSC distinti.
- Nessun fallback di rete verso DMX Master: il
  widget Palco di Plancia *già* simula in locale (vedi README), quindi
  l'operatore vede comunque qualcosa anche se il canale 3 non è
  raggiungibile; il bridge segnala gli errori UDP e i canali mancanti.

## Nota TD/Win-PD 24 (2026-10-19): clock condiviso dello show

Il master è la timeline `show` di DMX Master (`td-dmx-win`); Plancia è un
follower, non un secondo orologio. Il contratto TD pubblica lo stato
retained su `gaia/show/clock/state` e riceve i comandi su
`gaia/show/clock/command`. La Plancia sottoscrive lo stato e i pong,
stima il ritardo con ping MQTT e interpola la posizione usando
`performance.now()`; se manca uno stato per 3,5 secondi congela il tempo.
Play/pausa, stop, salto, GO, Back e richiamo cue sono inoltrati al master.

Il widget `/show` usa la lista `show_cues` dello status DMX Master quando
disponibile. Non esegue né richiama le cue locali mentre segue il clock
TD. In assenza di uno stato MQTT mantiene il precedente funzionamento
locale; se riceve feedback OSC `/show/*` dalla porta 9000 lo usa come
sorgente del clock e invia i comandi OSC al canale del widget. Con MQTT,
uno stato scaduto congela la posizione invece di avviare un secondo
orologio locale. In fallback OSC, durante il play la posizione si
aggiorna col feedback; in pausa TD non manda heartbeat, quindi Plancia
mantiene il clock fermo ma non può rilevare la disconnessione del master.

Il feedback OSC `/show/*` lato TD (`plancia_in` → `Feedback`) era
documentato come pronto ma spento nella nota 24. L’attivazione del
feedback resta un passaggio operativo lato TD; non è cambiata da Plancia.
Il follower Plancia è stato provato dall'operatore il 2026-10-19 e il
clock condiviso risulta funzionante.

## 2026-10-20: timeline disegnata in Plancia → DMX Master (TD/Win-PD 29) — FATTO lato Plancia

Plancia usa il param `show_timeline` di `td-dmx-win` (documento intero,
validato tutto insieme, esito in `show_timeline_result`):

- **Editor cue** (pulsante CUE o ispettore): `⇩ Importa da TD` carica la
  timeline attuale di TD nell'editor (diventa definitiva solo con Salva);
  `⇪ Invia a TD` salva e invia. L'invio fa sempre prima `dry_run: true`,
  mostra cue/durata/marker/avvisi di TD e chiede conferma, poi carica.
- **Timeline `/show` che segue TD**: CUE apre l'editor già caricato con la
  timeline di TD e "Salva e invia a TD" la rimanda (prima era bloccato con
  "Le cue dello show si modificano in DMX Master").
- **Scene per nome**: l'indice scena di Plancia (1-based nel testo cue,
  `/dmx/scene` 0-based) viene tradotto nell'`id` di `show_scene_catalog`;
  una scena che TD non ha diventa un marker (`missing_scenes: "marker"`)
  e compare tra gli avvisi prima della conferma.
- **Fade per cue**: nuovo richiamo `fade=<s>` nella riga cue (es.
  `0:10 Blu > 2; fade=3.5`); senza, vale `default_fade: 2` di TD. In
  riproduzione locale Plancia lo ignora.
- **Conflitti**: Plancia salva nel widget la `rev` dell'ultimo import/invio
  (`tdBaseRev`) e la manda come `base_rev`; se intanto la timeline è stata
  cambiata in TD, chiede se sovrascrivere (`force: true`).
- **Non inviati**: i parametri DMX V8 delle cue (`dmx_a_palette=Warm`)
  restano solo in Plancia (avviso prima dell'invio); le automazioni
  (`keys`) e il `loop` di TD non vengono toccati.

Verificato dal vivo: dry-run della timeline attuale di TD rimandata nel
formato Plancia → `ok: true`, nessun conflitto, rev invariata.

## Nota TD/Win-PD 25 (2026-10-19): feedback teste mobili verso Plancia

TD ha verificato dal vivo e attivato il feedback OSC verso il listener
Plancia su `OPS:9000` (bridge.js `OSC_IN`). Con `Feedback` e
`Feedbackheads` abilitati, TD invia al massimo 10 aggiornamenti al
secondo quando i valori cambiano e ripubblica lo stato ogni 5 secondi:

- `/mh/select` con la maschera delle teste selezionate, nell'ordine delle
  unità (attualmente MH1, MH6);
- per la prima testa selezionata: `/mh/pantilt`, `/mh/color`,
  `/mh/dimmer`, `/mh/zoom`, `/mh/focus`, `/mh/strobe` e `/mh/gobo`;
- `/dmx/group/mh` per il livello del gruppo teste.

Il feedback non fa eco dei comandi Plancia ricevuti negli ultimi 0,5
secondi e l'aggiornamento dei widget in ingresso non rimanda comandi a
TD. Il feedback della timeline (`Feedbackshow`) era stato lasciato
spento in attesa del follower Plancia, ora implementato; resta da
abilitarlo in TD e provarlo sul rig.
Riferimento lato TD: commit
[`f093c41` in TD4DMX](https://github.com/vsvisualsubstance-source/TD4DMX/commit/f093c412acb7ab5e4f1b200ec56840cbe7e2c6b7).

**Discrepanza da risolvere lato Plancia:** il selettore invia
`/mh/select/heads <uid>…`, ma TD restituisce la selezione come maschera
su `/mh/select`. Attualmente `applyWidgets()` aggiorna il widget
`head-select` solo per `/mh/select/heads`, perciò il feedback di
selezione TD non aggiorna le spie del selettore in Plancia. Va gestita la
maschera rispettando l'ordine delle teste pubblicato da TD (oggi MH1,
MH6), senza cambiare il comando di selezione per UID in uscita.

## Nota TD 19 (2026-10-16): catalogo fixture condiviso — FATTO lato Plancia

TD ha costruito un catalogo condiviso di **modelli** (`{model, kind,
channels, footprint, ...}`) e **tipi** (`{type, label, group, kind,
model, source}`) — sostituisce i canali fissi di `FIX_TYPES.ch` qui con
qualcosa di vero e condiviso, letto da `status.params.dmx_models`/
`dmx_types` e `dmx_matrix.catalog`. Comandi: `dmx_model_add`/`update`/
`remove`, `dmx_types`/`dmx_type_set`/`dmx_type_remove` su
`gaia/device/td-dmx-win/command`, stessa conferma-per-presenza-nello-
stato della nota 18 (non sul semplice invio).

**Implementato lato Plancia** (`plancia/index.html`):
1. `syncTypesToTD()` manda `dmx_types` con la tassonomia di Plancia —
   bottone esplicito "📋 TD", mai automatico: `dmx_types` sostituisce
   tutta la tassonomia di TD, non la fonde.
2. `FIX_TYPES.ch` fisso resta solo come fallback offline/prima
   connessione. I canali veri vengono da `footprintFor()`
   (`modelFootprint()`+`typeDefaultModel()`, che leggono
   `dmx_models`/`dmx_types`) — usato in `nextAddress()`, nell'indirizzo
   libero di creazione rapida e nella legenda della Pianta.
3. Editor fixture: menu "Modello" con i modelli del `kind` del tipo
   (da `dmx_models`), più un'opzione "+ Nuovo modello…".
4. "+ Nuovo modello…" chiede nome e numero di canali, manda
   `dmx_model_add` con solo `channels: N` (ruoli da completare dopo,
   come previsto dalla nota) e conferma-per-presenza in `dmx_models`.
5. Stessa conferma-per-presenza della nota 18, applicata anche al
   modello: dopo ogni add/update fixture, `f.model` si aggiorna col
   `profile` reale tornato da TD in `dmx_fixtures`.

**Verificato dal vivo** via Playwright: editor di una testa mobile già
patchata mostra "Generic Spot 11ch 16bit" (il modello vero letto da
TD) e universo/porta Art-Net reali; la legenda della Pianta passa da
16/8/24 ch (valori fissi di prima) a 11/4/4 ch (footprint vero dal
catalogo).

**Non fatto**: la lista dei `roles` per kind (`dmx_matrix.catalog.kinds.
<kind>.roles`) non è ancora usata — il nuovo modello si crea sempre col
solo numero di canali, mai con i ruoli espliciti.

Dettaglio completo nel commit TD4Gaia `65805d5` (nota interface 19).

## Nota TD 20 (2026-10-16): universi, indirizzi e doppioni — FATTO lato Plancia

TD ha trovato 19 gruppi di doppioni sul palco reale (ogni dispositivo
con Plancia aperta generava il proprio `uid` locale, quindi lo stesso
palco mandato da tablet/PC/kiosk diversi arrivava a TD come luci
diverse) e ha costruito gestione completa di universi/indirizzi/
conflitti. Implementato lato Plancia (`plancia/index.html`):

1. **Fonte unica per il palco**: all'apertura/connessione, appena
   arriva il primo `status` di `td-dmx-win` con `params.dmx_fixtures`,
   `importFromTD(true)` sostituisce in silenzio le fixture DMX locali
   con quelle `uid` `p-...` di TD — niente più ricostruzione da
   `defaultFixtures()` se TD ha già un palco. Mantiene però le fixture
   locali non gestite da DMX Master (in particolare LED wall, casse e
   laser), che non compaiono in `dmx_fixtures`. Verificato dal vivo via
   Playwright: nessun dialogo, Pianta popolata con indirizzi reali
   (es. `1.001`, `2.025`) alla prima apertura.
2. Bottoni "⇪ TD" (manda tutto, `on_conflict:'reject'`), "⇩ TD"
   (`importFromTD` manuale, con conferma) e "🧹 TD" (`resolveDuplicates`
   → `dmx_patch_resolve` con `apply:true`, poi re-import silenzioso)
   nel widget Palco.
3. Editor fixture: menu universo da `dmx_universe_map.universes` (solo
   le porte Art-Net vere), bottone "Primo indirizzo libero" da
   `freeAddressTD()`, invio con `on_conflict:'reject'` per avere
   `last_error` leggibile invece di scrivere un doppione.
4. Creazione rapida (`openFixAdd`): prova prima l'indirizzo libero da
   TD, altrimenti `nextAddress()` locale; invio con
   `on_conflict:'auto'`, poi risincronizza l'indirizzo reale assegnato
   da TD.

`dmx_patch_check` (anteprima batch, senza scrivere) non è ancora
usato: si è scelto `on_conflict` diretto su add/update, più semplice
per un editor singola-fixture-alla-volta. Da rivalutare se la Plancia
arriva a mandare lotti di fixture in un colpo solo.

Dettaglio completo nel commit TD4Gaia `adfd9b4` (nota interface 20).

## Plancia Video Service — gateway NDI→WebRTC (PoC, 2026-10-16)

Mauro ha proposto l'architettura in TD4PatchDeck
(`docs/architecture/plancia-video-service.md`): servizio Windows
dedicato che riceve sorgenti NDI e le offre al browser via WebRTC a
bassa latenza, isolato dal controllo show (un suo crash non deve mai
toccare TD/Resolume/DMX/laser). La proposta indicava GStreamer+
webrtcbin; **implementato invece in Python** (`ops/video-gateway/`,
stessa macchina OPS/SILVERMINI2 dove girano TD/PatchDeck/Resolume):

- `ndi-python` (bindings sul runtime NDI 6 già installato su OPS da
  NDI 6 Tools, nessuna installazione aggiuntiva) per ricevere i frame.
- `aiortc` (WebRTC nativo Python, niente GStreamer da compilare/
  wire-are su Windows) per l'encoding e la consegna al browser.
- `aiohttp` per la segnalazione HTTP — **stessa forma di API** proposta
  da Mauro: `GET /api/sources`, `POST /api/previews` (offer→answer
  SDP), `DELETE /api/previews/{id}`, `GET /api/previews/{id}/status`.
- Profilo preview: 640×360, downscale diretto (niente letterbox nel
  PoC). `NdiReceiver` condiviso per sorgente: più preview della stessa
  sorgente NDI non aprono connessioni NDI duplicate.
- Persistente su OPS via Scheduled Task `GAIA-OPS-VideoGateway`
  (`run_video_gateway_hidden.vbs` → `.bat`, stesso schema di
  agent/dhcp/osc-bridge/plancia), porta **8788**.
- OPS non ha accesso diretto a internet: le wheel Python (aiortc,
  aiohttp, numpy, ndi-python — tutte con binari precompilati per
  win_amd64/cp311, nessuna compilazione) si scaricano su Core e si
  copiano via scp, installazione offline con
  `pip install --no-index --find-links=...` (vedi
  `ops/video-gateway/requirements.txt`).

**Integrato in Plancia**: editor LED wall, sorgente "NDI (via Video
Service)" — bottone "Cerca sorgenti NDI" interroga `/api/sources` e
propone le sorgenti reali trovate sulla rete; il Render disegna il
video ricevuto esattamente come una sorgente URL (stesso
`drawVideoCover`, un `<video>` nascosto con `srcObject` invece di
`src`). `NET_DEFAULT` ha nuovi campi `video`/`videoPort` (stessa
macchina fisica in entrambi i profili casa/ops, a differenza di
`broker` che cambia).

**Verificato dal vivo** (Playwright, non solo sintassi): sorgente NDI
reale di PatchDeck ("MSI (PATCHDECK)") visibile nel Render di Plancia,
video fluido, `connectionState: connected`. Criteri di accettazione
della proposta di Mauro soddisfatti per il PoC a sorgente singola.

**Non fatto/non misurato**: latenza esatta in ms (serve un overlay con
timestamp lato TD per confrontarlo col browser); più client
contemporanei sulla stessa sorgente (l'architettura lo supporta via
`NdiReceiver.acquire`/`release`, ma non testato dal vivo); letterbox
invece di stretch sul resize; cosa succede se la sorgente NDI sparisce
a metà preview (nessun retry/riconnessione automatica implementato);
file/RTSP (fuori scope del PoC, solo NDI).
