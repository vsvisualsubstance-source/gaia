# Evoluzione Maggiordomo — automazioni domestiche proattive

Il "maggiordomo" è la funzione Node-RED `Maggiordomo` (tab **Inject**, nonostante il nome del
tab — è codice di produzione, non solo test). Gestisce automazioni reattive semplici basate su
`gaiaBrain`, distinte da Pensieri Profondi (che genera linguaggio/pensieri) e da Disability
(che genera allarmi di sicurezza — vedi `docs/pet-disability.md`).

## Cosa fa oggi (`Maggiordomo`, function node)

1. **Citofono**: `msg.topic === 'casa/citofono/pressed'` → notifica Telegram con chi è in casa
   (`brain.presence`).
2. **Pioggia + finestre aperte**: se `brain.sensors.rain.state === 'raining'` e
   `brain.sensors.windows.open === true` → alert Telegram, throttle 5 minuti
   (`lastButlerAction.windows_alert`).
3. **Spegnimento automatico luci**: per salotto/cucina/studio, se la stanza è vuota
   (`persons_count === 0`) da più di 10 minuti e una luce di quella stanza è accesa → spegne
   via `openhab/{room}/Potenza/command` + notifica.

**Wiring:** output collegato a `mqtt out "Citofono"` e a `function 3` (non ancora
documentato — verificare cosa fa prima di modificare questa parte). I comandi verso OpenHAB
(`openhab/{room}/Potenza/command`) escono come `node.send` con topic dinamico: verificare che
il nodo MQTT out a valle non abbia un topic fisso che li ignora (stesso problema visto per
Pet Concierge/Disability, vedi `docs/pet-disability.md`).

## Componenti correlati (letti da Maggiordomo, ma calcolati altrove)

- **MoodSceneSync** (Gaia Engine): traduce mood/scene verso comandi OpenHAB REST
  (`kelvinToPct`, mappa stanza→prefisso item Hue). Non chiamato direttamente da Maggiordomo
  oggi, ma stessa famiglia di automazione (luci reattive allo stato della casa).
- **MovementEngine** (Gaia Engine): non è un motore fisico — traccia le transizioni di presenza
  tra stanze adiacenti (`ROOM_ADJACENCY`: ingresso↔corridoio↔corridoio2↔salotto,
  `TRANSITION_WINDOW_MS=12000`) per dedurre movimento/direzione senza sensori di posizione
  assoluta. Utile per automazioni predittive (es. "sta arrivando in salotto" prima che il
  sensore lo confermi).

## Roadmap — cosa serve per farlo evolvere in autonomia

1. **Consolidare cooldown/stato**: oggi ogni automazione ha il suo pattern ad-hoc per evitare
   spam (`lastButlerAction`, `lastAlert` in Disability, `lastAction.windows_alert`...) — se il
   numero di automazioni cresce, vale la pena un helper condiviso invece di reinventarlo ogni
   volta (senza however introdurlo preventivamente: farlo quando la terza/quarta automazione
   nuova lo richiede davvero).
2. **Collegare a MovementEngine**: azioni anticipatorie (es. accendere luce salotto quando
   `MovementEngine` prevede l'arrivo, non quando la persona è già lì).
3. **Collegare a Gaming/RPG**: idea dell'utente — l'evoluzione del "maggiordomo" potrebbe
   sbloccare comportamenti più avanzati con l'aumentare di `brain.gamification.level`
   (vedi `docs/web-sections.md` → sezione Gaming).
4. **Esporre in admin.html**: `brain.automations` ha già flag per abilitare/disabilitare
   singole automazioni (`fallDetection`, `fridgeAlarm`, `fireAlarm`, `petConcierge` — letti da
   Disability/Pet Concierge) — verificare se esiste già un toggle in admin.html per
   `Maggiordomo` stesso o se va aggiunto.

Prima di aggiungere una nuova automazione qui: leggere `brain.rooms`/`brain.sensors`/
`brain.lights` così come popolati da `GAIA Brain` (`docs/pensieri-profondi.md`) — Maggiordomo
non ha una sua vista dei dati, consuma lo stesso `gaiaBrain` globale di tutto il resto.
