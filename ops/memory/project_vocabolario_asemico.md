---
name: project-vocabolario-asemico
description: "Vocabolario Asemico — lingua visiva deterministica di Gaia (parola→glifo), engine asemic.js, v1 live sulla welcome, roadmap gesture/Pi-screen/gioco"
metadata:
  node_type: memory
  type: project
  originSessionId: 139b6cd4-d727-4fcd-83d5-910eceaf6073
---

# Vocabolario Asemico — lingua visiva di Gaia

**Why:** modulo voluto dall'utente (2026-07-04) come engine trasversale: sfondo della welcome
(la pagina principale del touchscreen), UI innovativa, lingua del gioco RPG, piccolo schermo
"vivo" sul Pi. Trasforma TTS in/out in scrittura asemica; in futuro includerà gesture e colori.

**Il principio che NON va rotto:** determinismo — `parola → FNV-1a → mulberry32 → glifo`.
Stessa parola = stesso segno, ovunque, per sempre. È ciò che rende i glifi un vocabolario
apprendibile e non decorazione. Evoluzioni di stile → versionare, mai cambiare in place.

**How to apply:**
- Engine di riferimento: `/media/core/D/gaia-web/asemic.js` (classe `AsemicField`, no
  dipendenze). Nuove superfici lo includono, non copiano il codice.
- `field.say(text, 'out'|'in')` — out=Gaia (banda alta 0.24H, ciano, alpha .16), in=umano
  (banda 0.63H, blu, alpha .30/tratto 2.2 — il blu su fondo scuro sparisce a parità di
  valori, confermato dal vivo 2026-07-04: stili per-direzione in `this.style`).
- Welcome v1 live: canvas `#asemic-canvas` z-index 0, alimentato in `feedAsemic(d)` da tre
  sorgenti del payload WS: `tts` (campo NUOVO — `Extract TTS Text (minipc)` scrive
  `global.gaiaLastTts`, `ThreeViewEngineGAME` lo espone), `voiceCommands[]` (ultimo = in),
  `thought` (i pensieri spontanei non passano dal topic tts del minipc, viaggiano su
  `casa/tts/play`).
- Doc completo con roadmap v2-v6 e punti di aggancio: `docs/vocabolario-asemico.md` (repo).

Collegamenti: [[project-gaia-web]] (welcome), [[project-web-gaming-rpg]] (v5: glifi = rune
del gioco), [[project-touchdesigner-osc]] (possibile resa esterna), [[project-esp32-roadmap]]
(v4: schermo sul Pi è concettualmente vicino a quel fork).
