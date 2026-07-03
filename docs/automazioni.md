# Automazioni — comportamenti automatici senza intervento esplicito

Ombrello per tutte le automazioni che agiscono da sole su luci/alert in base allo stato di
`gaiaBrain` (presenza, mood, sensori, visione). Dettaglio codice per singola automazione nei
doc gemelli: `docs/maggiordomo.md`, `docs/pet-disability.md`. Questo documento è l'indice +
l'audit di cosa esiste davvero e cosa manca.

## Sistema di toggle ufficiale (Node-RED `AutomationsList`/`ToggleAutomation`, tab Device Registry)

`GET /gaia/automations` + `POST /gaia/automations/toggle` — **è il pannello "Automazioni" reale
in admin.html**, verificato funzionante end-to-end (2026-07-03). Espone esattamente 5
automazioni:

| id | Scope | Default | Cosa fa |
|---|---|---|---|
| `petConcierge` | globale | ON | Vedi `docs/pet-disability.md` — Pet Concierge |
| `fallDetection` | globale | ON | Vedi `docs/pet-disability.md` — Disability, rilevamento cadute |
| `fireAlarm` | globale | ON | Vedi `docs/pet-disability.md` — Disability, incendio |
| `fridgeAlarm` | globale | ON | Vedi `docs/pet-disability.md` — Disability, frigo aperto |
| `moodLighting` | **per-stanza** | **OFF per ogni stanza** (opt-in esplicito) | `MoodSceneSync`: traduce `brain.mood.state` in scena luci (brightness+color temp) per le stanze con presenza, solo se quella stanza ha il flag `true` in `brain.automations.moodLighting[room]` |

`brain.automations.moodLighting` parte come oggetto vuoto `{}` — nessuna stanza è illuminata
automaticamente dal mood finché non la abiliti esplicitamente da admin.html. Confermato nel
codice (`ToggleAutomation`/`Parse Brain`) e nel comportamento (`MoodSceneSync` controlla
`moodLightingFlags[r] === true`, commento nel codice: *"opt-in per stanza: di default NON si
accende nulla"*).

**Gap trovato**: `Maggiordomo` (citofono, pioggia+finestre, spegnimento luci stanza vuota) **non
è in questa lista** — non ha un toggle in admin.html, non è gated da nessun flag
`brain.automations`, e (vedi `docs/maggiordomo.md`) non ha nemmeno un trigger in ingresso nel
flow, quindi oggi non gira affatto. Se/quando lo si riattiva, andrebbe aggiunto qui come
automazioni globali separate (es. `citofonoAlert`, `rainWindowsAlert`, `autoLightsOff`) così
l'utente può disabilitarle singolarmente come le altre.

## Bug corretto 2026-07-03 — refuso "ingresso1"

Due problemi distinti, entrambi dal nome sbagliato "ingresso1" (invece di "ingresso"):

1. **Codice**: `minipc/script/gaia_admin.py`, endpoint `/api/gaia-wakeword/record` — default
   hardcoded `body.get("stanza", "ingresso1")`. Corretto in `"ingresso"`. Richiede
   `sudo systemctl restart gaia-admin` per applicarsi (il processo systemd ha il vecchio codice
   in memoria).
2. **Dato live**: `brain.rooms` aveva una stanza fantasma `ingresso1`, ferma da ~6 ore mentre
   `ingresso`/`salotto` erano aggiornate ogni ~30 min — residuo del vecchio incidente di
   divergenza Device Registry (vedi memory `project-gaia`, caso storico già citato). Qualcuno
   aveva anche acceso `moodLighting` per questa stanza fantasma, quindi compariva nel pannello
   Automazioni di admin.html. Rimossa da `/home/core/gaia/brain.json` (backup in
   `backups/brain_pre_ingresso1_cleanup_*.json`) — **il processo Node-RED live la mantiene in
   memoria finché non viene riavviato** (nessun meccanismo in `GAIA Brain` rimuove stanze mai
   più aggiornate); innocua nel frattempo (non compare nella dashboard, che filtra le stanze
   con >2min senza attività, ma resta visibile nella lista grezza `/gaia/automations`).

## Roadmap — proposte di sviluppo

1. **Pulizia automatica stanze stale**: `GAIA Brain` non ha mai rimosso una entry da
   `brain.rooms` una volta creata (causa root del punto precedente) — aggiungere una pulizia
   periodica (es. rimuovi stanze con `lastUpdate` più vecchio di N ore e `persons_count === 0`)
   eviterebbe che futuri bug di naming lascino residui permanenti.
2. **Riattivare Maggiordomo**: dargli un trigger reale (timer periodico, vedi
   `docs/maggiordomo.md`) e aggiungerlo al sistema di toggle ufficiale.
3. **Automazione "pianta assetata"**: `brain.plants[].moisture` è già tracciato (usato per lo
   stato `critical/warning/good` nel payload dashboard) ma **nessuna automazione reagisce** a
   un'umidità critica — un alert Telegram quando `moisture < 25` per una pianta sarebbe
   coerente con lo stile di Disability/Pet Concierge e usa dati già disponibili.
4. **Modalità "fuori casa"**: oggi Maggiordomo spegne luci per stanza singola dopo 10 minuti
   vuota; un'automazione "nessuno in casa da X minuti" (usando `brain.presence`, già
   disponibile) potrebbe spegnere tutto/attivare una scena "away" invece di agire stanza per
   stanza.
5. **Scena "bentornato"**: quando una persona nota rientra la sera (evento `presence` enter +
   `hourlyStats.isNight`), accendere una luce nella stanza d'ingresso — usa dati già presenti
   in `brain.presence`/`hourlyStats`, nessuna nuova sorgente dati richiesta.
6. **Collegare Automazioni a Gaming/RPG**: idea già in `docs/web-sections.md`/
   `docs/maggiordomo.md` — sbloccare automazioni più sofisticate salendo di livello.
7. **Automazioni pilotate da TouchDesigner**: il bridge OSC (`docs/` /
   `minipc/touchdesigner/README.md`) già relaya parametri TD→MQTT — una vera automazione
   potrebbe leggerli (es. palette generata da TD → scena luci reale via lo stesso meccanismo di
   `MoodSceneSync`), chiudendo il cerchio dati↔generativo↔casa fisica.
