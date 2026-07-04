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
| v2 — Inchiostro dal mood | colore/spessore/velocità di scrittura da `soul.mood` + palette Arte Viva | `field.setInk()` già esposto; palette in `gaia-art/script.js` (`PALETTES`) |
| v3 — Gesture → glifi | le gesture MediaPipe (`rooms[].mediapipe.people[].gestures`) diventano segni: un gesto "scrive" | payload WS già pronto (multi-persona dal 2026-07-04) |
| v4 — Pi screen | piccolo display sul Pi che scrive ciò che il Pi sente/dice, "vivo" | porting Python dell'algoritmo (stesso seed); hardware da scegliere (SPI/OLED?); si aggancia a `gaia/voice/tts/{stanza}` e `gaia/voice/command/{stanza}` |
| v5 — Gioco RPG | glifi = rune/vocaboli del mondo di gioco; il vocabolario imparato in casa È quello del gioco | `brain.gamification` + blocco Gaming (docs/web-sections.md §3) |
| v6 — Vocabolario condiviso | estrarre l'algoritmo in una spec unica (JS+Python identici, test di parità sugli stessi seed) | `asemic.js` è la reference; aggiungere `pi/` port quando parte v4 |

## Regole per chi ci lavora

- **Mai rompere il determinismo**: cambiare l'algoritmo dei glifi cambia TUTTA la lingua
  retroattivamente. Se serve evolvere lo stile, versionare (`glyphFor(word, v2)`) e migrare
  consapevolmente.
- L'engine è condiviso: nuove superfici includono `asemic.js`, non copiano il codice.
- Testo → glifi è one-way per design (non è cifratura, è calligrafia): non serve "decodifica".
