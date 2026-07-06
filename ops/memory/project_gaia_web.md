---
name: project-gaia-web
description: "Gaia web UI — dashboard.html, admin.html, welcome.html, pi-manager.html(redirect) — architettura, state machine, enrollment wizard (v1.0.2)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 8012867d-fe76-4f6f-bc52-dae005c52866
---

# Gaia Web UI

Percorso: `/media/core/D/gaia-web/` — servita da Node-RED `httpStatic`, non in git.
**Why:** UI di controllo e monitoraggio del sistema GAIA, accessibile da browser LAN.
**How to apply:** Modifiche vanno su `/media/core/D/gaia-web/`, non nel repo. Node-RED le serve direttamente.

## Design token condivisi (uniformati 2026-07-04)

Tutte le pagine usano la stessa famiglia: `--bg:#050810` (dashboard/portal/welcome/arte;
admin `#08090f`), `--card:#0e1221`, `--border:#1e2840`, `--accent:#00ffcc`,
`--blue:#58a6ff` (secondario), `--text:#c9d1d9`, `--muted:#6b7a99`, font `'Segoe UI',
system-ui, sans-serif`. L'admin usava la palette GitHub (#0d1117/#58a6ff come accento) —
migrata ai token GAIA; il portal usava Courier New — migrato. Ogni pagina ha nav/link
verso le altre (admin e dashboard hanno anche il link "Arte"). Backup pre-restyling:
`.admin.html.bak`, `.dashboard.html.bak`, `.portal.html.bak`, `.gaia-art.bak/`.

---

## `dashboard.html` — Dashboard live

**WebSocket:** `ws://{host}:1880/gaia` — payload inviato da `ThreeViewEngineGAME` ogni ~1s.

**Pattern DOM stabile (v1.0.1):** ogni sezione è un `<div id="sec-*">` permanente aggiornato in-place da `setSection(id, html, show)` — confronta `innerHTML` prima di sovrascrivere per evitare flickering e perdita di focus.

Sezioni stabili:
- `sec-thought`, `sec-soul`, `sec-people`, `sec-rooms`
- `sec-voice` — card comandi vocali, alimentata da `data.voiceCommands[]` (da `brain.voiceCommands` in Node-RED)
- `sec-lights`, `sec-sensors`, `sec-plants`, `sec-events`, `sec-metrics`

**Debug panel (collassabile):** tabelle rooms/people/voiceCommands ricostruite solo quando aperto E dati cambiati (hash check su `JSON.stringify`). Raw JSON sempre aggiornato ma in forma compatta (summary).

**Payload WS atteso:**
```json
{
  "ts": 1234567890,
  "voiceStatus": {"status": "idle|listening|processing"},
  "voiceCommands": [{"text":"...", "stanza":"...", "intent":"...", "ts":...}],
  "soul": {"mood":"...", "stress":0.2, "calm":0.8, "social":0.5, "curiosity":0.3, "lifeIndex":65},
  "progression": {"level":3, "xp":1200, "xpNextLevel":2000, "activeClass":"Esploratore"},
  "people": [{"name":"...", "room":"...", "emotion":"...", "pose":"...", "confidence":0.9}],
  "rooms": [{"name":"...", "persons_count":1, "activity":"...", "objects":{...},
             "mediapipe":{"emotion":"...","pose":"...","gesture":null,"attention":"...",
                          "people_count":1, "people":[{...per-persona...}]}}],
  "lights": [...], "sensors": [...], "events": [...]
}
```

---

## `admin.html` — Admin unificato

**Backend poll:** `http://{host}:8765/api/status` ogni 2s (gaia_admin.py).

**Tab nav (v1.0.1):**
- `showTab('cfg', btn)` → mostra `#tab-cfg` (tutto il contenuto admin esistente)
- `showTab('pi', btn)` → mostra `#tab-pi` + chiama `initPiManager()` la prima volta (MQTT lazy)

**Pi Manager embedded:** MQTT client caricato da `unpkg.com/mqtt` solo al primo click sul tab Pi. `_pmClient` è null fino ad allora. Topic: `gaia/device/+/status` su porta 9001. Cards Pi aggiornate con `pmPatchCard()` (non rebuild se già esistono) — input non sovrascritti se hanno il focus.

