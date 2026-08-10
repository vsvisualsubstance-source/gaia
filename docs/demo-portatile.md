# Demo portatile — Core, OPS, Pi in trasferta

Come mostrare GAIA fuori casa senza toccare codice: si portano fisicamente
Core, OPS, Pi e il bridge Hue, tutti via cavo Ethernet a uno switch non
gestito. **Core stesso** eroga DHCP sulla propria porta Ethernet e assegna a
ciascun device lo stesso IP che ha a casa (vedi `minipc/network/`) — così
ogni riferimento hardcoded nel repo (broker MQTT `192.168.1.142`, `gaia_admin`
`:8765`, Node-RED su OPS `192.168.1.240`, bridge Hue `192.168.1.80` in
OpenHAB) resta valido, nessun router esterno, nessun internet necessario.

Decisione presa dopo aver scartato due alternative più complesse: un OPS
reso completamente autonomo (mosquitto+Qdrant+OpenHAB duplicati lì, nuovo
pairing Hue) e un router da viaggio esterno — entrambe più lavoro usa-e-getta
di quanto valesse per una demo. Dettagli in memory
`project-architettura-core-ops` e nella cronologia di questa decisione.

## IP riservati (uguali a casa)

| Device | IP | Servizi che vi si ancorano |
|---|---|---|
| Core | `192.168.1.142` | mosquitto (`:1883`/`:9001`), gaia_admin (`:8765`), gaia-camera (`:8766`), Ollama/Qdrant/OpenHAB (docker) |
| OPS (silvermini2) | `192.168.1.240` | Node-RED (HTTP+WS `/gaia`, `:1880`) |
| Pi (ingresso) | `192.168.1.190` | yolo/mediapipe/voice — via WiFi esistente **o** cavo, vedi nota sotto |
| Bridge Hue | `192.168.1.80` | pairing/token OpenHAB già salvato, riusato senza nuova configurazione |

Le reservation DHCP per MAC sono in `minipc/network/gaia-demo-dnsmasq.conf`;
i comandi per attivare/disattivare la rete in `minipc/network/README.md`.

## Nota Pi: doppia interfaccia, nessuna modifica alla sua config

Il Pi a casa è normalmente su WiFi, non Ethernet, e ha una sua logica di
provisioning (`pi/provision/provision.py`, vedi `provisioning-wifi.md`): se
resta senza rete per `OFFLINE_GRACE_S` (180s) diventa lui stesso un AP
captive-portal per la riconfigurazione. **Questa logica non si tocca.** Per
la demo si collega anche il cavo Ethernet al Pi, in aggiunta al WiFi
esistente — NetworkManager sul Pi gestisce da solo la doppia interfaccia. Se
il cavo non desse link per qualunque motivo, il Pi ha comunque il suo
fallback WiFi/captive-portal come rete di sicurezza, invariato.

## Checklist pre-partenza (a casa)

1. Setup una tantum del profilo di rete: `minipc/network/README.md`.
2. **Dry-run consigliato**: staccare Core dal router di casa, collegarlo a
   uno switch isolato con OPS/Pi/bridge Hue, attivare `Gaia-Demo`,
   verificare che tutti prendano l'IP giusto, poi tornare al profilo di
   casa.
3. Verificare che i container Docker su Core ripartano da soli dopo un
   riavvio fisico reale (sono `restart: unless-stopped`, ma non testato su
   uno spegnimento/trasporto vero).
4. Spegnimento pulito di Core/OPS prima del trasporto (`systemctl
   poweroff`/shutdown ordinato, non stacco a freddo — protegge i volumi
   Docker).
5. Da portare: Core, OPS, Pi + camera/mic, bridge Hue + lampadine reali,
   switch Ethernet non gestito, cavi, alimentatori.

## Checklist all'arrivo (sede demo)

1. Collegare Core, OPS, bridge Hue allo switch via cavo; collegare anche il
   Pi via cavo (WiFi resta attivo, vedi nota sopra).
2. Su Core: `sudo nmcli connection up Gaia-Demo`.
3. **Subito dopo**, riaprire il forwarding Docker→LAN demo (vedi gotcha
   sotto — questa regola NON è persistente, va rifatta ogni volta che
   Gaia-Demo viene riattivata):
   ```bash
   sudo iptables -L nm-sh-fw-enp0s31f6 -n --line-numbers   # verifica il numero della riga REJECT (di norma 4)
   sudo iptables -I nm-sh-fw-enp0s31f6 4 -i br-7c03e36e5754 -o enp0s31f6 -j ACCEPT
   ```
   Se i container Docker sono già partiti (autostart) prima di questo
   passo, il binding Hue di OpenHAB si sarà bloccato in `UNKNOWN`
   provando a connettersi a rete non ancora pronta — riavvialo per
   forzare una reinizializzazione pulita: `docker restart openhab`.
