# Pet Recognition & Disability — automazioni di cura e sicurezza

Due funzioni Node-RED distinte (tab **Inject**), entrambe lette da `gaiaBrain`, entrambe
innescate ogni 5 minuti dall'inject periodico `Inject Pet_Diability` (`repeat: 300`, non solo un
trigger di test come il nome suggerirebbe).

**FIX APPLICATO 2026-07-03**: al momento della prima ricognizione, sia `Pet_Consierge` sia
`Disability` avevano `wires: [[]]` — l'output non arrivava a nulla (calcolavano comandi/alert
corretti, ma `node.send(...)` andava nel vuoto). Risolto collegando entrambe a un nuovo nodo
condiviso **`Alert / Command Bus`** (`mqtt out` con topic dinamico, id
`gaia_alert_cmd_bus_01`, tab Inject) che pubblica sul broker usando `msg.topic` così com'è — è
lui il collegamento reale con il subscriber Telegram (`mqtt in` su topic `telegram/alert`, nome
"Alert MQTT", tab Chat). Verificato con un trigger manuale via API Node-RED
(`POST /inject/{id}`): nessun errore in log, nessun messaggio perché le condizioni (animale
presente, caduta, incendio) non erano vere in quel momento — comportamento atteso, non un
fallimento del wiring.

---

## Pet Concierge (`Pet_Consierge`)

Rileva presenza animale (`brain.rooms[room].objects.dog|cat|bird`, da YOLO) e reagisce:

1. **Luce soffusa**: se un sensore ha `darkness: true` → `openhab/{room}/Luminosita/command` a
   `20`.
2. **Acqua**: se `brain.sensors.water_bowl.level < 20` → `casa/animali/acqua/command` =
   `EROGARE` (attuatore non ancora mappato altrove nel repo — verificare se esiste un
   sottoscrittore reale per questo topic prima di fare affidamento sull'automazione).
3. **Rumore esterno**: se `brain.sensors.external_noise.level > 70` → playlist calmante
   (`media_player/salotto/playlist` = `calming_music`).

Disattivabile via `brain.automations.petConcierge === false`.

**Nota non ancora risolta**: il comando luce soffusa (punto 1) pubblica
`openhab/{room}/Luminosita/command` via MQTT — ma OpenHAB non ha un subscriber MQTT per i
comandi (solo REST API, vedi memory `project-openhab-hue-items`), quindi questo comando
specifico resta inerte anche dopo il fix del wiring (arriva al broker ma nessuno lo ascolta).
A differenza del caso analogo in Maggiordomo (spegnimento luci, risolto usando l'item reale
trovato in `brain.lights`), qui il codice non fa un lookup dinamico dell'item — costruisce il
nome a partire dal nome stanza, che non corrisponde necessariamente al prefisso item OpenHAB
reale (vedi mappa in `project-openhab-hue-items`). Da sistemare quando si conoscono i nomi
item reali delle luci nelle stanze con animali.

---

## Disability (sicurezza / assistenza)

Tre automazioni indipendenti, ciascuna con cooldown 1 minuto per tipo di alert
(`lastDisabilityAlert`, per-`type`):

1. **Rilevamento cadute**: persona con `pose === 'lying'` da >60s in cucina, o >30s in
   bagno/scale (soglia più bassa perché più a rischio) → alert Telegram
   `POSSIBILE CADUTA`. Disattivabile via `brain.automations.fallDetection`.
2. **Frigorifero aperto**: `brain.sensors.fridge.state === 'open'` da >120s → alert.
   Disattivabile via `brain.automations.fridgeAlarm`.
3. **Fuoco/fumo**: `brain.rooms[room].objects.fire === true` (da YOLO) → alert
   `ALLARME INCENDIO`. Disattivabile via `brain.automations.fireAlarm`.

**Da fare per renderlo operativo**: stesso problema di Pet Concierge — output non wired.
Questo è particolarmente critico qui perché si tratta di allarmi di sicurezza (caduta,
incendio): **prima di dichiarare questa funzione "in produzione" verificare il collegamento
reale in Node-RED**, non fidarsi del fatto che il codice esista.

## Roadmap

- **Fatto (2026-07-03)**: wiring Pet Concierge + Disability → Telegram reale.
- **Ancora da fare**: comando luce soffusa Pet Concierge via REST (item reale, non dedotto dal
  nome stanza); test end-to-end con una condizione vera (es. simulare `pose: lying` per la
  durata soglia) — il trigger manuale fatto finora ha solo verificato l'assenza di errori, non
  la consegna reale di un alert.
- **Estensioni pensate ma non implementate**: riconoscimento specifico per animale (oggi solo
  dog/cat/bird generici da YOLO, non identità del singolo animale come per le persone);
  automazioni disability più fini (es. promemoria farmaci, rilevamento immobilità prolungata
  anche fuori da bagno/cucina).
