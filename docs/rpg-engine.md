# RPG Engine — progressione da eventi reali della casa

Implementato 2026-07-04 (prima era solo un dato statico mai aggiornato). Vive nel function
`GAIA Brain` (Node-RED, tab Gaia Engine), sezione `RPG ENGINE`, e trasforma
`brain.gamification` in una progressione vera: la vita della casa genera XP, gli XP
diventano livelli, i livelli sbloccano asset per la scena 3D e definiscono l'archetipo
di Gaia.

## Regole XP (con cooldown per tipo — gli eventi vision arrivano a raffica)

| Trigger | XP | Archetipo | Cooldown |
|---|---|---|---|
| Comando vocale (nuova voce in `brain.voiceCommands`) | 25 | Mago | 15s |
| Pensiero generato (nuovo in `brain.thoughts`) | 20 | Mago | 2min |
| Ingresso persona nota (`presence enter`, no unknown) | 40 | Bardo | 1min |
| Gesture rilevata | 15 | Guerriero | 1min |
| Movimento | 5 | Guerriero | 5min |
| Evento piante (`source: plant`) | 10 | Druido | 5min |
| Riassunto notturno (nuovo in `brain.memories`) | 150 | Druido | 1h |

Comandi vocali/pensieri/riassunti **non attraversano GAIA Brain come eventi**: vengono
rilevati per polling osservando le strutture che altri nodi aggiornano (con baseline al
primo giro post-deploy per non premiare il passato — campi `_lastVoiceTs`,
`_lastThoughtTs`, `_lastMemCount`).

## Livelli, archetipo, asset

- Curva: `xpNextLevel = round(1000 · level^1.35 / 50) · 50` (L2=2550, L3=4400…).
- Al level-up: XP residuo riportato, **asset sbloccato** in ordine da `ASSET_ORDER`
  (`base_grid → ambient_particles_low → shield_dome` esistono già in `app.js/rpgAssets`;
  `rune_circle, glyph_trail, crystal_garden, starfield, phoenix_core` sono nomi riservati
  per asset futuri — `syncUnlockedAssets` ignora le chiavi che non conosce), **archetipo
  ricalcolato** (dominante se ≥35% delle azioni, minimo 10 totali, altrimenti Neutro),
  **annuncio** push in `brain.thoughts` + `gaiaTTSQueue` ("Sento nuova forza. Livello N…")
  + evento `{source:'rpg', category:'levelup'}`.
- `stats` per archetipo (`{mago, bardo, guerriero, druido}`) esposta nel payload WS
  (`progression.stats`); i campi interni `_cd`/`_last*` restano privati (filtrati in
  `ThreeViewEngineGAME`).
- Persistenza: `gamification` era già inclusa in Save Brain/Parse Brain — sopravvive ai
  riavvii con stats e cooldown.

## Engine Tick (3s) — cambiamento strutturale

Nodo inject `Engine Tick (3s)` (id `rpg-engine-tick-3s`, topic `gaia/tick`) → `GAIA Brain`.
Prima il brain girava SOLO su eventi reali: a casa vuota niente eventi ⇒ niente frame WS
(dashboard/welcome/3D mute) e il polling RPG non girava. Il tick genera un evento sintetico
`{category:'tick'}` che:
- fa uscire il payload WS ogni ~3s sempre (HUD 3D e dashboard vivi anche a casa vuota);
- fa girare il polling XP (comando vocale premiato entro ~3s);
- rende fluido il decay del mood (che dal fix 2026-07-04 è per-tempo);
- **non** inquina `brain.events` né `brain.diary` (guardie `category !== 'tick'`).

Attenzione inject moderni: il topic va dentro `props` (`{"p":"topic","v":"gaia/tick","vt":"str"}`),
il campo legacy `topic` da solo non viene inviato.

## Consumatori già pronti (nessun lavoro fatto qui, era tutto in attesa dell'engine)

