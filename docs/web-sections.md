# Sezione Web — blocchi e roadmap

Runtime: `/media/core/D/gaia-web/` (servito da Node-RED `httpStatic`, **non in git**). Questo
documento vive nel repo perché descrive architettura/roadmap; i dettagli tecnici minuti di
`dashboard.html`/`admin.html`/`welcome.html` sono nella memory `project-gaia-web` (vedi CLAUDE
memory index). Qui invece: com'è organizzata la sezione Web in blocchi autonomi e cosa manca in
ognuno per crescere in isolamento.

Tutti i blocchi condividono la stessa fonte dati: WebSocket `ws://{host}:1880/gaia`, payload
costruito da `ThreeViewEngineGAME` (Node-RED, tab "Gaia Engine") ogni tick. Non duplicare la
logica di lettura brain in ogni pagina — se serve un campo nuovo nel payload, aggiungilo lì una
volta sola.

**Shell condiviso** (non un blocco a sé, ma serve a tutti): `portal.html` (landing con le card
verso ogni sezione), `index.html`+`app.js` (vista 3D Three.js, "RPG GAMING" nel portal — cuore
torusknot, stanze reali dal room graph, ombre umane ancorate alla propria stanza, oggetti YOLO
posizionati per stanza, HUD con livello/XP/archetipo), `welcome.html` (kiosk
ospiti/enrollment, vedi memory `project-gaia-web`), `asemic.js` (engine Vocabolario Asemico —
lingua visiva deterministica di Gaia, v1 come sfondo della welcome; roadmap completa e punti
di aggancio in `docs/vocabolario-asemico.md`).

**Sequenza sogno in `app.js` (2026-07-25):** su `lastDreamTs` nuovo, la scena scivola (lerp
lento, 40s di tenuta) verso il viola "curiosity"/sogno (stesso colore di welcome.html/pi-screen/
gaia-art), sovrastando i colori guidati da mood/archetipo RPG del momento — il sogno vince
sempre, "la casa dorme" indipendentemente da cosa stesse succedendo prima. Il battito del cuore
rallenta proporzionalmente (`dreamIntensity`), l'HUD mostra il testo del sogno al posto del
pensiero corrente mentre attivo. Verificato via syntax-check e schema dati (`lastDream`/
`lastDreamTs` già confermati presenti in sessione) — **non verificata la resa visiva**, nessun
browser disponibile in questo ambiente.

---

## 1. Admin + Pi Manager

**Stato:** maturo, in uso quotidiano. Documentazione completa in memory `project-gaia-web`
(tab nav, enrollment wizard, Pi Manager MQTT lazy-load) — non ripetuta qui.

**File:** `admin.html` (+ redirect stub `pi-manager.html`). **Backend:** `minipc/script/gaia_admin.py`
porta 8765.

**2026-07-04 — UI uniformata:** tutte le pagine web condividono ora gli stessi design token
(sfondo blu-nero `#050810`/`#08090f`, accento `#00ffcc`, bordo `#1e2840`, Segoe UI) — l'admin
ha lasciato la palette GitHub, il portal il Courier New. Box "Voci/Volti nel DB" con card
avatar+thumbnail (nuovo endpoint `GET :8765/api/faces/{name}/thumb` in gaia_admin.py) e clip
wakeword/citofono in strip scorrevoli anti-flicker. Dettagli in memory `project-gaia-web`.

**Sviluppo autonomo — cosa serve prima di toccarlo:**
- Leggere memory `project-gaia-web` (sezioni `admin.html`) per il pattern tab + MQTT lazy.
- Non serve altro contesto: il backend è tutto in un unico file (`gaia_admin.py`), gli endpoint
  sono elencati in memory `project-gaia`.
- TODO aperto noto: device audio corrente non mostrato nel panel "Microfoni — Stato live"
  (vedi memory `project-gaia` → "Note di sistema").

---

## 2. Arte Visiva (`gaia-art/`)

**Stato:** riscritta da zero il 2026-07-04 (la v1 "contemplativa" non convinceva). Canvas 2D
generativo senza librerie, WS `ws://{host}:1880/gaia`. File: `gaia-art/index.html`,
`script.js` (~420 righe), `style.css`.

**Come funziona oggi:** bande Rothko per-mood (offscreen 16×128 upscalato = blur gratis, ridipinte
con alpha bassa a ogni frame così fanno anche da fade delle scie) + flow-field di ~620 particelle
(turbolenza da `soul.stress`, velocità da `soul.energy`, hue dalla palette mood, qualità adattiva
se il frame rallenta) + nucleo respirante con i colori-stato voce della welcome + un'orbe con nome
per ogni persona presente + braci per le luci accese + pensiero in crossfade. Tap = ripple nel
campo. Palette lerp continua tra mood. Dettaglio layer-per-layer in memory `project-gaia-web`.

**Aggiunte 2026-07-25** (stessi dati appena estesi per il feed TouchDesigner
`/gaia/canvas/...`, riusati qui per coerenza visiva su tutte le superfici):
- **Sogno**: su `lastDreamTs` nuovo, sequenza dedicata — velo viola su tutta
  la scena + testo in alto (banda separata dal pensiero normale, che resta
  in basso), tenuta 42s, molto più lunga del pensiero. Stesso viola
  "curiosity"/sogno di welcome.html e pi/screen.
