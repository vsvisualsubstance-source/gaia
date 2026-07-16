# GAIA Provisioning WiFi — Livello 2 (AP mode + captive portal)

Porta un Pi senza rete configurata (prima installazione, trasloco, cambio
password del router) dentro la rete WiFi di casa, senza monitor né SSH.
Complementare a [discovery-protocol.md](discovery-protocol.md) (livelli 1 e 3):
una volta in rete, discovery e provision fanno il resto.

**Testato 2026-07-03 sul Pi di produzione** (Bookworm, NetworkManager 1.42):
AP + portale + DNS captive + ciclo submit/fallimento/ripristino, in remoto
via Tailscale con eth0 attiva.

## Componenti (`pi/provision/`)

| File | Ruolo |
|---|---|
| `provision.py` | Daemon (root): state machine + captive portal HTTP |
| `gaia-provision.service` | Unit systemd (path riscritto da install.sh) |
| `gaia-captive-dnsmasq.conf` | → `/etc/NetworkManager/dnsmasq-shared.d/gaia-captive.conf` |
| `install.sh` | Installa unit + conf dnsmasq + `/etc/gaia/provision.conf` |

## Macchina a stati

```
BOOT → online? ──sì──► IDLE (check ogni CHECK_S=30s)
        │ no per OFFLINE_GRACE_S (180s: lascia lavorare l'autoconnect NM)
        ▼
   scan WiFi (PRIMA dell'AP: in AP mode lo scan è inaffidabile)
        ▼
   AP "Gaia-Setup-XXXX" (XXXX = ultimi 4 hex del MAC, WPA2, band bg)
   portale http://10.42.0.1/ — DNS wildcard → popup captive automatico
        │ submit {ssid, psk, stanza}
        ▼
   stanza → merge in agent/device.json (se fornita)
   AP giù → nmcli device wifi connect
        ├─ ok  → IDLE (l'agent trova Gaia via discovery e si registra)
        └─ fail → profilo rimosso, AP su, portale mostra l'errore
   — inoltre: ogni AP_RETRY_S (600s) l'AP si abbassa per RETRY_WINDOW_S
     (60s) per ritentare le reti note (caso "router era spento")
```

`online` = un device ethernet/wifi attivo con IPv4 che non sia l'hotspot
(non serve internet: Gaia è in LAN). Se la rete cade mentre il Pi è in
funzione, il daemon rientra in AP mode dopo il grace period.

## Config — `/etc/gaia/provision.conf`

| Variabile | Default | Note |
|---|---|---|
| `AP_PASSWORD` | `gaiasetup` | WPA2, min 8 caratteri — da cambiare per-device in produzione seria |
| `AP_IFACE` | `wlan0` | |
| `PORTAL_PORT` | `80` | captive detection assume 80 |
| `CHECK_S` / `OFFLINE_GRACE_S` | 30 / 180 | |
| `AP_RETRY_S` / `RETRY_WINDOW_S` | 600 / 60 | retry reti note |
| `GAIA_PROVISION_FORCE_AP=1` | — | **solo test**: AP subito anche se online |

## Captive portal

- NM hotspot = connessione `shared` → NM lancia dnsmasq su 10.42.0.1 e
  legge `/etc/NetworkManager/dnsmasq-shared.d/` → `address=/#/10.42.0.1`
  fa risolvere qualsiasi nome al portale (il DNS normale del Pi non è toccato).
- Probe OS (`/generate_204`, `/hotspot-detect.html`, …): qualsiasi path ≠ `/`
  riceve `302 → http://10.42.0.1/` → il telefono apre il popup.
- `GET /status` → `{mode, last_error}` (debug/monitoraggio).
- Il form mostra le reti dallo scan pre-AP (dedup per SSID, ordinate per segnale).

## Etichetta QR consigliata (adesivo sul device)

```
WIFI:S:Gaia-Setup-75D8;T:WPA;P:gaiasetup;;
```
Il telefono inquadra → si aggancia all'AP → popup portale → 3 campi → fatto.

## Test da remoto senza perdere il Pi

Richiede il Pi connesso via **ethernet** (Tailscale su eth0):

