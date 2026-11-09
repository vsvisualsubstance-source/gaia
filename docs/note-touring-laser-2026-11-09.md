# Note del 9 novembre 2026: allineamento touring, DMX e laser

## Stato a fine giornata

| | OPS | Touring |
|---|---|---|
| Codice | ultimo commit su `main` | `b45c401` (da aggiornare domani) |
| Progetti Plancia | 19 | 19 |
| Rig Consolle e Fronte in TD | presenti | presenti |
| Barre consolle nella patch | 4 + 1 fronte | 2 (DX, SX) + 1 fronte, tolte di proposito |
| `dmx.toe` | **non salvato dal 05/11: serve Ctrl+S** | salvato il 09/11 alle 16:40 |
| Gateway laser | codice vecchio in memoria, laser non collegato | avviato alle 15:43 con `c2fd3fb` |

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
- **Rig in TD:** se un gruppo è in catalogo ma senza controlli, `dmx_groups` non lo ricrea. Vanno tolti barre e gruppi, poi rimandati. I rig creati vanno salvati nel `.toe`.
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
- Nessuna di queste è stata ancora provata sul laser vero nella versione finale.
