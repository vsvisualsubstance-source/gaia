# GAIA Discovery Protocol — v1

Contratto condiviso tra Gaia Core (miniPC) e tutti i client (Raspberry Pi,
in futuro ESP32/Arduino). **Non modificare senza incrementare `proto` e
mantenere la compatibilità all'indietro.**

## Componenti

| Ruolo | Implementazione | Dove |
|---|---|---|
| Server (beacon) | `minipc/beacon/gaia_beacon.py` | miniPC, UDP 8899 |
| Annuncio mDNS | `minipc/beacon/avahi-gaia.service` | `/etc/avahi/services/gaia.service` |
| Client | `pi/agent/discovery.py` | chiamato da `agent.py` prima della connect MQTT |

## Protocollo beacon (UDP)

**Richiesta** — datagramma UDP verso porta `8899` (broadcast `255.255.255.255`
o unicast), payload che inizia con:

```
GAIA_DISCOVER
```

Byte successivi al magic sono riservati a estensioni future (v1 li ignora).

**Risposta** — singolo datagramma JSON al mittente:

```json
{
  "service":    "gaia-core",
  "proto":      1,
  "mqtt_host":  "192.168.1.142",
  "mqtt_port":  1883,
  "admin_port": 8765,
  "version":    "1.0.2",
  "hostname":   "core-node-0"
}
```

Regole per i client:
- validare `service == "gaia-core"` prima di usare la risposta (ignora
  eventuali altri responder sulla porta);
- `mqtt_host` è l'IP del miniPC **visto dal richiedente** (il beacon lo
  calcola per-richiesta, corretto anche su host multi-interfaccia);
- campi sconosciuti vanno ignorati (forward-compat);
- `proto` > 1 con `service` corretto: usare i campi v1, ignorare il resto.

## Cascata di discovery (lato client)

Ordine implementato in `pi/agent/discovery.py::discover()` — da replicare
sui futuri client ESP32:

1. **Cache** — ultimo `mqtt_host` trovato (`pi/agent/gaia_core.json`,
   gitignored), poi l'host di config/env. Probe unicast al beacon (1.5s);
   se il beacon non risponde, fallback probe TCP sulla porta 1883
   (compatibilità con un Gaia Core senza beacon installato).
2. **Broadcast UDP** — 3 tentativi, timeout 2s ciascuno.
3. **mDNS** — risolve i nomi in `GAIA_MDNS_NAMES` (default
   `gaia.local,core-node-0.local`) e conferma con probe beacon/TCP.
4. Nessun risultato → il chiamante ritenta con backoff (agent: 5s→60s).

Ogni successo aggiorna la cache.

## Override e disattivazione

| Variabile | Effetto |
|---|---|
| `MQTT_HOST` (env, lato Pi) | Salta completamente la discovery: l'host esplicito vince (layering config: env > conf > default) |
| `GAIA_DISCOVERY=0` | Disattiva la discovery nell'agent |
| `GAIA_BEACON_PORT` | Porta beacon lato client (default 8899) |
| `GAIA_MDNS_NAMES` | Lista nomi mDNS, separati da virgola |
| `BEACON_PORT` / `MQTT_PORT` / `ADMIN_PORT` / `GAIA_VERSION` (lato beacon) | Config del responder |

## mDNS (complementare)

Il miniPC annuncia `_gaia._tcp` porta 1883 con TXT record
`proto`, `admin_port`, `beacon_port`, `version`. Utile per browser e
tooling (`avahi-browse -rt _gaia._tcp`); la cascata client lo usa come
terzo tentativo risolvendo i nomi host, senza dipendenze da librerie
zeroconf.

## Note per ESP32/Arduino (futuro)

- Richiesta: `WiFiUDP.beginPacket(IPAddress(255,255,255,255), 8899)` +
  `write("GAIA_DISCOVER")` — nessuna libreria extra.
- Parsing risposta: ArduinoJson, validare `service`.
- Stessa cascata: NVS/EEPROM come cache dell'ultimo host.
- mDNS opzionale via ESPmDNS (`MDNS.queryService("gaia", "tcp")`).

## Livello 3 — Bootstrap: registrazione device (`/api/provision`)

Dopo la discovery, l'agent si registra presso gaia_admin
(`http://{mqtt_host}:{admin_port}/api/provision`, porta dal beacon,
default 8765). Implementazione: `pi/agent/agent.py::_provision_register`
(client, best effort — ogni errore lascia la config locale invariata) e
`minipc/script/gaia_admin.py` (server, registry in
`provision_registry.json`, gitignored).

**Richiesta** `POST /api/provision`:

```json
{
  "device_id":    "pi-fd75d8",
  "mac":          "dc:a6:32:fd:75:d8",
  "hw":           "Raspberry Pi 4 Model B Rev 1.4",
  "sw_version":   "1.0.2",
  "stanza":       "ingresso",
  "capabilities": {"camera": true, "mic": true}
}
```

`stanza` è il *claim* locale del device (da `device.json`), non
autoritativo finché l'admin non lo conferma.

**Risposta**:

```json
{
  "ok":             true,
  "assigned":       true,
  "stanza":         "ingresso",
  "name":           null,
  "mqtt_host":      "192.168.1.142",
  "mqtt_port":      1883,
  "server_version": "1.0.2"
}
```

Regole client:
- `assigned: true` → la `stanza` della risposta è autoritativa: se
  diversa da quella locale, il device la adotta e la persiste **prima**
  di avviare i servizi;
- `assigned: false` → il device mantiene la config locale e compare in
  admin.html (tab Pi → "Device registrati") come "da assegnare".

**Endpoint di gestione** (usati da admin.html):
- `GET  /api/provision/devices` — registry completo;
- `POST /api/provision/assign` `{device_id, stanza, name?}` — rende la
  stanza autoritativa e la applica subito via MQTT
  (`gaia/device/{id}/command` con `set_config`) se il device è online;
- `POST /api/provision/forget` `{device_id}` — rimuove dal registry.

## Roadmap (fuori da questo contratto)

- **Livello 2 — provisioning WiFi**: AP mode + captive portal
  (`gaia-provision.service`), da definire in un documento separato.
- **OTA bundle**: aggiornamento a tarball dell'intero `pi/` guidato dal
  confronto `sw_version`/`server_version` del provision (oggi l'OTA è
  per-file); lo schema andrà versionato qui accanto.
