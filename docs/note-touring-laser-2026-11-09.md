# Note del 9 novembre 2026: allineamento touring, DMX e laser

## Stato a fine giornata

| | OPS | Touring |
|---|---|---|
| Codice | ultimo commit su `main` | `b45c401` (da aggiornare domani) |
| Progetti Plancia | 19 | 19 |
| Rig Consolle e Fronte in TD | presenti | presenti |
| Barre consolle nella patch | 4 + 1 fronte | 2 (DX, SX) + 1 fronte, tolte di proposito |
| `dmx.toe` | **dal 10/11 in `C:\Users\vsvis\Documents\td\DMX V8` (Drive solo backup). Il 10/11 i rig Consolle e Fronte mancavano, ricreati alle 11:22 con le 5 barre tornate `ok`: da salvare nel `.toe`. Da tarare: hanno i valori di base** | salvato il 09/11 alle 16:40 |
| Gateway laser | riavviato il 10/11 alle 07:24 con il codice nuovo, laser non collegato | avviato alle 15:43 con `c2fd3fb` |

Il laser è stato staccato dalla touring nel pomeriggio.

## Sicurezza: maschere

Fino al commit di oggi le maschere controllavano solo gli estremi delle linee: una linea lunga attraversava una maschera restando accesa (84 campioni su 104, misurato). Corretto nel gateway su OPS. **Sulla touring la correzione non è attiva finché non si aggiorna e si riavvia il gateway: fino ad allora le maschere non vanno considerate affidabili.**

## Da fare domani sulla touring

1. `git pull --ff-only` in `C:\gaia`, poi `node build-app.js` in `plancia`.
2. Riavviare il gateway laser: attiva la correzione delle maschere, i tempi nuovi e la sosta a fine linea. **Da fare prima di riarmare il laser.**
3. Con il laser collegato: premere Template per avere Pioggia, Nuvola, Scintille e Coriandoli.
4. Reimportare gli SVG già caricati: la correzione degli spigoli vale solo per i nuovi import.
5. Provare griglia e quadrato a 9.000 e a 20.000 punti. Se a 20.000 si deforma ancora, provare blank shift 2, 4, 6.
6. Decidere se la consolle deve avere 2 o 4 barre su entrambe le macchine.

## Errori di comunicazione e DHCP del laser

Il DHCP della touring è stato avviato alle 14:55 e ha assegnato un solo indirizzo, al laser (192.168.1.50). Dopo non risultano altre richieste.

- Le interruzioni SSH delle 14:41 e subito prima delle 14:55 sono **precedenti** al DHCP.
- Il blocco di TouchDesigner delle 16:35 non è un problema di rete: TD restava collegato al broker locale con CPU quasi a zero. La causa non è stata trovata.
- Non si può escludere un disturbo minore mentre il cavo era collegato: Ethernet (.240) e Wi-Fi (.134) stavano sulla stessa sottorete con la stessa priorità.

Conclusione: nessuna prova che il DHCP abbia causato gli errori. Il server DHCP è ancora attivo sulla touring. Ora il cavo Ethernet è scollegato.

## Cose imparate

- **Riavvio laser sulla touring:** il `disable` via MQTT non ha chiuso il gateway e ha lasciato l'agent senza rispondere ai comandi del laser. Ha funzionato chiudere solo `agent.py` e `gaia-audio`, a gateway già chiuso, poi `Start-ScheduledTask GAIA-OPS-Agent`.
- **Rig in TD:** i rig vivono solo nel `.toe`, le tabelle nei `.tsv`: si possono disallineare. Dal 10/11, solo su OPS, `group_logic.py` ha `restore_missing_rigs()` e `dmx_groups` ricrea il rig che manca senza toccare la patch. Da portare sulla touring e da committare in TD4Gaia. I rig creati vanno salvati nel `.toe`.
- **Attenzione:** `dmx_groups` in TD toglie i rig vuoti che non sono nella lista ricevuta. Dal 10/11 la Plancia di OPS manda anche i rig degli altri show. Sulla touring, finché non è aggiornata, Salva e invia può ancora toglierli.
- **Broker sulla touring:** con WSL mirrored si raggiunge solo da `127.0.0.1`. In TD: Brokerhost = `127.0.0.1`.
- **Reimport da TD:** dal commit `b45c401`, se Pianta e patch sono diverse si ferma e avvisa.
- **Laser:** riferimento reale 9.000 punti al secondo. A parità di figura la velocità degli specchi è limitata dal ridisegno a 25 Hz. Rete e cubo sono risultati a posto (massimo 30.000 punti, 0 errori).

## Modifiche al laser di oggi

