# Automazioni — comportamenti automatici senza intervento esplicito

Ombrello per tutte le automazioni che agiscono da sole su luci/alert in base allo stato di
`gaiaBrain` (presenza, mood, sensori, visione). Dettaglio codice per singola automazione nei
doc gemelli: `docs/maggiordomo.md`, `docs/pet-disability.md`. Questo documento è l'indice +
l'audit di cosa esiste davvero.

## Sistema di toggle ufficiale (Node-RED `AutomationsList`/`ToggleAutomation`, tab Device Registry)

`GET /gaia/automations` + `POST /gaia/automations/toggle` — **è il pannello "Automazioni" reale
in admin.html**, verificato funzionante end-to-end. Espone 11 automazioni:

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
| `voiceAutoEnroll` | globale | **OFF** (attivato e verificato dal vivo 2026-07-04) | Doppia conferma vocale + auto-enrollment — vedi sezione dedicata sotto |

## Doppia conferma vocale + auto-enrollment (2026-07-04)

**Cosa fa**: quando un comando vocale minipc viene identificato con uno speaker noto
(`SpeakerDB.identify()` in `gaia_listener.py`) e quella stessa persona risulta **presente per
riconoscimento facciale** (`brain.presence`), è una doppia conferma volto+voce — la function
`Intent Detection` (Node-RED, tab GAIA Voice — **non** "Voce → Chat" nel tab Chat, vedi bug
sotto) pubblica `gaia/admin/voice_autoenroll {name}`, e `gaia_listener.py` rifinisce il profilo
vocale esistente con una **media mobile pesata** (`SpeakerDB.blend_or_enroll`, alpha 0.15) usando
l'embedding già calcolato durante l'identificazione — nessuna nuova registrazione, nessun
sovrascrittura brutale come fa `enroll()` (usato solo dal wizard esplicito).

**Guardia anti-race**: `gaia_listener.py` applica il blend solo se il nome richiesto combacia
con `speaker_db.last_identified_name` (l'ultima identificazione fatta), per evitare che un
auto-enroll in ritardo si applichi all'utterance sbagliata.

**Limite noto**: solo i comandi vocali dal **minipc** hanno speaker ID — i Pi non ne hanno
ancora (vedi `voice_roadmap.md` in `pi/.claude/memory/`, TODO storico). Sui Pi il campo
`speaker` non esiste nel payload, quindi il cross-check è semplicemente no-op per loro (nessun
errore, solo nessuna doppia conferma).

**Bug trovato e corretto durante l'implementazione**: la function "Voce → Chat" (tab Chat)
sembrava il posto giusto per questa logica (legge già `speaker`/`confidence`) ma è **collegata
a un `mqtt in` sul topic `casa/voce/comando`, che nessuno pubblica più** — `gaia_listener.py`
pubblica su `gaia/voice/command/minipc`. "Voce → Chat" è codice morto nell'architettura
attuale. Il percorso vivo è `voice-mqtt-in` (`gaia/voice/command/+`) → **Intent Detection**
(tab GAIA Voice) → dove la logica è stata effettivamente aggiunta.

**Verificato dal vivo 2026-07-04**: utente riconosciuto dalla camera → ha detto "Gaia, ciao" →
speaker identificato come "Mauro" → log `[Voce] Doppia conferma volto+voce per Mauro ->
auto-enroll` (Node-RED) → log `Auto-enroll vocale (doppia conferma): Mauro -> OK`
(gaia_listener.py).

## Suggerimento stanza da oggetti YOLO (2026-07-04)

Nuovo endpoint `GET /gaia/room-guess?room=<chiave_attuale>` (Node-RED, tab Device Registry) —
riusa le stesse firme oggetto di `DeviceRegistry.yoloVerify()` (`ROOM_SIGNATURES`) ma per
**indovinare** la stanza più probabile dagli oggetti visti da una telecamera invece di
verificare una singola claim. Non assegna nulla da solo — restituisce candidati ordinati per
punteggio, un umano conferma con l'assegnazione esistente (`/api/provision/assign`). Pulsante
🔍 aggiunto in admin.html → "Device registrati", accanto al campo stanza esistente.

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

**Aggiornamento 2026-07-04**: "ingresso1" è ricomparso circa 10 ore dopo (Node-RED mai
riavviato nel frattempo) — stavolta con attività MediaPipe reale, non un ghost inerte. Il fix
manuale della sera prima (publish diretto sul topic retained `gaia/devices/pi-fd75d8/config`)
aveva corretto il broker ma non `brain.devices` in memoria nel processo Node-RED già in
esecuzione — il Device Registry continua a fidarsi del suo stato interno
(`existing.room || roomClaim`), quindi ha continuato a riconfermare "ingresso1" per tutta la
vita di quel processo. **Il modo corretto è sempre `POST /api/provision/assign`**
(`{device_id, stanza}`) su `gaia_admin.py:8765` — fa la sincronizzazione a tre vie completa
(provision registry + `set_config` MQTT al device + Device Registry Node-RED), non un publish
manuale sul topic. Verificato: MediaPipe ha ripreso a taggare `"camera":"ingresso"` entro
pochi secondi dalla chiamata.

## Roadmap — idee non ancora implementate

- Collegare Automazioni a Gaming/RPG (sbloccare automazioni più sofisticate salendo di livello,
  vedi `docs/web-sections.md`/`docs/maggiordomo.md`).
- Suddividere `maggiordomo` in toggle più fini (citofono/pioggia/luci separati) se si vuole
  disabilitarne solo una parte.
- Filtro/allow-list per `touchdesignerLighting` (oggi accetta qualunque item OpenHAB per
  nome — nessun controllo che l'item esista davvero prima della chiamata REST).