- `index.html`+`app.js` (scena 3D): HUD livello/XP/archetipo, `triggerLevelUpVFX()` (flash
  dorato al level-up), colori cuore/nebbia per classe (Mago ciano, Druido verde, Guerriero
  rosso, Bardo magenta), `syncUnlockedAssets()`.
- `portal.html`: metriche LIVELLO/ARCHETIPO + barra XP.
- `dashboard.html`: card "🎮 Progressione RPG" (aggiunta oggi — livello, barra XP oro,
  barre per archetipo da `stats`, chip asset sbloccati).

## Verifica eseguita

Sandbox (stub Node-RED): level-up a cavallo di soglia → livello 2, XP residuo 0,
`xpNextLevel` 2550, asset sbloccato, annuncio in coda TTS, cooldown blocca il doppio award.
Live: comando vocale via MQTT → +25 XP e `stats.mago` incrementato nel payload WS (visto
via context API e via WS raw, ~8 frame/12s col tick attivo).

## Level-up multisensoriale (2026-07-17)

- Il brain ha un **3° output** → `gaia/rpg/levelup` (topic MQTT, payload
  {level, class, asset, ts}) emesso nel blocco level-up.
- **Luci**: flow `RPG Levelup` (mqtt in) → `LevelupFX` → HueExecutor — scena
  10s su Tutte_le_luci nel colore dell'archetipo (Mago ciano, Bardo magenta,
  Guerriero rosso, Druido verde, Neutro bianco caldo), poi ripristino dello
  stato PRECEDENTE letto vivo da OpenHAB REST con `fetch` nel function node
  (brain.lights può essere stantio — successo davvero al primo test).
  Anti-doppione 30s per level-up multipli nello stesso while.
- **Rune (Asemico v5)**: ogni asset ha una parola italiana (`RUNE_WORDS`:
  fondamenta, polvere, scudo, cerchio, sentiero, giardino, stelle, fenice) →
  glifo = runa. Al level-up: welcome scrive la runa in ORO (stile `rune` in
  asemic.js, banda 0.40), pi/screen idem (sub `gaia/rpg/levelup`), dashboard
  mostra le rune rivelate come mini-canvas nei chip (AsemicGlyphs.glyphFor
  esportato — parità JS/Python verificata su 'cerchio').

## game.html — la superficie di gioco (2026-07-17)

`:1880/game.html` (nav "Gioco"): eroe (livello/archetipo/XP oro/rune come
glifi asemici), **mappa a biomi** delle stanze con dati reali (temperatura,
lux, oscurità, presenze, emozioni, note piante → bioma derivato: Giardino
sonoro, Focolare vivo, Penombra, Terra calda/fredda, Radura quieta), fog of
war per stanze del roomGraph senza sensori, barre archetipi, **diario delle
imprese** (eventi → linguaggio di gioco). Guardia innerHTML-se-cambia (WS a
rate alto). Nessun nodo Node-RED nuovo: consuma il payload esistente.

## Sala macchine — biomi TouchDesigner (2026-08-29/30)

Una stanza con un Agent TD registrato (`brain.rooms[stanza]._touchdesigner`,
popolato da `td_room_presence_fn`, Node-RED) diventa un bioma "Sala
macchine" invece del solito bioma ambientale — vedi `biomeKind()` in
game.html, controllato per primo. Estensioni sullo stesso canale
(nessun nodo Node-RED nuovo oltre a `td_room_presence_fn`/`td_audio_fn`):
- **Palette DMX come mood del bioma**: `room.dmxPaletteA` (letto da
  `p.params.dmx_a_palette` sullo status del device DMX) colora bordo/glow
  della card bioma (`DMX_PALETTE_COLORS` in game.html).
- **Kick audio come pulsazione**: `room.audioKick` (da `gaia/device/+/
  audio_levels`, 1Hz, via `td_audio_fn` — non retained, richiede
  `brain._tdDeviceRoom[device_id]` per risolvere la stanza) fa pulsare
  bioma+eroe (`.biome-kick`/`.hero-kick`, CSS keyframes).
