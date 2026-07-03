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
   via REST OpenHAB (fix 2026-07-03, vedi sotto) + notifica.

## FIX APPLICATO 2026-07-03 — output

Prima del fix, l'output di `Maggiordomo` era collegato a `mqtt out "Citofono"` (topic **fisso**
`casa/citofono/trigger` — ignorava `msg.topic`, quindi ogni alert/comando di Maggiordomo veniva
pubblicato lì, indipendentemente dal contenuto) e a `function 3` (sovrascriveva il payload con
un messaggio hardcoded "🔔 CITOFONO" e un placeholder mai completato `chatId = "YOUR_CHAT_ID"`
— era il codice del webhook citofono reale, tab Inject, http-in "trigger", non pensato per
ricevere gli output di Maggiordomo). **Nessuno dei tre comportamenti arrivava a destinazione.**

Risolto dando alla function **2 output**: output 0 → nuovo nodo condiviso `Alert / Command Bus`
(`mqtt out` dinamico, stesso usato da Pet Concierge/Disability, vedi `docs/pet-disability.md`)
per gli alert Telegram; output 1 → `openhab_http_mood_01` (`→ OpenHAB REST`, lo stesso http
request già usato da `MoodSceneSync`) per il comando luci, riscritto da MQTT
(`openhab/{room}/Potenza/command`, mai funzionante — OpenHAB non ha subscriber MQTT per i
comandi) a REST usando l'item **reale** già trovato dinamicamente in `brain.lights` (la
variabile `light` prodotta da `Object.entries(brain.lights).find(...)` contiene l'id vero
dell'item OpenHAB, non serve alcuna mappa statica stanza→item):
```js
const [itemId] = light;
node.send([null, { url: `http://localhost:8080/rest/items/${itemId}`, method: 'POST',
                    headers: {'Content-Type':'text/plain'}, payload: 'OFF' }]);
node.send({ topic: 'telegram/alert', payload: `💡 Luci di ${room} (${itemId}) spente...` });
```

## RISOLTO 2026-07-03 — trigger in ingresso

`Maggiordomo` non aveva alcun wire in ingresso — agganciato ora al timer condiviso
`Ciclo Automazioni (5 min)` (ex `Inject Pet_Diability`, rinominato perché ora innesca anche
Pet Concierge/Disability/Cleanup/Plant/Away/Welcome). Aggiunto gate
`if (brain.automations?.maggiordomo !== true) return null;` in testa alla function — **non è
ancora nel sistema di toggle esposto in admin.html prima di questo fix, ora sì** (id
`maggiordomo`, default **OFF**, vedi `docs/automazioni.md`). Testato con trigger manuale via API
Node-RED: nessun errore.

**Nota ancora valida**: il branch "citofono pressed" cerca `msg.topic === 'casa/citofono/pressed'`,
ma non esiste nessun `mqtt in` su quel topic nel flow — il vero webhook citofono è un percorso
separato (`http in "trigger"` → `function 3`, tab Inject) che non passa da Maggiordomo. Quel
branch resta verosimilmente codice legacy — chiarire se va tenuto (serve un input reale) o
rimosso, non urgente.

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
