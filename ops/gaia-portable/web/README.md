# Pagine web di Gaia servite da OPS (Node-RED "portable")

Copia della cartella `C:\gaia-docker-cfg\gaia-portable-web` che il
container `gaia-portable-nodered` monta come `/media/core/D/gaia-web`
(vedi `../docker-compose.yml`) e serve sulla porta **1881**
(es. `http://<OPS>:1881/admin.html`).

Sono le pagine di `web/` adattate a OPS: Node-RED su 1881, broker MQTT
WebSocket su 19001, IP LAN di OPS 192.168.1.240 e Tailscale 100.91.251.83
al posto di quelli di Core.

- 2026-10-27: admin, dmx, mixeraudio e patchdeck cercano il broker prima
  sull'host da cui la pagina e' servita (`BROKER_HOSTS`), poi LAN e
  Tailscale: aperte da OPS stesso o dal Wi-Fi di casa non si collegavano.
- `qr/` non e' nel repo (puo' contenere dati della rete).

Per aggiornare OPS: copiare i file modificati in
`C:\gaia-docker-cfg\gaia-portable-web` (Node-RED li serve subito, senza
riavvio).