**Sezioni:**
1. Microfoni Stato live (RMS bar + ticks soglie per miniPC e Pi)
2. Soglie voce miniPC + calibrazione
3. Soglie wakeword Pi + calibrazione Pi
4. Enrollment voce (mic + file upload) / Voci nel DB
5. Enrollment volto (webcam locale + YOLO frame + file upload) / Volti nel DB
6. Wakeword "Gaia" — raccolta campioni + training `gaia_verifier.pkl`
7. Citofono — raccolta campioni + training `doorbell_verifier.pkl`
8. Automazioni Node-RED (toggle globali e per-stanza)
9. **Tab Pi Devices** — cards Pi con servizi, rename stanza, reboot

**Box persone e clip (rifatti 2026-07-04):**
- Voci/Volti nel DB: `.person-tile` (avatar 44px + nome + meta + ✕). I volti mostrano la
  thumbnail reale via `GET :8765/api/faces/{name}/thumb` (endpoint aggiunto a gaia_admin.py,
  serve la prima immagine della cartella `/media/core/D/face-env/faces/{name}/`); fallback
  a iniziale se l'immagine non carica. `renderSpeakers`/`renderFaces` hanno dirty-check
  (`_speakersKey`/`_facesKey`) — il poll /api/status ogni 2s non ricostruisce più il DOM
  se la lista non è cambiata (prima sfarfallava e ricaricava le thumb ad ogni poll).
- Clip wakeword/citofono: `_clipButtons` ora rende una `.clip-strip` scorrevole
  (max-height 96px) di `.clip-tile` (▶ n | 🗑) — con 20-30 campioni non esplode più in
  righe infinite di bottoni. I tre refresh (Pi/minipc/citofono, ogni 5s) passano da
  `_setHtmlIfChanged()` per non perdere la posizione di scroll della strip.

---

## `welcome.html` — Kiosk fullscreen (v1.0.2)

Pagina per ospiti e utenti della casa, touch-friendly. Avviata su miniPC/OPS in modalità kiosk.

**Architettura:** macchina a stati JS (`_state = AMBIENT|GREETED|STRANGER|WIZARD`).
- **WS:** stessa connessione `ws://{host}:1880/gaia` — legge `people[]`, `rooms[]`, `soul`, `thought`, `voiceStatus`
- **Camera:** stream MJPEG dal camera_server `:8766/video` (NON getUserMedia — condiviso con YOLO) in `#cam-main` (bolla) e `#wiz-video` (wizard)
- **Riconoscimento:** `realId.startsWith('unknown')` = sconosciuto → stato STRANGER; altrimenti GREETED
- **Timeout:** GREETED=15s, STRANGER=30s, WIZARD=120s — reset su ogni tocco/click

**Sfondo asemico (2026-07-04):** canvas `#asemic-canvas` (z-index 0, dietro tutto) alimentato
da `feedAsemic(d)` nel ws.onmessage — scrive in glifi asemici ciò che Gaia dice (`d.tts` campo
nuovo + `d.thought`, banda alta ciano) e ciò che sente (`d.voiceCommands`, banda bassa blu).
Engine condiviso `asemic.js`, dettagli in [[project-vocabolario-asemico]].

**Bolla camera → vista MediaPipe (2026-07-04):** in GREETED la bolla ferma lo stream MJPEG
(`img.src=''`, chiude la connessione — privacy: riconosciuto ⇒ niente video grezzo) e mostra
`#mp-view`: emozione (emoji), posa+gesto (POSE_ICON/GESTURE_ICON), 😴 se occhi chiusi, badge
`👥 N` se `people_count ≥ 2`. Dati da `rooms[].mediapipe` del payload WS (stanza = `person.room`),
aggiornati a ogni messaggio WS via `renderMp(person)`. In AMBIENT/STRANGER `showMpView(false)`
ripristina il MJPEG (serve al wizard foto). `emotion:null` = volto non visibile → mostra 👤.
Attenzione: `img.onerror` è guardato con check `src.includes(':8766')` perché `src=''` genera
un error event fasullo che nasconderebbe la bolla.

