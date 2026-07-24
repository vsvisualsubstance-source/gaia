# ESP32 / Arduino — piano fork del Pi (bassa priorità, da prevedere)

Non ancora implementato — nessun codice ESP32/Arduino esiste nel repo oggi. Questo documento
fissa l'intenzione e i vincoli noti, così che quando diventa prioritario non si riparta da
zero. Il protocollo di discovery (`minipc/beacon/gaia_beacon.py`) è **già stato progettato
pensando a questo**: il suo docstring dice esplicitamente "contratto condiviso con
`pi/agent/discovery.py` e futuri client ESP32/Arduino — non cambiare senza aggiornare tutti i
client".

## Perché un fork e non un client separato da zero

I Raspberry Pi (`pi/`) coprono le stanze con bisogno di visione/voce (serve una SBC vera).
Gli ESP32 servirebbero per nodi più semplici ed economici: sensori (temperatura, umidità,
movimento, acqua/livello — vedi `casa/animali/acqua/command` in `docs/pet-disability.md`),
webcam a bassa risoluzione (ESP32-CAM), attuatori diretti. Riusare lo stesso *contratto*
MQTT/discovery del Pi invece di inventarne uno nuovo significa che Device Registry, admin.html
Pi Manager e OTA funzionano per entrambi con lo stesso codice lato Node-RED.

## Cosa serve, in ordine di dipendenza

1. **Discovery**: il beacon UDP (`GAIA_DISCOVER` → risposta JSON con `mqtt_host`/`mqtt_port`)
   funziona via `socket` standard — su ESP32 è realizzabile via `WiFiUdp` (Arduino) o `socket`
   (MicroPython), stesso formato pacchetto. Nessuna modifica al beacon lato miniPC.
2. **Identità device**: il Pi calcola `DEVICE_ID = pi-{mac[-6:]}` (vedi `pi/CLAUDE.md`) — stesso
   schema riusabile (`esp32-{mac[-6:]}` o simile) per restare compatibile col Device Registry
   Node-RED, che non deve distinguere Pi da ESP32 a livello di schema.
3. **MQTT minimo**: non serve reimplementare tutto `pi/agent/agent.py` — un ESP32 non gestisce
   servizi systemd. Serve un sottoinsieme: publish heartbeat/status (`gaia/device/{id}/status`,
   retained), subscribe comandi base (`gaia/device/{id}/command`, `gaia/device/all/command`),
   e i topic dato specifici del sensore montato.
4. **OTA**: i Pi hanno due path OTA (`gaia/ota/broadcast` con download HTTP + verifica MD5, o
   agent-mediated — vedi `pi/CLAUDE.md`). Su ESP32 il pattern realistico è OTA firmware
   completo (non file Python), via `Update.h` (Arduino-ESP32) scaricando il binario da un
   endpoint Node-RED analogo a `GET /gaia/ota/{service}/{file}`.
5. **Hotspot/captive portal di provisioning**: il Pi ha `pi/provision/` (AP "Gaia-Setup-XXXX" +
   captive portal 10.42.0.1 via nmcli/dnsmasq quando offline >180s, vedi
   `docs/provisioning-wifi.md`). Su ESP32 l'equivalente è `WiFi.softAP()` + DNS captive
   (`ESP32 WebServer` + redirect wildcard) — stesso flusso UX (nome rete + captive portal per
   configurare WiFi/stanza), libreria diversa.

## Cosa NON portare 1:1

- Niente systemd/servizi multipli: su un microcontrollore il "servizio" è il firmware stesso,
  non ha senso enable/disable via MQTT come sui Pi (a meno di più task FreeRTOS nello stesso
  firmware, gestibili con un flag invece che uno start/stop processo).
- Niente venv/Python: la struttura a cartelle di `pi/` (una per servizio, ognuna con venv) non
  si applica — il fork ESP32 sarà verosimilmente un unico progetto PlatformIO/Arduino con
  moduli interni.

## Struttura repo prevista (quando si inizia)

```
esp/                        ← nuovo, sibling di pi/ e minipc/
  firmware/                 progetto PlatformIO (o Arduino IDE) principale
    src/discovery.cpp       porting di pi/agent/discovery.py
    src/mqtt_client.cpp     heartbeat + comandi base
    src/ota.cpp             OTA firmware via Update.h
    src/provision.cpp       AP + captive portal
    src/sensors/            moduli per sensore (dht22, water_level, pir, ...)
    src/camera/             ESP32-CAM, se il nodo lo monta
  README.md                 mappa pin/sensori supportati, istruzioni flash
```