- Render: tempi e velocità agganciati a 9 kpps, soste a tempo su spigoli e riaccensioni, sosta a fine linea, niente salto a fine frame.
- Import SVG: gli spigoli veri vengono trovati e i tratti dritti ridotti a due punti.
- Render 3D della Plancia: laser proiettato su un piano.
- Scene nuove: Pioggia, Nuvola di punti, Scintille, Coriandoli.
- Zone di sicurezza a forma (cerchio, ovale, trapezio, esagono, disegnata) e maschere a forma, tagliate esattamente sui bordi.
- Effetti di fascio: Ventaglio, Onda di fasci, Stella di fasci, Foglio di luce, Cono, Tunnel aperto, segnati "fumo" nella libreria. Si ottengono col pulsante Template.
- Limite del tempo su un punto nel gateway: se un punto riceve più del 15% del tempo del frame, tutto il frame si abbassa in proporzione. Non è una certificazione di sicurezza: la zona sopra le teste resta obbligatoria.
- Disegno a mano: "+ Disegna" nelle scene, con diretta sui cubi facoltativa.
- Ruota Tinta (10/11): sceglie il colore delle figure, al centro restano i colori della scena. Sulla touring servono il riavvio del gateway laser e quello del bridge Plancia.
- Adatta (10/11): all'import di SVG e ILDA imposta la Dimensione per una figura pulita, se basta scendere fino a 0,5. Sotto quel valore il pulsante Adatta nella scena propone di togliere le linee piccole.
- Libreria ILDA (10/11): `+ Libreria` nelle scene sfoglia `plancia/data/laser-lib` (131 scene da ShowNET Extended Set, 11 MB, fuori da git). Per averla sulla touring: copiare i file `.ild` via Drive e lanciare `node laser-lib-build.js "<cartella>"`, poi riavviare il bridge. Solo 19 sono effetti di fascio: da provare nel fumo e con la zona di sicurezza.
- Nessuna di queste è stata ancora provata sul laser vero nella versione finale.

## Da verificare: flusso tra progetto, pagina Altro e TD (10/11)

Dal 10/11, solo su OPS e non ancora su GitHub: scaletta delle scene per progetto (☰ Scaletta in Scene GO e in ▣ Scene, salvata con il progetto), avviso a ogni apertura di progetto se Pianta e TD non coincidono, e "Salva e invia a TD" che non toglie più i rig degli altri show. Resta aperto Colori rig automatico. I punti sotto sono l'analisi di partenza.

**Color Pic, 10/11, solo OPS:** il modello `COLOR PIC 24x3W 14CH` era un segnaposto e l'uscita DMX di queste barre era a zero. Ruoli presi dal profilo Daslight BoomToneDJ ColorPix 24x3W del vecchio show Albergo dei Poveri: `dimmer strobe red green blue mode dimmer2 strobe2 red2 green2 blue2 mode2 macro speed`. Il generatore (`dmx_generator_callbacks1.py`) fa seguire la seconda sezione alla prima. Da confermare sulle barre vere con Test canali. Da portare sulla touring insieme a `group_logic.py`, compilando il modello da dentro TD e non con `dmx_model_update` da remoto. Da committare in TD4Gaia.

- Altro raccoglie le pagine fuori dai menu standard. In Lowtopic 28/11 è solo Colori rig. I blocchi sono salvati nel progetto e non seguono i rig: un rig nuovo va aggiunto a mano.
- Aprire un progetto cambia la Plancia ma non TD, che tiene la sua patch finché non si preme ⇪ TD. L'avviso di patch diversa parte solo all'apertura della pagina, non al cambio progetto. Ipotesi: avvisare a ogni cambio progetto.
- Il blocco Scene DMX Master mostra tutte le scene di TD: le scene nascoste per progetto valgono solo nella tabella delle scene. Ipotesi: applicarle anche lì.
- Scene GO (Regia) ha lo stesso limite: elenca tutte le scene di TD, nell'ordine di TD, senza poterle scegliere né riordinare. Richiesta del 10/11: gestire la selezione in modo più dinamico, oppure avere le scene GO per progetto. Le scene in TD restano in comune fra i progetti: la scaletta va salvata nel progetto, senza cancellare quelle degli altri show.
- Sempre in Scene GO: BACK segue l'ordine dell'elenco e non l'ultima scena mandata. NEXT vale solo sul browser in cui è stato preparato.

## Da fare: SVG per il laser (10/11)

Consigli LaserCube: meno di 500 punti di ancoraggio, solo tracciati pieni, niente sfumature né ombre. Nella libreria ILDA la regola regge, ma non basta da sola: 16 scene sotto i 500 punti sono comunque medie o pesanti per la strada degli specchi, quindi il calcolo del peso resta il riferimento.

- Idea non ancora fatta: all'import SVG avvisare se il file contiene sfumature, ombre (`filter`) o immagini, che non verranno disegnate.
- Per chi prepara gli SVG: colore solo sul contorno, niente ombre (se esportate come forme separate diventano linee in più), testi convertiti in tracciati.
