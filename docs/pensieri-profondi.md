# Pensieri Profondi — Gaia Brain, memoria a lungo termine, evoluzione linguistica

Il "pensiero" di Gaia vive interamente in Node-RED, tab **Gaia Engine**, più il servizio
`gaia-brain` (Qdrant, fuori dal repo git, vedi `/media/core/D/gaia-brain/`). Questo documento
mappa la pipeline così com'è oggi, per poter lavorare su "far pensare Gaia meglio" senza dover
rileggere tutto `flows.json`.

---

## Pipeline di un pensiero (eventi → LLM → TTS/Telegram)

```
evento (vision/voice/mqtt) → Cognitive Trigger → Prepara Query LTM → [Qdrant recall]
   → Inietta Memoria → Build Prompt (Contestuale) → Ollama (http) → Extract Thought & Push TTS
   → QdrantStore (persiste il nuovo pensiero come memoria)
```

- **Cognitive Trigger** (function, Gaia Engine): filtro — scarta eventi "rumorosi" (pose,
  frame, temperatura, movimento) e persone sconosciute. Passa solo `hazard`, `identity` con
  persona nota, `presence` enter/exit con persona nota, o `doorbell`. **Throttle 3 minuti** tra
  un pensiero LLM e l'altro (`MIN_SPEAK_MS`) — non tutti gli eventi rilevanti generano un
  pensiero, solo se è passato abbastanza tempo dall'ultimo.
- **Prepara Query LTM**: costruisce una query testuale (da `msg.event` o dallo stato presenza
  corrente) da mandare a Qdrant per recuperare ricordi rilevanti.
- **Qdrant recall/store**: servizio HTTP locale `localhost:8000` (`gaia-brain`, fuori repo).
  `QdrantStore` fa POST a `/remember` quando `msg.topic === 'qdrant/store'`. Collection:
  `gaia_memory_large` (vedi memory `project-gaia` → nota Qdrant nel docker-compose).
- **Inietta Memoria**: inserisce i ricordi recuperati (`recalled_memories`) nel messaggio
  originale come `long_term_memory`, o un placeholder se non c'è nulla di rilevante.
- **Build Prompt (Contestuale)**: costruisce il prompt finale per Ollama descrivendo chi è
  presente, dove, e cosa sta facendo (`activity`: working/resting/sitting/presente).
- **Ollama**: `qwen2.5:3b` (istruzioni contestuali) — HTTP locale.
- **Extract Thought & Push TTS**: estrae il testo, lo salva in `brain.thoughts` (max 300, in
  `gaiaBrain` — usato anche per popolare `thought` nel payload WS della dashboard/arte visiva),
  lo accoda per TTS (`gaiaTTSQueue`, max 20) e — se non più di un pensiero al minuto è già
  andato su Telegram — lo invia come alert.

## Ciclo notturno — riassunto giornaliero

```
Night Reflection (inject, orario) → Night Summary Prompt → Ollama → Save Daily Memory
```
- **Night Summary Prompt**: costruisce un prompt che chiede a Gaia di riassumere la giornata in
  max 40 parole, usando `brain.diary` (ultimi 100 eventi `{mood, source}`).
- **Save Daily Memory**: salva il riassunto in `brain.memories` (max 365 — un anno di sintesi
  giornaliere), distinto da `brain.thoughts` (pensieri istantanei nel payload WS come
  `lastMemory`).

## Evoluzione linguistica — fix applicati 2026-07-04

Due gap reali trovati e corretti:

1. **`brain.memories` (riassunti notturni) ora inietta nel prompt dei pensieri spontanei** —
   prima veniva salvato da "Save Daily Memory" ma nessun altro nodo lo rileggeva. `Build Prompt
   (Contestuale)` ora aggiunge un digest degli ultimi 3 riassunti (`recentMemories`) al prompt,
   accanto al recall puntuale da Qdrant — da' continuità narrativa oltre il singolo evento
   contingente.
2. **Il decadimento del mood era applicato per EVENTO, non per tempo trascorso** — causa root
   per cui `brain.mood` (stress/calm/social/curiosity) era sempre bloccato a ~0 nel payload
   `soul`: `GAIA Brain` sottraeva `0.002` ad ogni singolo evento normalizzato (frame
   vision/mediapipe, anche molte volte al secondo), quindi qualsiasi bonus (es. +0.1 per
   "presenza entrata") veniva eroso in pochi secondi reali. Corretto: il decadimento ora scala
   con `now - brain._lastMoodDecayTs` (secondi reali trascorsi), indipendente dalla frequenza
   di eventi in ingresso. **Non ancora verificato in modo osservabile dal vivo** (serve una
   transizione presenza vera — ingresso/uscita — per vedere il bonus reggere oltre pochi
   secondi; al momento del deploy tutte le persone note erano già presenti, nessuna
   transizione fresca disponibile per il test).

Entrambi i fix condividono lo stesso principio: `brain.mood.state` era già letto sia da
`Build Prompt (Contestuale)` che da `Prepara prompt chat` (Chat tab) — il tono dei pensieri
*avrebbe già dovuto* cambiare con l'umore accumulato, semplicemente l'umore non accumulava mai
nulla di osservabile per via del bug di decadimento.

## File/nodi coinvolti (Node-RED, tab "Gaia Engine")

`GAIA Brain` (433 righe — il function più grande del sistema, aggiorna tutto `gaiaBrain` da
ogni evento in ingresso), `ThreeViewEngineGAME` (costruisce il payload WS dashboard/arte visiva),
`Cognitive Trigger`, `Prepara Query LTM`, `Inietta Memoria`, `Build Prompt (Contestuale)`,
`Extract Thought & Push TTS`, `QdrantStore`. Tab "Inject": `Night Reflection`, `Night Summary
Prompt`, `Save Daily Memory`, `Load Brain at StartUp`/`Parse Brain` (persistenza `gaiaBrain` su
file, per sopravvivere ai riavvii Node-RED).

**Nota:** `Load Brain at StartUp` → `Parse Brain` ha `wires: [[]]` (non collegato in output) —
verificare se il caricamento del brain salvato su file funziona ancora prima di affidarcisi.
