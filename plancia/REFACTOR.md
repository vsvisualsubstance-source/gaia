# Refactor della Plancia (2026-10-28/29): storia

> **Concluso e in esercizio.** Il lavoro è stato fatto nel fork
> `plancia-next` (GitHub `vsvisualsubstance-source/plancia-next`, storia
> commit per commit), provato dal vivo dall'operatore e riportato in
> `gaia/plancia` il 2026-10-29 (`32bf0b0`). Da allora la Plancia si sviluppa
> solo qui; il fork non si aggiorna più. Questo file resta come storia delle
> scelte e delle misure. Come è fatto oggi il codice: README, "Struttura del
> codice".

Il fork era estratto dalla cartella `plancia/` del repo `gaia` con tutta la
storia (`git subtree split`, 67 commit fino a `4a2d663`, 2026-10-28).

## Regole

- **Nessuna riscrittura totale.** Passi piccoli; ogni commit deve lasciare
  l'app funzionante e passare i test e lo smoke test UI.
- **Compatibilità**: stessi protocolli OSC/MQTT, stessa semantica di
  `addr`, `oscChannel`, `value`, `mode`, `midi`; layout JSON e progetti
  salvati devono caricarsi identici; catena delle migrazioni `uiRev`
  invariata (oggi fino a 7).
- **Niente framework e niente compilatore.** Il bundle resta servito dal
  bridge senza dipendenze (funziona offline in club). Se servono i tipi:
  JSDoc + `// @ts-check`, non TypeScript.
- **Prova accanto alla Plancia vera**: `run_dev.bat` (porta 8092, feedback
  OSC 9010, dati in `data/`, OSC verso nessuno, timeline video/laser
  verso device inesistenti). Il broker MQTT invece e' quello vero: i comandi
  MQTT dei widget arrivano davvero. Per una prova isolata: `?broker=0.0.0.0`.

## Stato di partenza (misurato, non presunto)

33 moduli in `src/`, concatenati da `build-app.js` in un'unica IIFE
(scope condiviso), piu' lato bridge `bridge.js`, `video-timeline.js`,
`laser-timeline.js`, `fixture-lib.js`, `stage-ai.js`.

Problemi concreti visti lavorandoci:

1. **Switch sul tipo di widget sparsi**: un widget nuovo (es. `laser`) tocca
   `00-core-state` (DEF, NAMES), `40-widget-rendering` (build, noVal, addr),
   `41-widget-interactions`, `80-animation-loop`, `95-help-tour`,
   `20-layout-and-templates`, `index.html`.
2. **Ordine di avvio implicito**: il primo `render()` parte dalla coda di
   `90-settings-and-bootstrap.js`, prima che i moduli successivi siano
   valutati. Le funzioni usate dal primo render vanno scritte come
   `function` (hoisting); un `const`/`let` lassu' da' errore. Trappola
   fragile.
3. **I/O che decide il comportamento**: la pagina senza MQTT chiedeva da
   sola l'uscita OSC a DMX Master, e il cambio di trasporto svuotava lo
   stato reale (bug delle teste "che si resettano", 2026-10-28).
4. **Messaggi in arrivo**: ogni OSC scorre tutti i widget di tutte le pagine
   (`applyWidgets`); il loop ridisegna su `G.dirty` o ogni secondo.
5. **Doppia verita' reale/simulato**: simulazione locale `SH` e uscita reale
   di DMX Master (`DMX_OUTPUT`, MQTT o riserva OSC) si mescolano nel Render
   caso per caso. E' l'area piu' soggetta a bug.

## Passi