- **Oggetti rilevati (YOLO/mediapipe)**: prima ignorati del tutto, ora ogni
  classe vista in una stanza (`rooms[].objects`) genera una "mote" seedata
  con FNV-1a — **stesso algoritmo del vocabolario asemico e del feed TD**:
  "sedia" produce sempre lo stesso segno qui, sul Pi, e in TouchDesigner.
  Dissolvenza quando l'oggetto non è più visto, non sparizione di scatto.
  Limite 14 motes simultanee.
- **Burst livello RPG**: prima il livello era letto solo per l'etichetta
  testuale, mai visivamente — ora un impulso dorato (stesso oro delle rune
  asemiche) dal nucleo quando `progression.level` sale.

Verificato dal vivo lo schema dati (progression.level, rooms[].objects,
lastDream/lastDreamTs combaciano esattamente col codice) — **non verificata
la resa visiva** in browser, nessun headless disponibile in questo ambiente.

**Correzioni dopo il primo giro di feedback utente (stesso giorno):**
- Tolto il livello/classe RPG dal testo in alto (`updateChip`) — l'utente
  non lo vuole a schermo, resta solo mood/presenze/luci.
- **Ancoraggio per stanza** (`roomAnchor()`): prima ogni persona orbitava
  a caso intorno a un unico centro condiviso, quindi "Mauro in salotto" ed
  "Eli in ingresso" finivano visivamente indistinguibili. Ora ogni stanza
  ha un'ancora deterministica (stesso FNV-1a del nome stanza) e le persone
  si raggruppano intorno all'ancora della PROPRIA stanza — stanze diverse
  = zone diverse della scena, leggibile "a livello di arte" senza scritte
  aggiuntive. Le motes degli oggetti seguono la stessa ancora della loro
  stanza, non più un anello generico intorno al nucleo.

**Sviluppo autonomo:**
- Non serve toccare Node-RED per aggiungere nuove forme visive: tutto il necessario (soul,
  people, rooms, lights, plants, thought, progression) è già nel payload WS esistente
  (schema completo in memory `project-gaia-web`).
- Se serve un dato non ancora nel payload, aggiungerlo in `ThreeViewEngineGAME` (Node-RED) e
  documentarlo in memory `project-gaia-web`, non improvvisare un secondo canale dati.
- **Prossimo passo naturale:** questo è il candidato più diretto per l'integrazione TouchDesigner
  (vedi `minipc/touchdesigner/README.md`) — stessa mappatura mood→estetica, ma generata
  esternamente con più potenza (particellari, shader, video mapping reale in stanza).

---

## 3. Gaming / RPG

**Stato:** motore VIVO dal 2026-07-04 — la vita reale della casa genera XP, livelli,
archetipi (Mago/Bardo/Guerriero/Druido) e sblocco asset per la scena 3D. Documento completo
del motore (regole XP, curva livelli, Engine Tick 3s, verifica eseguita):
**`docs/rpg-engine.md`**. La scena 3D (`index.html`+`app.js`) era già pronta a consumare
tutto (HUD, VFX level-up, colori per classe) e ora riceve dati veri; la dashboard ha la
card "🎮 Progressione RPG".

`game.html` (nav "Gioco") è la superficie di gioco dedicata: eroe, mappa a
biomi delle stanze, diario delle imprese. Dal 2026-08-29/30 le stanze con
un Agent TouchDesigner diventano biomi "Sala macchine" (palette DMX come
mood, kick audio come pulsazione, clip PatchDeck nel diario) — stessi dati
portati anche nella scena 3D `index.html`/`app.js` (tinta stanza, mesh per
device, burst su clip). Dettagli completi in `docs/rpg-engine.md`.

**Roadmap rimanente:**
1. **Multisensoriale**: level-up → scene luci OpenHAB (`MoodSceneSync`), preset TouchDesigner.
3. **Asset 3D reali** per i nomi riservati in `ASSET_ORDER` (rune_circle, glyph_trail…).
4. **Vocabolario Asemico v5**: glifi come rune di gioco (`docs/vocabolario-asemico.md`).
5. **Bilanciamento** XP/cooldown dopo giorni di uso reale.

Prima di scrivere codice su questo blocco, leggere `docs/rpg-engine.md` + memory
`project-web-gaming-rpg`.

---

## Convenzione per aggiungere un blocco Web nuovo

1. Il dato arriva sempre da `ws://{host}:1880/gaia` — non creare nuovi endpoint HTTP/WS a meno
   che il blocco non produca dati che gli altri non hanno bisogno di vedere.
2. Aggiungi la pagina sotto `/media/core/D/gaia-web/` (runtime, non in git) e un link da
   `portal.html`.
3. Documenta qui la sezione (stato + roadmap) e crea/aggiorna la memory dedicata per i dettagli
   implementativi che il codice da solo non racconta (perché una decisione è stata presa,
   non solo cosa fa il codice).
