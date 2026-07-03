# Automazioni — comportamenti automatici senza intervento esplicito

Ombrello per tutte le automazioni che agiscono da sole su luci/alert in base allo stato di
`gaiaBrain` (presenza, mood, sensori, visione). Dettaglio codice per singola automazione nei
doc gemelli: `docs/maggiordomo.md`, `docs/pet-disability.md`. Questo documento è l'indice +
l'audit di cosa esiste davvero.

## Sistema di toggle ufficiale (Node-RED `AutomationsList`/`ToggleAutomation`, tab Device Registry)

`GET /gaia/automations` + `POST /gaia/automations/toggle` — **è il pannello "Automazioni" reale
in admin.html**, verificato funzionante end-to-end. Espone 10 automazioni:

| id | Scope | Default | Cosa fa |
|---|---|---|---|
| `petConcierge` | globale | ON | Vedi `docs/pet-disability.md` — Pet Concierge |
| `fallDetection` | globale | ON | Vedi `docs/pet-disability.md` — Disability, rilevamento cadute |
| `fireAlarm` | globale | ON | Vedi `docs/pet-disability.md` — Disability, incendio |
| `fridgeAlarm` | globale | ON | Vedi `docs/pet-disability.md` — Disability, frigo aperto |
| `moodLighting` | **per-stanza** | **OFF per ogni stanza** (opt-in esplicito) | `MoodSceneSync`: scena luci da mood, solo se `brain.automations.moodLighting[room] === true` |
| `maggiordomo` | globale | **OFF** | Citofono, pioggia+finestre, spegnimento luci stanza vuota (vedi `docs/maggiordomo.md`) |
| `thirstyPlantAlert` | globale | **OFF** | Alert Telegram se `brain.plants[].moisture < 25`, cooldown 6h per pianta |
| `awayMode` | globale | **OFF** | Nessuno in casa da >30 min → spegne `Tutte_le_luci` via REST + alert, si riarma quando qualcuno rientra |
| `welcomeScene` | globale | **OFF** | Persona nota rientra la sera (dopo le 20 o prima delle 6) → accende luce ingresso, cooldown 2h/persona |
| `touchdesignerLighting` | globale | **OFF** | Vedi sotto — luci pilotate da parametri generati in TouchDesigner |

Le prime 4 sono di sicurezza/cura e restano **ON di default** (comportamento preesistente).
Tutte le nuove (2026-07-03) partono **OFF** per scelta deliberata — coerenti con la convenzione
già stabilita da `moodLighting` (opt-in esplicito) — vanno abilitate da admin.html quando si è
pronti a verificarne l'effetto reale in casa.

## Implementate 2026-07-03 (tab Inject, timer condiviso "Ciclo Automazioni" ogni 5 min)

- **Maggiordomo**: aveva già la logica corretta ma **zero trigger in ingresso** (nessun nodo lo
  invocava mai) — ora agganciato al timer condiviso. Aggiunto gate `brain.automations.maggiordomo`.
- **Cleanup Stanze Stale**: nuova, non gated da toggle (pura igiene dati, nessun effetto fisico) —
  rimuove da `brain.rooms` le stanze con `persons_count === 0` e ferme da >4 ore. Prima non
  esisteva alcun meccanismo che ripulisse `brain.rooms`: è la causa root per cui residui come
  "ingresso1" potevano restare per sempre.
- **Plant Thirst Alert**, **Away Mode**, **Welcome Scene**, **TouchDesigner Lighting Bridge**:
  vedi tabella sopra. Away Mode e Welcome Scene inviano comandi REST via lo stesso nodo
  `openhab_http_mood_01` già usato da `MoodSceneSync` (nessun nodo HTTP duplicato).

**TouchDesigner Lighting Bridge**: sottoscrive `gaia/touchdesigner/lighting/#` (mqtt in nuovo,
tab Inject). Convenzione topic: `gaia/touchdesigner/lighting/<ItemOpenHAB>/<campo>` con
`campo ∈ {Potenza, Luminosita, Colore, Color_Temperature}` — payload = valore da scrivere via
REST. Nessuna mappa stanza→item: chi configura TouchDesigner deve puntare all'item OpenHAB
reale (vedi memory `project-openhab-hue-items`). Throttle 200ms per item+campo. **Testato
end-to-end**: pubblicato `gaia/touchdesigner/lighting/luce_Ingresso/Luminosita = 35` → verificato
che l'item OpenHAB reale è cambiato.

## Bug risolto 2026-07-03 — refuso "ingresso1" (causa root completa)

Tre problemi concatenati, non uno solo:

1. **Codice**: `minipc/script/gaia_admin.py`, endpoint `/api/gaia-wakeword/record` — default
   hardcoded `body.get("stanza", "ingresso1")`. Corretto in `"ingresso"`. Richiedeva
   `sudo systemctl restart gaia-admin` per applicarsi.
2. **Retained MQTT stuck**: un messaggio **retained** su `gaia/voice/status/ingresso1` (stato
   voce, scritto durante l'incidente storico di divergenza Device Registry) restava sul broker
   e veniva **riconsegnato ad ogni riconnessione/riavvio di Node-RED**, ricreando la stanza
   fantasma in `brain.rooms` ogni volta — anche dopo aver pulito `brain.json` a mano, perché il
   messaggio arrivava di nuovo dal broker prima ancora che qualcuno se ne accorgesse. Risolto
   pubblicando un payload vuoto con `retain=True` sullo stesso topic (cancella il retained).
   **Se "ingresso1" (o nomi simili) ricompare in futuro**: sospettare sempre un retained
   bloccato su un topic `gaia/.../ingresso1` prima di cercare altrove — verificare con
   `mosquitto_sub`/client Python sottoscrivendo `gaia/#` e controllando il flag `retain`.
3. **Nessuna persistenza di `brain.devices`**: `Parse Brain` non restaurava mai
   `brain.devices` (assegnazioni Pi↔stanza) tra un riavvio e l'altro, e la funzione di salvataggio
   (`function 1`, alimenta "Save Brain") non lo includeva nemmeno nel file. Ogni riavvio quindi
   ripartiva con `brain.devices = {}`, aprendo una finestra in cui un `room_claim` transitorio
   sbagliato dal Pi (es. durante una riscrittura del suo `device.json`) veniva accettato senza
   che nessuna assegnazione precedente lo correggesse. **Corretto**: `brain.devices` ora viene
   salvato e ripristinato come tutto il resto dello stato persistente.
4. **Bonus**: la funzione di salvataggio filtrava le stanze da persistere con
   `rid.includes(known_name)` (substring) invece di uguaglianza esatta — quindi "ingresso1"
   passava il filtro pensato per scartare nomi spuri. Cambiato in match esatto.

## Roadmap — idee non ancora implementate

- Collegare Automazioni a Gaming/RPG (sbloccare automazioni più sofisticate salendo di livello,
  vedi `docs/web-sections.md`/`docs/maggiordomo.md`).
- Suddividere `maggiordomo` in toggle più fini (citofono/pioggia/luci separati) se si vuole
  disabilitarne solo una parte.
- Filtro/allow-list per `touchdesignerLighting` (oggi accetta qualunque item OpenHAB per
  nome — nessun controllo che l'item esista davvero prima della chiamata REST).