4. Accendere OPS → Pi → bridge Hue (Core deve essere il primo ad essere
   pronto: broker/Ollama/Qdrant/OpenHAB devono essere su prima che gli altri
   si connettano).
5. Verifica end-to-end (stessi controlli già usati durante il cutover
   Node-RED dell'8/8, memory `project-architettura-core-ops`):
   - `ws://192.168.1.240:1880/gaia` risponde con dati live.
   - `GET http://192.168.1.142:8765/api/status` risponde (admin Core).
   - Pi Manager / `/gaia/rooms` mostra Pi + OPS annunciati.
   - OpenHAB vede il bridge Hue online, nessun nuovo pairing richiesto.
   - Una luce reale risponde a un comando da `dashboard.html`/voce.

## Al rientro a casa

`sudo nmcli connection up netplan-enp0s31f6` su Core — torna al DHCP-client
verso il router di casa, nessun'altra modifica da disfare.

## Gotcha verificati dal vivo (dry-run 2026-08-10)

- **Windows riclassifica la rete come "Pubblica"** quando cambia il DHCP
  server/gateway (nuova rete sconosciuta per Windows) — il firewall blocca
  allora le connessioni in entrata già aperte per il profilo "Privata"
  (Node-RED `:1880`, SSH `:22`, tutto). Su OPS, dopo aver collegato la rete
  di demo: `Get-NetConnectionProfile` + `Set-NetConnectionProfile
  -NetworkCategory Private` (o da Impostazioni → Rete → Ethernet).
  Sintomo: ping funziona, tutte le porte TCP no.
- **MAC eth0 ≠ MAC wlan0 sul Pi** (differiscono di un bit sull'ultimo
  ottetto, es. `...d8` eth0 vs `...d9` wlan0) — se si riserva solo il MAC
  WiFi, il Pi collegato via cavo prende un IP dinamico diverso da quello
  atteso. `minipc/network/gaia-demo-dnsmasq.conf` riserva già entrambi i
  MAC sulla stessa riga per lo stesso IP.
- **Un riavvio di dnsmasq (`nmcli connection down/up Gaia-Demo`) non forza i
  client già connessi a rinnovare il lease** — un device con IP dinamico
  sbagliato preso PRIMA che le riservation fossero caricate resta su quell'IP
  finché non si stacca/riattacca il cavo (o scade la lease, 1h).
- **`Gaia-Demo` blocca i container Docker verso la LAN demo** (scoperto
  2026-08-10 verificando Hue/OpenHAB): `ipv4.method=shared` fa sì che
  NetworkManager installi una catena iptables dedicata
  (`nm-sh-fw-enp0s31f6`) con policy pensata per "condivisione internet" —
  accetta solo connessioni NUOVE iniziate dalla LAN demo verso l'esterno,
  rifiuta (`REJECT icmp-port-unreachable`, sintomo: "Connection refused")
  quelle iniziate da Core stesso (inclusi i container, che sul bridge Docker
  custom di questo repo sono su `br-7c03e36e5754`, **non** `docker0`) verso
  la LAN. A casa (profilo normale, non shared) questo non serve mai a
  esistere. La catena viene **ricreata da zero** ad ogni `nmcli connection
  up Gaia-Demo`, quindi la regola di eccezione va reinserita ogni volta
  (vedi comando nella checklist "all'arrivo" sopra) — non è un fix
  una-tantum.

## Limiti noti

- **Telegram bot**: nessuna connettività internet nella rete di demo *cablata*
  (per design) → se Core non ha nessun'altra via internet, il bot Telegram
  non funziona in loco. **Verificato però (dry-run 2026-08-10)**: se Core ha
  anche una connessione WiFi attiva in parallelo (es. il WiFi di casa durante
  un dry-run), Telegram funziona normalmente — gira sul Core stesso, che ha
  internet diretto via WiFi indipendentemente dalla LAN demo cablata
  (`Gaia-Demo` in modalità "shared" condivide *quella* connessione verso la
  LAN, non ne dipende). In una vera trasferta senza WiFi disponibile, il
  limite originale resta valido: serve una via internet separata (es.
  hotspot dedicato) per far funzionare Telegram — puramente di rete, non
  richiede modifiche di codice.
