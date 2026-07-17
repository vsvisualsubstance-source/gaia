# Vocabolario Asemico — la lingua visiva di Gaia

Modulo trasversale (roadmap 2026-07-04). Trasforma ciò che Gaia dice e sente in una
scrittura asemica: glifi inventati ma **deterministici** — la stessa parola produce sempre
lo stesso segno, su ogni pagina e ogni device. Non è decorazione casuale: è un vocabolario
apprendibile. Chi vive la casa inizia a riconoscere i segni ricorrenti ("Mauro", "luci",
"benvenuto") — la lingua diventa reale col tempo. Destinazioni: sfondo della Welcome (fatto),
UI innovativa, engine del gioco RPG (rune/incantesimi), piccolo schermo sul Pi ("come se
fosse vivo").

## Principio tecnico (portabile ovunque)

```
parola → FNV-1a 32bit (lowercase) → mulberry32 PRNG → glifo
```
Glifo = 2–5 tratti (curve quadratiche su 2–4 punti di controllo in cella 1×1) + eventuali
diacritici (punto sopra/sotto, barra bassa) + proporzione cella. Il numero di tratti cresce
con la lunghezza della parola. **L'algoritmo è la lingua**: qualsiasi porting (JS, Python
per il Pi, GLSL per TouchDesigner) che replica seed e costruzione produce gli stessi glifi.
Implementazione di riferimento: `/media/core/D/gaia-web/asemic.js` (classe `AsemicField`,
nessuna dipendenza, ~250 righe).

## v1 — Welcome page (fatto 2026-07-04)

- **Engine**: `gaia-web/asemic.js` — `new AsemicField(canvas)` + `field.say(text, 'out'|'in')`.
  Scrittura animata tratto-per-tratto (line-dash progressivo), tenuta ~9s, dissolvenza ~5s,
  max 3 frasi contemporanee, idle a costo ~zero. Cache glifi globale (`Map` parola→glifo).
- **Welcome** (`welcome.html`): canvas `#asemic-canvas` a z-index 0 (dietro avatar/orologio).
  Gaia scrive in **banda alta, inchiostro ciano** (`out`); l'umano in **banda bassa, blu,
  leggero corsivo** (`in`). Dedupe testi ripetuti entro 30s.
- **Sorgenti dati** (tutte già nel payload WS `ws://:1880/gaia`):
  - `tts {text, ts}` — **campo nuovo**: `Extract TTS Text (minipc)` salva
    `global.gaiaLastTts` a ogni risposta vocale, `ThreeViewEngineGAME` lo espone. È il
    canale "Gaia parla".
  - `voiceCommands[]` — ultimo comando trascritto = "l'umano parla" (`in`).
  - `thought` — i pensieri spontanei NON passano da `gaia/voice/tts/minipc` (viaggiano su
    `casa/tts/play`), quindi la welcome li prende dal campo `thought` (`out`).

## Punti di aggancio per le fasi future

| Fase | Cosa | Dove si aggancia |
|---|---|---|
| v2 — Inchiostro dal mood — **FATTO 2026-07-16** | `setMood()` in asemic.js: colore (accent palette Arte Viva), spessore e velocità di scrittura da `soul.mood`, transizione lerp ~2s; solo inchiostro 'out' (l'umano resta blu: identità, non stato); pi/screen segue via `gaia/brain/state` (anche il sigillo respira nel colore del mood); test: `welcome.html?mood=stress` | welcome `feedAsemic`, pi/screen `_lerp_mood` |
| v3 — Gesture → glifi — **FATTO 2026-07-16** | il gesto diventa parola italiana, la parola glifo (GESTURE_WORDS: fist=pugno, point=indice, victory=vittoria, three=tre, open_hand=saluto — vocabolario apprendibile); welcome legge `rooms[].gesture` (stanza del kiosk), pi/screen si abbona a `gaia/mediapipe/pose` filtrando la propria stanza, cooldown 30s | welcome `feedAsemic`, pi/screen `_on_message` |
| v4 — Pi screen | piccolo display sul Pi che scrive ciò che il Pi sente/dice, "vivo" | porting Python dell'algoritmo (stesso seed); hardware da scegliere (SPI/OLED?); si aggancia a `gaia/voice/tts/{stanza}` e `gaia/voice/command/{stanza}` |
| Herbarium — le piante scrivono — **FATTO 2026-07-16** | nota MIDI → parola del solfeggio (`NOTE_WORDS`: do, dodiesis, re… alfabeto deterministico di 12 glifi) → la pianta scrive in verde foglia (120,240,110). **pi/screen**: cursore sinistra→destra con a-capo, note gravi = segni più grandi, velocity = intensità inchiostro, fade 14s, riparte dall'alto dopo 30s di silenzio; trasporto **UDP localhost :8791** da gaia-herbarium (nel bosco non c'è broker — il canale locale funziona sempre). **welcome** (a casa): note→buffer `gaiaHerbNotes` in HerbariumNorm→campo `herbarium.notes` nel payload WS (ThreeViewEngineGAME)→`feedHerbarium` scrive frasi di solfeggio con inchiostro `herb` (banda centrale 0.44, terzo stile in asemic.js), max una ogni 4s; toggle in **Admin→Pi (card Core, 🌿 Herbarium → Web)** = GET/POST `/gaia/config/herbweb`, flag persistito come MQTT retained `gaia/config/herbweb` | pi/screen `_herb_place`/`_herb_udp_listener`, pi/herbarium `_dump_reader`, welcome `feedHerbarium`, Node-RED tab_media `herbweb_*` |
| v5 — Rune di gioco — **FATTO 2026-07-17** | asset RPG sbloccato → parola italiana (`RUNE_WORDS`) → runa in ORO (stile `rune` ink 255,214,90 banda 0.40 in asemic.js; `INK_RUNE` in pi/screen via `gaia/rpg/levelup`; mini-canvas nei chip dashboard con `AsemicGlyphs.glyphFor` esportato). Dettagli in docs/rpg-engine.md §Level-up multisensoriale | welcome `feedRunes`, pi/screen `_on_message`, dashboard `drawRunes` |
| v6 — Vocabolario condiviso | estrarre l'algoritmo in una spec unica (JS+Python identici, test di parità sugli stessi seed) | `asemic.js` è la reference; aggiungere `pi/` port quando parte v4 |

## Regole per chi ci lavora

- **Mai rompere il determinismo**: cambiare l'algoritmo dei glifi cambia TUTTA la lingua
  retroattivamente. Se serve evolvere lo stile, versionare (`glyphFor(word, v2)`) e migrare
  consapevolmente.
- L'engine è condiviso: nuove superfici includono `asemic.js`, non copiano il codice.
- Testo → glifi è one-way per design (non è cifratura, è calligrafia): non serve "decodifica".
