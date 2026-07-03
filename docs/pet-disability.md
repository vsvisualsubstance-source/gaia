# Pet Recognition & Disability — automazioni di cura e sicurezza

Due funzioni Node-RED distinte (tab **Inject**), entrambe lette da `gaiaBrain`. **Stato
importante da verificare prima di lavorarci**: al momento della stesura di questo documento,
sia `Pet_Consierge` sia `Disability` hanno `wires: [[]]` — cioè **il loro output non è
collegato a nessun nodo a valle**. Il codice gira (agganciato all'inject di test
`Inject Pet_Diability`), calcola comandi/alert corretti, ma i `node.send(...)` che produce non
arrivano da nessuna parte (né MQTT reale né Telegram) perché l'output 0 della function non ha
wire. Verificare lo stato attuale in Node-RED prima di assumere che queste automazioni siano
"attive" in produzione — potrebbero essere state lasciate in staging dopo un test.

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

**Da fare per renderlo operativo**: ricollegare l'output della function ai nodi MQTT out reali
(o al dispatcher generico se ne esiste uno) prima di considerarlo "in produzione" — oggi è
solo logica corretta ma silenziosa.

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

- **Priorità 1** (sicurezza): ricollegare l'output di `Disability` a un dispatcher Telegram
  reale e verificare con un test end-to-end (simulare `pose: lying` per la durata soglia).
- **Priorità 2**: stesso per Pet Concierge.
- **Estensioni pensate ma non implementate**: riconoscimento specifico per animale (oggi solo
  dog/cat/bird generici da YOLO, non identità del singolo animale come per le persone);
  automazioni disability più fini (es. promemoria farmaci, rilevamento immobilità prolungata
  anche fuori da bagno/cucina).
