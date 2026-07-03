# Node-RED — mappa dei flussi

`flows.json` in questa cartella è una copia git-tracked del flow live
(`/home/core/.node-red/flows.json` — sincronizzazione manuale, vedi memory `project-gaia` →
"Node-RED — sincronizzazione flows"). Questo file mappa i tab del flow ai blocchi funzionali
del sistema, per orientarsi senza dover aprire l'editor Node-RED o grep-are tutto il JSON.

| Tab | Ruolo | Documento di riferimento |
|---|---|---|
| **Gaia Engine** | Cuore del sistema: `GAIA Brain` (aggiorna lo stato globale `gaiaBrain` da ogni evento), `ThreeViewEngineGAME` (costruisce il payload WebSocket per dashboard/arte visiva/gaming), pipeline pensiero (`Cognitive Trigger` → Qdrant → Ollama), `MoodSceneSync`, `MovementEngine` | [`docs/pensieri-profondi.md`](../docs/pensieri-profondi.md) |
| **Normalyzer** | Normalizza input eterogenei (Hue, MediaPipe, YOLO, piante, presenza) nel formato che `GAIA Brain` si aspetta | — |
| **Vision Identity** | Riconoscimento facciale → aggiorna presenza/identità in `gaiaBrain` | memory `project-gaia` |
| **Chat** | Chat testuale (Telegram + futuri canali), intent parsing, esecuzione azioni (luci Hue via `HueExecutor`) | memory `project-openhab-hue-items` |
| **Voice** | Ingresso comandi vocali (Pi + miniPC) → routing verso Chat | memory `project-gaia` |
| **GAIA Voice** | Intent detection specifico voce (luci, orario, meteo, timer, stato sistema, ...) | memory `project-gaia` |
| **Device Registry** | Assegnazione stanza ai Pi/device, OTA broadcast, lista automazioni attivabili | memory `project-gaia` → "Discovery & Provisioning" |
| **GAIA Devices** | Comandi per singolo device/servizio (enable/disable YOLO/MediaPipe/Voice, reboot, OTA) | `pi/CLAUDE.md` |
| **Inject** | **Non è solo un tab di test** — contiene automazioni di produzione innescate da inject periodici: `Night Reflection` (riassunto giornaliero), `Maggiordomo`, `Pet_Consierge`, `Disability`, caricamento/salvataggio `gaiaBrain` su file | [`docs/maggiordomo.md`](../docs/maggiordomo.md), [`docs/pet-disability.md`](../docs/pet-disability.md) |

**Attenzione tab "Inject":** `Pet_Consierge` e `Disability` risultano con l'output non
collegato (`wires: [[]]`) al momento della stesura — vedi
[`docs/pet-disability.md`](../docs/pet-disability.md) prima di assumere che siano attive in
produzione.

## Blocchi "Gaming/RPG" e "Arte Visiva"

Non sono tab Node-RED separati: entrambi consumano lo stesso payload WebSocket costruito da
`ThreeViewEngineGAME` (Gaia Engine). Vedi [`docs/web-sections.md`](../docs/web-sections.md).

## TouchDesigner

Nuovo consumatore dello stesso payload, via bridge OSC dedicato (fuori da Node-RED, servizio
Python separato) — vedi [`minipc/touchdesigner/README.md`](../minipc/touchdesigner/README.md).

## Convenzioni

- Ogni automazione nuova che legge `gaiaBrain` deve assumerlo come stato globale condiviso, non
  come dato locale al proprio tab — non duplicare letture già fatte da `GAIA Brain`/`Normalyzer`.
- Se aggiungi un campo al payload WebSocket (`ThreeViewEngineGAME`), documentalo nella memory
  `project-gaia-web` (schema payload) — tutti i consumatori (dashboard, arte visiva, gaming,
  TouchDesigner) dipendono da quello schema.