**Avatar canvas:** 3 anelli concentrici pulsanti `#00ffcc`, colore cambia per `voiceStatus` (giallo=listening, blu=processing). Core glow radiale al centro. Ampiezza guidata da `soul.lifeIndex`.

**Wizard enrollment (4 step):**
1. **Nome** — input touch, autocapitalize, min 2 caratteri
2. **Foto** — 3 scatti via getUserMedia → `canvas.toDataURL` → `POST /api/enroll/face-upload {name, image_base64}` × 3; thumbnail visivo dopo ogni scatto; step 3 auto-avanza
3. **Voce** — `POST /api/enroll/voice {name, samples:1, duration_s:5}` → countdown JS 5s; pulsante "Salta" disponibile
4. **Done** — auto-chiude dopo 4s → torna AMBIENT (il WS aggiornerà presto con il nome appena registrato)

**Kiosk CSS:** `overflow:hidden; user-select:none; touch-action:manipulation`. Font `clamp()`. Bottoni `min-height:80px`. Video specchiato (`transform:scaleX(-1)` per frontale).

**Link admin discreto** (top-left, quasi invisibile): `href="admin.html"`.

---

## `gaia-art/` — Arte Visiva (riscritta da zero 2026-07-04)

Canvas 2D generativo (~420 righe `script.js`, no librerie), stessa WS `ws://{host}:1880/gaia`.
Architettura del quadro (in ordine di disegno per frame):
1. **Bande Rothko**: 3 campi colore per mood, renderizzati su offscreen 16×128 e upscalati
   (l'upscale con smoothing fa da blur gratis). Disegnate con alpha 0.085 per frame → fanno
   anche da dissolvenza delle scie particelle.
2. **Flow-field di particelle** (620, adattive fino a min 220 se il frame supera 42ms):
   campo = somma di seni, turbolenza da `soul.stress`, velocità da `soul.energy`, hue dal
   range della palette mood, composite `lighter`. Tap/click → ripple (impulso radiale).
3. **Braci**: 3 per luce accesa (max 24), salgono dal fondo.
4. **Nucleo respirante**: 4 anelli + glow, raggio da `lifeIndex`; colori stato voce IDENTICI
   alla welcome (listening verde acido `45,200,0`, processing azzurro `88,166,255`, idle =
   accent della palette) — identità visiva cross-pagina.
5. **Orbi presenza**: una per persona presente (orbita attorno al nucleo, seed dal nome,
   nome in maiuscoletto sotto; emotion happy → alone caldo pulsante).
6. **Pensiero**: crossfade tra pensieri, word-wrap max 2 righe, Georgia italic, colore accent.
7. Vignettatura (pre-renderizzata al resize) + grana pellicola (tile 128px, alpha .05).
Palette per mood: neutra(indaco-teal)/calm(verde-acqua)/stress(ossido-brace)/social(ambra)/
curiosity(viola) — lerp RGB continuo tra palette al cambio mood. `MOOD_ALIAS` mappa nomi
storici (serena→calm, sofferente→stress…). Chrome DOM: `#ws-dot`, chip `#info`
(moodLabel+status), link `⌂` → `../portal.html`. DPR-aware (cap 2×).
Primo candidato per TouchDesigner ([[project-touchdesigner-osc]]): stessi dati, resa esterna.

---

## `pi-manager.html` — SOLO redirect (consolidato 2026-07-03)

Ora è uno stub `<meta refresh>` → `admin.html#pi`. La pagina standalone originale è in backup `.pi-manager.html.bak`. Non aggiungere feature qui: tutto il Pi Manager vive nel tab Pi di admin.html.

---

## Navigazione (consolidata 2026-07-03)

- `portal.html` = landing con card: GAIA VISUAL (index.html 3D), Dashboard, Arte Viva (gaia-art/), Admin, Welcome
- admin.html e dashboard.html hanno link "⌂ Portal"; dashboard "Pi Manager" punta a `admin.html#pi`
- **Deep-link tab admin**: `admin.html#pi` / `#cfg` apre il tab al load (listener DOMContentLoaded); `showTab` aggiorna l'hash con `history.replaceState`
- Tab Pi contiene anche card "Device registrati" (provisioning: `GET /api/provision/devices`, assegna stanza → `/api/provision/assign` che sincronizza registry + MQTT + Device Registry Node-RED)