- **Clip PatchDeck nel diario**: un `load_x{N}_{a|b}` che passa a "active"
  genera un evento `category:'clip'` (confronto contro l'ultimo stato
  servizi noto per device_id, non contro tutta la storia).

**Stessi dati portati anche in `index.html`/`app.js`** (2026-08-30,
esplicitamente richiesto — l'utente guarda quella pagina, non game.html):
l'anello della stanza prende il colore della palette invece del generico
colore-attività, un kick pulsa scala/opacità del marker, un evento clip
genera un burst dorato di particelle (riuso di `triggerGestureBurst`, già
usata per i gesti MediaPipe) — niente testo, index.html resta solo-visuale
per design (vedi toggle `visualHud`). Ogni Agent TD registrato in una
stanza compare anche come mesh distinta (sfera PatchDeck, cubo DMX, cono
generico) con etichetta nome, tinta dalla palette se online — dato
`room.tdDevices` (id/ip/online/family/name) già calcolato da
`ThreeViewEngineGAME`, family/name presi da una cache popolata da
`td_room_presence_fn` (`brain._tdDeviceFamily`/`_tdDeviceName`) perché
`brain.devices` non li porta.

**Finestra eventi**: `recentEvents` (Node-RED, `ThreeViewEngineGAME`) era
`.slice(-30)` — con qualcuno in casa vision/mediapipe generano un evento
ogni 100-300ms, quindi un evento raro come un clip PatchDeck spariva dal
diario entro pochi secondi. Allargata a `.slice(-150)`.

**Gotcha device TD "zombie"**: dopo una migrazione/rinomina lato TD (es.
passaggio ad Agent unico multi-rig, 2026-08-29), le vecchie istanze
(`PatchDeck-Mac-Mauro`, `PatchDeck-DMX`, `DMX-OPS` vecchio,
`td-controllerv7-macbook-air-di-mauro`, ecc.) possono restare vive sul lato
TD e ripubblicare periodicamente con stanza vecchia/sbagliata (`Test`,
`ConsolleDmx`, `unknown`), ricreando "stanze fantasma" anche dopo un
`/gaia/device/forget`. Il forget è solo un purge temporaneo: il fix vero è
fermare/rinominare l'istanza vecchia lato TD. Nel farne pulizia trovato e
corretto anche un bug reale in `rooms_clean_fn`: confrontava sempre nomi
stanza lowercased contro chiavi `brain.rooms` non garantite lowercase
(quindi `cleaned:[]` silenzioso su stanze tipo "Test"/"ConsolleDmx").

## Tap Switch — i riti (2026-07-17)

Hue Tap (4 bottoni fisici, stato in `Hue_tap_switch_1_Stato_interruttore_a_pulsante`,
valori 34=1, 16=2, 17=3, 18=4): HueNorm → categoria `button` → brain:
`_award('rituale')` (12 XP Mago cd 30s) + evento `{source:'rpg',
category:'ritual', value:btn}` + 3° output → `gaia/rpg/action`. Flow
`ActionFX (riti)`:
1. **Rito della luce** — scena archetipo 10s su Tutte_le_luci, ripristino live (fetch OpenHAB).
2. **Musica sì/no** — toggle primo preset nella stanza del Tap (`MUSIC_ROOM='soggiorno'` in ActionFX — adattare se il Tap si sposta).
3. **Vessillo** — stato RPG (Lv/XP/umore/rune) su Telegram via `gaia/notify/telegram`.
4. **Quiete** — stop musica in ogni stanza con player.

Tutti e 4 verificati live (bottoni simulati via busmqtt). LIMITE: ripremere
lo stesso bottone non cambia lo stato dell'item OpenHAB → nessun evento;
per ripetere un rito serve premere prima un altro tasto. Anti-rimbalzo 3s.

## Prossimi passi (non fatti)
- Asset 3D reali per i nomi riservati in `ASSET_ORDER`.
- Preset TouchDesigner al level-up.
- Bilanciamento XP/cooldown dopo qualche giorno con tutte le sorgenti attive
  (al 2026-07-17: Lv.4 Guerriero, druido fermo a 6 azioni per piante staccate).