## Decisione ancora aperta

Arduino framework (C++, più familiare, più esempi per sensori economici) vs MicroPython
(prototipazione più rapida, meno performante) vs ESP-IDF nativo (più controllo, più lavoro).
Non decidere ora — rivalutare quando il primo caso d'uso reale (quale sensore, quale stanza)
è chiaro, e aggiornare questo documento con la scelta e il perché.

## Primo caso d'uso reale trovato: il "mattone intelligente" (2026-07-24)

GAIA fa parte di un progetto più ampio, **Casa Zero** (casa stampata in 3D,
repo separato `github.com/vsvisualsubstance-source/casazero` — sito
crowdfunding + laboratorio open source). Il mattone/muro/pavimento stampato
può nascere specializzato in fase di stampa con una cartuccia elettronica
estraibile (variante `B-G` = "nodo Gaia", tra le altre — vedi
`mattone.html`/`CLAUDE.md` del repo casazero): è esattamente il primo caso
d'uso reale che questo documento aspettava.

Prima di scrivere firmware vero, costruito un **prototipo software** in
`esp/sim/brick_node.py` — stesso approccio di `pi/herbarium/plant_simulator.py`
(finge l'hardware al confine del protocollo). Parla il protocollo MQTT reale
di GAIA (discovery/announce/profilo/comandi, invariato) ed è stato esteso
con due concetti nuovi introdotti dal "DNA Costruttivo" di casazero
(`dna.html`), pensati per elementi edilizi passivi e non ancora presenti nel
profilo semantico GAIA:

- `interfaces` (power/data/mesh) — quali canali fisici il nodo usa.
- `position.neighbors` (nord/sud/est/ovest/sopra/sotto) — topologia locale
  senza mappa centrale.

Entrambi additivi, verificato dal vivo che non rompono nulla (un mattone
simulato appare in `GET /gaia/devices/profiles` esattamente come un
Pi/OPS, `suggested_modules` resta correttamente vuoto perché le sue
capability non matchano `CAP_MODULES`, pensato per hardware Pi/OPS).
Dettagli d'uso: `esp/README.md`.

**Ancora aperto**: la scelta Arduino/MicroPython/ESP-IDF resta da fare — il
prototipo Python serve a capire QUALI capability/servizi/topologia servono
davvero prima di impegnarsi in un linguaggio, non a sostituire la decisione.

## Normalizzatore sensori→brain (2026-07-24)

Prima lacuna reale trovata: i dati sensore del mattone (`gaia/brick/{id}/sensor`)
arrivavano ma nessuno li leggeva — non finivano nel `brain`, quindi non
comparivano né in dashboard né erano disponibili per automazioni. Aggiunto,
stesso pattern di `PlantNorm`/`HueNorm` (tab Normalyzer): `Brick Sensor`
(mqtt-in) → `BrickNorm` (spacca un messaggio multi-campo in un
`msg.event` per categoria, temperature/humidity/vibration/air_quality) →
stesso link-out condiviso → `GAIA Brain` (nuovo branch
`e.source === "brick"`, scrive in `brain.sensors[device_id]` come qualsiasi
altro sensore fisico). Esposto anche nel payload WS (`ThreeViewEngineGAME`,
campi nuovi in `sensors[]`).

Verificato dal vivo: mattone simulato → dati visibili nel payload WS
dashboard, catena completa. **Bug trovato e sistemato nello stesso giro**:
`POST /gaia/device/forget` non ripuliva `brain.sensors[device_id]` — un
device dimenticato lasciava un sensore fantasma per sempre nella dashboard
(scoperto testando proprio questo normalizzatore). Ora pulisce anche
`brain.sensors`/`brain.plants` per lo stesso `device_id`.

**Prossimo passo esplicitamente rimandato dall'utente**: una card o pagina
dedicata in admin.html/dashboard per i mattoni (oggi si vedono solo come
righe generiche nell'array `sensors`, senza mostrare `interfaces`/
`position.neighbors`/`brick_variant`).
