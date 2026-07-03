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
