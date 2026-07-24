# esp/ — fork ESP32 di GAIA (Casa Zero: "mattone intelligente")

Non ancora firmware reale. `sim/brick_node.py` è un prototipo software che
parla il **protocollo MQTT reale** di GAIA (stesso schema di
`pi/agent/agent.py` e `pi/yolo/mqtt_client.py`: discovery → announce →
config retained → profilo semantico retained → comandi) per definire e
validare la *logica* di un nodo "cellula" (mattone/muro/pavimento del
progetto [Casa Zero](https://github.com/vsvisualsubstance-source/casazero))
prima di scrivere C++/Arduino per un ESP32 vero.

Stesso approccio già usato in `pi/herbarium/plant_simulator.py`: si finge
l'hardware al confine del protocollo, così Node-RED/Device Registry/admin.html
non vedono differenza tra un Pi, un OPS o un mattone (reale o simulato).

## Cosa aggiunge rispetto al profilo GAIA esistente

Il profilo semantico di GAIA (`capabilities`/`services`, vedi
`docs/gaia-semantico.md`) è già concettualmente identico al "DNA Costruttivo"
di Casa Zero (descrittore per capacità, non per identità). Il simulatore
estende lo schema con i due concetti che GAIA non aveva ancora, perché
pensati per elementi edilizi passivi e non per PC/SBC:

- `interfaces`: `power` / `data` / `mesh` — quali canali fisici il nodo usa.
- `position.neighbors`: `nord`/`sud`/`est`/`ovest`/`sopra`/`sotto` — topologia
  locale, nessuna mappa centrale (principio "le cellule conoscono i vicini").

Entrambi additivi: un consumer GAIA che non li conosce li ignora, non rompe
nulla di esistente (verificato: `suggested_modules` resta correttamente
vuoto per un mattone, dato che le sue capability — vibration/edge_ai/ecc. —
non matchano `CAP_MODULES` in `pi/agent/agent.py`, pensato per hardware
Pi/OPS).

## Uso

```bash
python3 sim/brick_node.py --variant B-G --room ingresso \
    --neighbor nord=wall_0213 --neighbor sotto=floor_0100
```

Varianti disponibili (solo quelle con elettronica reale a bordo — vedi
`BRICK_VARIANTS` nel codice): `B-D` dati/sensori, `B-S` sensore, `B-G` nodo
Gaia, `B-I` ispezionabile, `B-J` giunzione, `B-C` angolo. `B0`/`B-E`/`B-W`/`B-A`
sono passaggi passivi senza cartuccia (vedi `mattone.html` di casazero) e non
generano un nodo di rete proprio — coerente col fatto che non hanno
elettronica montata.

Il device appare (retained) in `GET /gaia/devices/profiles` e in admin.html
Pi Manager come un device qualsiasi, pubblica letture sensore finte su
`gaia/brick/{device_id}/sensor` ogni `--interval` secondi. Verificato dal
vivo il 2026-07-24: registrazione, campi estesi, telemetria — tutto
confermato via MQTT reale, poi rimosso dal registry con
`POST /gaia/device/forget {"device_id": "...", "force": true}`.

## Prossimi passi (non ancora fatti)

Vedi `docs/esp32-roadmap.md` per il piano completo. In breve: quando la
logica qui è validata abbastanza (quali capability/servizi servono davvero,
quale topologia di vicinato è utile a Gaia), portarla su firmware reale
(Arduino/ESP-IDF, decisione ancora aperta) in `esp/firmware/`.
