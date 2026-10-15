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

## Tre canali, non uno

Plancia parla con Gaia su **tre canali indipendenti**, con destinazioni
diverse — non confonderli (stesso principio di
`minipc/touchdesigner/GAIA_TD_INTEGRATION.md`, "I canali tra Gaia e TD
— non confonderli"):

| Canale | Trasporto | Da → a | Cosa porta |
|---|---|---|---|
| **1. Widget Gaia-nativi** | MQTT su WebSocket, dal browser diretto al broker | Plancia (browser) ↔ broker Gaia (Core `.142:9001` o OPS `.240:19001`) | mood/pensieri, PatchDeck, device TD, DMX stanza (`gaia/dmx/+/...`) |
| **2. `/gaia/...` via bridge.js** | OSC/UDP | Plancia → `bridge.js` → **osc_bridge.py** (porta 9008) → MQTT `gaia/touchdesigner/<path>` | qualunque comando semantico Gaia (luci OpenHAB, mood delta, ecc. — stesso ingresso "canale 4" di TD, vedi `GAIA_TD_INTEGRATION.md`) |
| **3. Show control generico (`/dmx/`, `/mh/`, `/led/`, `/show/`)** | OSC/UDP | Plancia → `bridge.js` → **DMX Master** (TD, famiglia `dmx`), DIRETTO | teste mobili, LED, scene, timeline — non passa da Gaia/MQTT per niente |

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
  lato TD (TD4Gaia, non in questo repo) — da costruire.
- Nessun fallback/simulazione se DMX Master è irraggiungibile: il
  widget Palco di Plancia *già* simula in locale (vedi README), quindi
  l'operatore vede comunque qualcosa anche a canale 3 morto — ma non è
  un segnale di errore esplicito lato Plancia oggi.