```bash
# forza AP mode con un drop-in temporaneo
sudo mkdir -p /etc/systemd/system/gaia-provision.service.d
echo -e '[Service]\nEnvironment=GAIA_PROVISION_FORCE_AP=1' | \
  sudo tee /etc/systemd/system/gaia-provision.service.d/force-ap-test.conf
sudo systemctl daemon-reload && sudo systemctl restart gaia-provision

curl http://10.42.0.1/           # portale
curl -sI http://10.42.0.1/generate_204 | head -2   # 302 captive
# fine test:
sudo rm -r /etc/systemd/system/gaia-provision.service.d
sudo systemctl daemon-reload && sudo systemctl restart gaia-provision
```

## Limiti noti / futuro

- Lo scan reti è quello fatto prima di accendere l'AP: se una rete appare
  dopo, serve il ciclo di retry (o submit manuale — il campo è una select,
  non testo libero: eventualmente aggiungere input manuale).
- ESP32: stesso pattern con WiFiManager/Improv — il contratto qui è il
  comportamento (AP + form + retry), non il codice.
- Password AP unica di default: per produzione seria generare per-device
  e stamparla sull'etichetta QR.


## Portale sempre attivo (2026-07-10)

Il portale non è più solo il soccorso offline: gira SEMPRE (porta 80 del Pi).
- **Online**: `http://<ip-lan-pi>/` = pagina di gestione rete — scan fresco a ogni
  apertura, cambio rete al volo. Se il join fallisce, NetworkManager riaggancia il
  profilo precedente; se il Pi resta offline, dopo OFFLINE_GRACE_S scatta comunque
  l'hotspot di soccorso. I probe captive vengono redirette solo in modalità AP.
- **Reti multiple / ethernet**: le gestisce NetworkManager nativamente — ethernet
  vince sul WiFi (metrica di rotta 100 vs 600); tra più WiFi salvate decide
  `connection.autoconnect-priority` (`sudo nmcli connection modify <nome>
  connection.autoconnect-priority 10`). Il portale aggiunge profili standard,
  quindi convivono con qualsiasi configurazione manuale.

## Modalità Bosco — menu servizi standalone (2026-07-16)

Nato per l'installazione artistica nel bosco: Pi isolato, nessun Core, nessuna
rete. Il portale (già root, porta 80, sempre attivo) è diventato anche la UI
standalone del device — la stessa pagina in AP mode e online.

**Flusso nel bosco**: accensione → nessuna rete nota → dopo OFFLINE_GRACE_S
(3 min) hotspot `Gaia-Setup-XXXX` → dal telefono il captive portal si apre da
solo → sezione **Servizi** in cima alla pagina: toggle per herbarium,
mediaplayer, screen, kiosk, voice, yolo, mediapipe + slider volume + Riavvia.
La rete WiFi è in un `<details>` (aperto in AP mode, chiuso online).

In realtà per lo scenario base non serve nemmeno il telefono: l'**agent
riporta i servizi allo stato di `device.json` a ogni boot, senza rete** —
si abilita herbarium a casa, nel bosco basta dare corrente.

**Endpoint** (oltre a `/`, `/status`, `/connect`):
- `GET /services` → `{services:[{name,icon,label,active,enabled}], volume, stanza}`
- `POST /service` `{service, action:start|stop}` → systemctl + persistenza
  `enabled` in `agent/device.json` (ownership preservata: il portale è root ma
  il file resta dell'utente) → risponde con lo stato completo aggiornato
- `POST /volume` `{value:0-100}` → `wpctl` nella sessione PipeWire dell'utente
  (via `runuser` + `XDG_RUNTIME_DIR`)
- `POST /reboot` → `systemctl reboot` dopo 2s

**Coerenza col resto del sistema**:
- Camera: il portale replica il refcount dell'agent (`CAMERA_CONSUMERS` =
  yolo/mediapipe/kiosk) perché l'agent sincronizza la camera solo sui comandi
  MQTT — e nel bosco MQTT non c'è.
- kiosk/screen: `Conflicts=` reciproco nei .service — systemd ferma l'altro,
  il portale allinea solo il flag `enabled`.
- A casa (Core presente) la UI resta Pi Manager/Telegram; i due percorsi
  scrivono lo stesso `device.json`, quindi non divergono al boot successivo.

**Touchscreen nel bosco**: il kiosk può puntare al portale locale —
`KIOSK_URL=http://localhost/` in `/etc/gaia/kiosk.conf` — e il menu servizi
appare sul display DSI touch. (Non attivarlo insieme a screen: Conflicts.)
