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

## Prossimi passi (non fatti)

- Superficie di gioco dedicata game.html (in corso 2026-07-17).
- Tap Switch Hue (4 bottoni, di nuovo vivo) come controller di azioni rituali.
- Asset 3D reali per i nomi riservati in `ASSET_ORDER`.
- Preset TouchDesigner al level-up.
- Bilanciamento XP/cooldown dopo qualche giorno con tutte le sorgenti attive
  (al 2026-07-17: Lv.4 Guerriero, druido fermo a 6 azioni per piante staccate).