0. **Rete di sicurezza** (prima di toccare l'architettura)
   - FATTO: `npm run smoke` (`test/ui-smoke.js`): bridge di prova su porta
     libera con copia dei dati, browser headless in simulazione, ogni pagina
     aperta, eccezioni ed errori di console raccolti, uno screenshot per
     pagina in `test-output/smoke/` (+ `report.json`). Prima del refactor:
     13 pagine, 0 problemi. Verificato che intercetta un errore inserito;
   - FATTO: `npm run characterize` (`test/characterize.js`): build di test
     con `window.__planciaTest` (opzione `testHooks` di `build-app.js`, assente
     nel bundle dei tablet) e confronto con `test/snapshots/characterization.json`:
     `argsOf` di tutti i 19 tipi di widget a valori scelti, messaggi davvero
     spediti al bridge (OSC con canale, MIDI CC), pagine dei 12 template,
     un layout di vecchio formato lungo tutta la catena `uiRev` (0 -> 7),
     layout dei dati veri identico dopo un ricaricamento. Deterministico;
     verificato che un pulsante invertito da' 4 differenze puntuali.
     Un cambio voluto si registra con `npm run characterize -- --update`.
   - `npm run check` = test unitari + caratterizzazione + smoke: da lanciare
     prima di ogni commit del refactor.
1. **Avvio esplicito** — FATTO: la riga di avvio (migrazioni, primo
   `render()`, connessioni, loop) e' la funzione `init()` di
   `90-settings-and-bootstrap.js`, chiamata da `src/999-start.js`, ultimo
   modulo del bundle. Da qui in poi una funzione usata dal render puo' essere
   anche `const`. Restano a livello di modulo solo dichiarazioni, listener e
   timer (verificato modulo per modulo). Un test impedisce di tornare indietro.
   Caratterizzazione identica, smoke 13/0.
2. **Registro dei widget** — FATTO. `src/05-widget-registry.js`:
   `registerWidget(type, {size, label, showsValue, showsAddr, inner,
   onPointer, tick, help})`; i cinque punti di smistamento (DEF/NAMES,
   interno/valore/indirizzo, tocco, loop, aiuto) consultano prima il registro,
   i tipi non registrati passano ancora dagli switch.
   - `laser`: FATTO, registrato in `99-laser.js`, sparito dagli switch
     (un test lo impedisce per ogni tipo registrato). Caratterizzazione
     identica; `test/laser-widget.js` prova tocco, loop e aiuto nel browser
     con un gateway finto. Trovato e corretto l'aiuto vecchio (parlava della
     modalita' DMX tolta).
   - `fixgrid`, `cuestack` (in `94-console-widgets.js`) e `audiorigs` (in
     `96-audio-rigs.js`): FATTI. `test/widget-registry.js` verifica nel
     browser OGNI tipo registrato: contenuto da `inner`, valore/indirizzo
     nascosti come dichiarato, tocco senza errori, aiuto della visita guidata
     uguale a quello registrato (piu' un tocco con effetto per `fixgrid`).
     Verificato che scatta se il registro non viene consultato.
   - Controlli di base in `42-control-widgets.js`: fader, knob, xy, button,
     meter, color, label, clock: FATTI. Il registro ha in piu' `paint`
     (disegno del valore), `valueText`, `args` (argomenti OSC) e
     `showsValue` anche come funzione (il pulsante mostra il valore solo se
     interruttore). Il tocco usa `startDrag()` (cattura + salvataggio a fine
     gesto, come la parte comune di prima). `test/widget-registry.js` ora
     tocca ogni widget con un mouse vero (CDP) e controlla che fader, pad,
     pulsante e colore cambino valore: 12 tipi verificati.
   - Famiglia Gaia (gaia, patchdeck, tddevice, gaiadmx): FATTA, quattro
     `registerWidget` in fondo a `72-gaia-interactions.js` con uno spec comune
     (`gInner`, `gPaint`, `gBind`); nuovo hook `mounted(el,w)` dopo la
     costruzione (canvas e classe `narrow` del widget gaia). `GAIA_TYPES` e'
     uscito dai punti di smistamento: resta solo nell'ispettore e nel
     ridimensionamento in modifica griglia. 16 tipi verificati nel browser.
   - `stage` (Palco): FATTO, registrato in fondo a `61-stage-fixtures.js`
     (barra strumenti, Pianta, Render a tempo con `level`, riga di stato);
     il contesto di `tick` ha in piu' `level` (pulsazione dello show);
     `stageRenderVisible()` per le anteprime video. 17 tipi verificati,
     con tocco "Pianta" che cambia vista.
   - `timeline`: FATTA, modulo proprio `43-timeline-widget.js` (contenuto con
     le tracce, tocco su trasporto/cue/traccia, aggiornamento a ogni
     fotogramma). Il MOTORE che fa avanzare il tempo e manda le cue resta nel
     loop (80) e in 30-show-engine.js: e' il passo 4. 18 tipi verificati.
   - `scenes`: FATTO, modulo `44-scene-widgets.js` (i sei modi smistati dentro
     il tipo); `showsAddr` come funzione (palette dei rig senza indirizzo),
     flag `refreshOnResize` (scenes e famiglia Gaia, ricostruiti quando si
     ridimensionano in Modifica griglia). 19 tipi verificati, tocco su una
     voce che si accende. Nessun tipo e' piu' negli switch.
   - Ispettore di "Modifica griglia": FATTO. `renderInsp` tiene la parte
     comune (etichetta, indirizzo, canale, range, MIDI, colore, duplica/elimina)
     guidata da `oscAddress`, `addrLabel`, `range`, `midi`; la parte del tipo e'
     `spec.inspector = {html, bind, footer}` nei moduli dei tipi. `GAIA_TYPES`
     non esiste piu'. Prima di spostarlo la caratterizzazione ha fotografato
     l'ispettore (22 varianti, HTML e valori): identico dopo. `test/inspector.js`
     modifica un campo per tipo e controlla che arrivi al widget (verificato
     che scatta).
3. **Bus dei messaggi** — FATTO. Prima la caratterizzazione ha fotografato
   i messaggi in arrivo (`incoming`: OSC su un layout di prova con ogni tipo
   che riceve, MQTT per ogni famiglia di topic).
   - OSC: FATTO. Ogni tipo che ascolta dichiara `receive(w,args)` nel registro
     (fader, knob, meter, xy, button, color, scenes); `applyWidgets` non
     scorre piu' tutti i widget di tutte le pagine ma un indice indirizzo ->
     widget (`oscListeners` in 05), invalidato da `save()`, `render()` e dal
     cambio di `L`. Caratterizzazione identica; `test/inspector.js` cambia
     l'indirizzo di un fader dall'ispettore e controlla che l'OSC sul nuovo
     indirizzo lo trovi (verificato che scatta senza invalidazione).
   - MQTT: FATTO. `src/06-message-bus.js`: `onMqtt(pattern, fn)` con `+`/`#`,
     `gIn` sceglie il primo pattern che corrisponde (un gestore che
     restituisce false non chiede di ridisegnare), le iscrizioni al broker
     sono `mqttTopics()`: un topic nuovo si aggiunge in un posto solo. I
     gestori stanno accanto al codice che usano: orologio dello show in 30,
     anteprima dei cubi in 99-laser, il resto in fondo a 70. La
     caratterizzazione fotografa ora anche l'orologio e l'elenco dei topic
     (23, uguali alla lista scritta a mano di prima); identica per il resto.
   - Il bus di 40 (`bus()` -> `model` + `timelineBus`) resta com'e': pochi
     ascoltatori fissi, nessun vantaggio a indicizzarlo.
4. **Involucro su `L`** — MISURATO, NON SI FA (per ora). `npm run perf`
   (`test/perf-ticks.js`, `--mqtt` aggiunge traffico come dal vivo:
   `dmx_rigs` 30/s, livelli audio 10/s) misura per pagina il tempo dei `tick`
   per fotogramma. Su OPS, con traffico: massimo 1,4 ms su 16,7 (Regia), di
   cui 1,3 il Render del palco, che ridisegna a ogni fotogramma per scelta;
   i widget che si ridisegnano su `G.dirty` (Gaia, PatchDeck, console, rig
   audio, laser) stanno sotto 0,2 ms in tutto, anche quando il traffico li fa
   ridisegnare al 60% dei fotogrammi. Un involucro su `L` con insieme dei
   widget sporchi aggiungerebbe complessita' senza un guadagno misurabile.
   Da riprendere solo se la misura su un tablet lento dice il contrario.
5. **Stato effettivo reale/simulato** — FATTO. Prima la caratterizzazione
   ha fotografato il Render del palco su un canvas fuori schermo a stato fisso
   (impronta dei pixel e colore medio) in tre casi: solo simulazione, uscita
   reale di DMX Master per tutte le fixture, meta' e meta'; con blinder e
   nebbia aggiunti per la foto (il layout vero non li ha). Verificato che un
   livello reale dimezzato da' differenze.
   - `fixtureOutput(f,{at,model})` in `49-dmx-output.js`: `null` se DMX Master
     non e' fresco o non conosce la fixture (vale la simulazione), altrimenti
     `{record, color, level, angles}`. Sostituisce `feedbackFor`,
     `outputColor`, `outputLevel` e le chiamate sparse a `dmxHeadAngles` nel
     Render (wall, uplight, teste, barre, blinder, nebbia) e la scelta nella
     griglia Luci (94). Test unitari in `test/dmx-output.test.js` (fresco o
     scaduto, inviata o no, solo intensity, buio, fixture sconosciuta, angoli
     col modello). Render identico al pixel nei tre casi.
   - Restano su `dmxOutputFresh()` le scelte che non sono per fixture: tinta
     di un gruppo per le palette (70), livelli dei rig audio (96), testo della
     scena nella riga di stato del Palco (61).
6. Solo se serve ancora: ES modules per cartella (`state/`, `widgets/`,
   `stage/`, `io/`, `engine/`, `gaia/`, `ui/`), con la build che li unisce.

## Uscita

Per tornare in `gaia`: quando un passo e' stabile e provato dal vivo con
`run_dev.bat`, si riporta in `gaia/plancia` (stesso albero di file) con un
commit normale, e si prova sulla Plancia in esercizio fuori dagli show.

---

# Fase 2: sincronizzazione del layout (dopo BASE, dal 2026-11-01)

Da una revisione del 2026-10-29, dopo il lampeggio di timeline e Render dello
stesso giorno. Il refactor della fase 1 ha sistemato la struttura del codice;
la fragilita' che resta e' **come i client si scambiano il layout**.

## Il problema, misurato

- Ogni fine gesto chiama `save()` (`startDrag` in `42-control-widgets.js`;
  `save()` e' chiamato in circa 90 punti). `save()` -> `store.set` ->
  `sharedStateChanged()` (`00-core-state.js`) manda **tutto** lo stato
  condiviso (layout + progetti + `projectData`, circa 740 KB in
  `data/state.json`) dopo 200 ms.
- `bridge.js` (`saveSharedState`) lo salva e lo rimanda intero a tutti i
  client (`shared_update`); `acceptSharedState()` (`00`) fa `render()`
  completo: tutti i widget ricostruiti, canvas del Render e timeline compresi.
- Conseguenze:
  1. ogni fader rilasciato su un tablet ricostruisce tutte le pagine degli
     altri; un tocco in corso altrove si puo' interrompere;
  2. l'ultimo salvataggio vince sul documento intero: due operatori su
     pagine diverse si sovrascrivono;
  3. dati derivati da TD salvati nel layout (`headValues`/`items` dei
     selettori teste) fanno rimbalzare il layout tra due pagine che non sono
     d'accordo (lampeggio del 2026-10-29: una pagina con 5 teste, TD ne
     pubblicava 6). Caso chiuso da `7deb040` (un layout ricevuto non si
     risalva; solo una pagina collegata a MQTT scrive le teste), la classe
     di problemi no.
- Fino alla fase 2, regola d'uso: **una sola pagina da cui si tocca**; le
  altre solo per guardare; dopo ogni aggiornamento ricaricare tutte le
  pagine; durante lo show nessuna istanza di prova (8092) aperta.

## Regole (come la fase 1)

Passi piccoli, `npm run check` verde a ogni commit, protocolli OSC/MQTT,
`show_timeline`, catena `uiRev` e formato di `data/state.json` invariati (o
con migrazione). Ogni passo provato prima con `run_dev.bat` e **due tablet
veri**, mai messo in esercizio nei giorni di show.

## Passi

1. **Niente ricostruzione completa per un layout ricevuto** (1-2 giorni).
   In `acceptSharedState()` confrontare la struttura nuova con quella in uso:
   pagine, e per ogni widget `id`, `type`, `x/y/w/h`, `addr`, `mode`,
   `oscChannel`, `label`, piu' `fixtures` e `stage`. Se e' uguale e cambiano
   solo i valori (`value`, `valueY`, `selectedHeads`…): copiarli sugli
   oggetti esistenti e chiamare `paint` dal registro (`widgetType(t).paint`),
   niente `render()`. `render()` solo se cambia la struttura.
   - Test: estendere `test/shared-loop.js` con un secondo client che cambia
     il valore di un fader; un `MutationObserver` su `#stage` deve contare
     zero widget ricostruiti e il fader deve mostrare il valore nuovo. Un
     secondo caso cambia la posizione di un widget: li' il render serve.
   - Sonda per verificare dal vivo: lo script del 2026-10-29 che apre la
     Plancia vera in Edge senza schermo e conta i widget ricostruiti per
     secondo (`MutationObserver` sui figli di `#stage`); da mettere in
     `test/` come `npm run probe`.
2. **Il bridge segnala le tempeste di scritture.** In `saveSharedState`:
   contare i salvataggi per client; oltre ~3/s per 5 s, o contenuto che
   alterna tra due versioni, scrivere nel log IP del client e revisioni.
   Nessun rifiuto all'inizio, solo diagnosi (oggi per trovarlo e' servito
   uno script).
3. **Salute e sorveglianza.** `GET /health` nel bridge: revisione, client
   collegati (IP), ultimo OSC in ingresso, ponte `/mqtt` aperti, stato delle
   tracce VIDEO/LASER. Poi la Plancia gestita dall'agent come servizio
   (riavvio se cade) invece della sola attivita' pianificata all'accesso
   (`GAIA-OPS-Plancia`); attenzione a non usare kill per nome di processo.
4. **Dati derivati da TD fuori dal layout.** I selettori delle teste
   (`syncHeadSelectors` in `70-gaia-mqtt.js`) ricavano l'elenco da
   `tdHeadEntries()` al disegno; nel layout resta solo la scelta
   dell'utente (`selectedHeads`). Migrazione `uiRev` 8 che toglie
   `headValues`/`items` salvati. Cercare altri casi simili (dati di TD
   copiati nei widget e salvati).
5. **Valori separati dalla struttura nel protocollo** (settimane). Nuovo
   messaggio WebSocket `{type:'values', changes:[{id, value, valueY,
   selectedHeads}]}`: piccolo, frequente, applicato dal bridge allo stato
   persistito e rimandato agli altri; `shared_state` resta per la
   struttura e diventa raro. Il bridge serve il codice a tutte le pagine,
   quindi niente versioni miste (ricaricare comunque tutto dopo
   l'aggiornamento). Toglie il punto 1 della lista del problema e riduce
   molto il 2.
6. **Rete ammessa, configurabile.** Elenco di reti (LAN, hotspot
   `192.168.137.0/24`, Tailscale `100.64.0.0/10`) per WebSocket, `/mqtt` e
   `shared_state`; facoltativo un token nell'URL per i tablet. Spento di
   default.
7. **Bridge in moduli testati in Node**: archivio dello stato condiviso
   (revisioni, tempeste), relay OSC, ponte MQTT, salute; test di
   concorrenza dei salvataggi, oggi assenti.
8. **`// @ts-check` + JSDoc** su `00`, `05`, `06`, `49`, `63`, controllati
   con `tsc --noEmit` solo in sviluppo (niente compilazione a runtime).
9. **Comportamenti per indirizzo dentro il registro**: i 14 controlli sul
   tipo rimasti (regole speciali di `scenes` per `/dmx/scene`,
   `/mh/position`, `/led/*`, in `30`, `61`, `70`, `90`) diventano modi
   espliciti, con migrazione `uiRev`.

Solo se servira': revisione per pagina (chi modifica una pagina non
sovrascrive le altre); moduli ES per cartella; decidere se la timeline
locale della Plancia resta "solo prova senza TD" o si toglie.

## Da non fare

- Riscritture (Rust, Tauri, framework): i client sono tablet con un
  browser e i rischi sono di protocollo e di modello dello stato, non di
  linguaggio.
- Cambiare contratti OSC/MQTT, `show_timeline`, la catena `uiRev` (si
  aggiunge, non si toglie) o il formato di `data/state.json` senza
  migrazione.
- TypeScript compilato, bundler, CDN: la Plancia deve funzionare offline e
  partire con `node build-app.js && node bridge.js`.
- Spostare l'esecuzione della timeline dello show fuori da TD; togliere la
  simulazione (serve a prove e test).
