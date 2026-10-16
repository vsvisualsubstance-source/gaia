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

## Quattro canali, non uno

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
Il canale 2 esiste già (`osc_bridge.py` gira su Core e su OPS). **Il
canale 3 è quello nuovo, definito qui.**

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

`bridge.js` instrada per prefisso (`routeOf()` in `bridge.js`):
- `/gaia/...` → canale 2 (`GAIA_OSC_HOST`/`GAIA_OSC_PORT`, env var)
- tutto il resto → canale 3 (`OSC_HOST`/`OSC_PORT`, env var — e anche
  dall'interfaccia, persiste per-browser in `localStorage`)

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

**Cosa serve lato TD (DMX Master)**: un OSC In DAT in ascolto sulla
**7020**, che interpreta gli indirizzi della tabella in
`plancia/README.md` ("Mappa indirizzi dello show") e li traduce in
output Art-Net reale (stesso principio per cui oggi li simula in
locale il widget Palco di Plancia stesso — DMX Master fa la stessa
cosa ma sul rig vero). Non e' un `mocap_port` auto-annunciato: la 7020
e' fissa per convenzione (un solo DMX Master alla volta, non serve
profiling dinamico come per il mocap multi-istanza).

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
 value:{id,type,name,group,universe,address,x,y,enabled}}
```
Stesso meccanismo "Device TD" generico già in uso altrove
(`devCmd()`/`gPub()` in `plancia/index.html`), nessun nuovo trasporto.
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

## Cosa NON è ancora stato fatto

- L'OSC In su DMX Master (7020) che interpreta `/dmx/...`/`/mh/...` è
  lato TD (TD4Gaia, non in questo repo) — **in costruzione ora**.
- Canale 1b (design dello show, sopra): schema solo proposto, nessun
  codice né lato Plancia né lato DMX Master.
- Nessun fallback/simulazione se DMX Master è irraggiungibile: il
  widget Palco di Plancia *già* simula in locale (vedi README), quindi
  l'operatore vede comunque qualcosa anche a canale 3 morto — ma non è
  un segnale di errore esplicito lato Plancia oggi.

## Nota TD 19 (2026-10-16): catalogo fixture condiviso — NON ANCORA FATTO

TD ha costruito un catalogo condiviso di **modelli** (`{model, kind,
channels, footprint, ...}`) e **tipi** (`{type, label, group, kind,
model, source}`) — sostituisce i canali fissi di `FIX_TYPES.ch` qui con
qualcosa di vero e condiviso, letto da `status.params.dmx_models`/
`dmx_types` e `dmx_matrix.catalog`. Comandi: `dmx_model_add`/`update`/
`remove`, `dmx_types`/`dmx_type_set`/`dmx_type_remove` su
`gaia/device/td-dmx-win/command`, stessa conferma-per-presenza-nello-
stato della nota 18 (non sul semplice invio).

**5 cose da fare lato Plancia (dalla nota, non ancora iniziate)**:
1. Mandare `dmx_types` con la tassonomia vera di Plancia invece di
   lasciare i tipi builtin.
2. Togliere `FIX_TYPES.ch` fisso — i canali di una fixture diventano il
   `footprint` del suo modello in `dmx_matrix.catalog.models` (uso
   anche in `nextAddress()` e in pianta).
3. Editor fixture: menu "Modello" (i modelli del `kind` del gruppo) +
   campo `model` mandato a TD.
4. Possibilità di creare un modello nuovo dall'editor (`dmx_model_add`).
5. Stessa conferma-per-presenza della nota 18, applicata a modelli/tipi.

Dettaglio completo nel commit TD4Gaia `65805d5` (nota interface 19).
