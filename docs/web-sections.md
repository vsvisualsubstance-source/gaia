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
verso ogni sezione), `index.html`+`app.js` (vista 3D Three.js), `welcome.html` (kiosk
ospiti/enrollment, vedi memory `project-gaia-web`), `asemic.js` (engine Vocabolario Asemico —
lingua visiva deterministica di Gaia, v1 come sfondo della welcome; roadmap completa e punti
di aggancio in `docs/vocabolario-asemico.md`).

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

**Stato:** embrionale — solo modello dati, nessun gameplay reale ancora. Vive dentro
`ThreeViewEngineGAME` (Node-RED) come `brain.gamification`:
```js
{ level: 1, xp: 0, xpNextLevel: 1000, activeClass: "Neutro", unlockedAssets: ["base_grid"] }
```
Inizializzato una volta in "GAIA Brain" (Node-RED) e **mai aggiornato** — nessuna logica di
guadagno XP, level-up o sblocco asset esiste oggi. È esposto nel payload WS come `progression`
e visualizzabile lato client, ma è uno scaffold, non un gioco.

**Visione (dall'utente):** deve evolvere in una vera piattaforma RPG multisensoriale — non solo
UI web, ma progressione legata a eventi reali della casa (presenza, voce, automazioni), con
ricompense che si riflettono su luci/audio/arte visiva/TouchDesigner.

**Cosa serve per svilupparlo in autonomia (roadmap, non ancora implementato):**
1. **Motore XP**: decidere quali eventi generano XP (es. comandi vocali riusciti, nuove persone
   riconosciute, automazioni completate) e scrivere la funzione Node-RED che aggiorna
   `brain.gamification` (attualmente assente — nessun nodo scrive su questo campo dopo l'init).
2. **Classi/progressione**: definire soglie livello → `activeClass`, e come questo influenza il
   resto del sistema (es. sblocco automazioni Maggiordomo più avanzate, palette Arte Visiva,
   preset TouchDesigner).
3. **Superficie di gioco**: oggi non esiste una vera schermata "Gaming" nel portal — va creata
   (o estesa da `index.html`/Three.js) per rendere tangibile la progressione.
4. **Multisensoriale**: collegare progressione/eventi a luci (OpenHAB via `MoodSceneSync`), TTS,
   e in prospettiva a TouchDesigner per feedback visivo/fisico nella stanza.

Prima di scrivere codice su questo blocco, leggere la memory `project-web-gaming-rpg` (contiene
il dettaglio di cosa esiste oggi in `ThreeViewEngineGAME`/`GAIA Brain` e va aggiornata con le
decisioni di design man mano che vengono prese).

---

## Convenzione per aggiungere un blocco Web nuovo

1. Il dato arriva sempre da `ws://{host}:1880/gaia` — non creare nuovi endpoint HTTP/WS a meno
   che il blocco non produca dati che gli altri non hanno bisogno di vedere.
2. Aggiungi la pagina sotto `/media/core/D/gaia-web/` (runtime, non in git) e un link da
   `portal.html`.
3. Documenta qui la sezione (stato + roadmap) e crea/aggiorna la memory dedicata per i dettagli
   implementativi che il codice da solo non racconta (perché una decisione è stata presa,
   non solo cosa fa il codice).
