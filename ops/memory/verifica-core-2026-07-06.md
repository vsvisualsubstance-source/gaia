# Verifica dal Core — test visione OPS (2026-07-06, ~10:50)

Eseguita dal Claude del Core mentre i servizi OPS giravano. **Esito: FUNZIONA end-to-end.**

- **camera_server (Windows)**: MJPEG attivo su `192.168.1.239:8766/video` ✓
- **mediapipe**: `gaia/mediapipe/pose` ogni ~1s, `device_id=ops-silvermini2-mp`,
  stanza cucina, **profilo multi-persona attivo** (`people_count`/`people[]` presenti) ✓
- **yolo**: heartbeat su `gaia/cucina/heartbeat` ✓ — era su "unknown", il Core ha
  assegnato la stanza via `POST /gaia/device/assign {device_id, room}` (endpoint
  Node-RED del Device Registry) e i topic sono cambiati al volo senza riavvio ✓
- **brain**: `rooms.cucina` con `_mediapipe:true, _yolo:true`, lastUpdate fresco ✓
  → la Welcome page reagirà alla cucina senza altre modifiche
- **Carico macchina** (con tutto attivo): CPU ~46% media, RAM 35% di 32GB.
  Nota: FRAME_SKIP=1 analizza ogni frame — con `FRAME_SKIP=2` il carico visione
  si dimezza quasi, se serve margine per la voce.

## Da sistemare (per il Claude OPS)

1. **Unificare DEVICE_ID**: mediapipe usa `ops-silvermini2-mp`, yolo `ops-silvermini2`
   → regola del progetto: UN device_id per macchina (`ops-silvermini2` per tutti),
   altrimenti il registry vede due device. Dopo l'unificazione il Core riassegna
   la stanza all'ID unico e ripulisce il retained di `-mp`.
2. Valutare `FRAME_SKIP=2` per i margini di cui sopra.
3. Prossimo passo concordato: spegnere la visione locale sul miniPC
   (`gaia-local-agent`) e confrontare — poi la voce (Missione 2 punto 4).
