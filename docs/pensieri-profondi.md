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

## Evoluzione linguistica — stato attuale e cosa manca

Oggi "evoluzione" è solo accumulo di stato (`thoughts`, `memories`, `diary`) e recall
semantico via Qdrant — non c'è ancora nessun meccanismo che cambi *come* Gaia parla nel tempo
(tono, personalità, vocabolario) in base alla storia accumulata. Se l'obiettivo è far evolvere
il linguaggio:
- **Candidato più semplice**: iniettare un digest di `brain.memories` (i riassunti notturni)
  nel prompt di `Build Prompt (Contestuale)`, non solo il recall puntuale da Qdrant — oggi il
  riassunto notturno viene salvato ma non riletto da nessun altro nodo.
- **Personalità/mood persistente**: `brain.mood` (stress/calm/social/curiosity, già esposto
  come `soul` nel payload WS) esiste ma non risulta letto da `Build Prompt` — collegarlo
  significherebbe che il tono dei pensieri cambia con lo stato d'animo accumulato, non solo
  con l'evento contingente.
- Prima di implementare, verificare lo stato di `brain.mood` e chi lo aggiorna (non ancora
  tracciato in questo documento — da investigare quando si lavora su questo blocco).

## File/nodi coinvolti (Node-RED, tab "Gaia Engine")

`GAIA Brain` (433 righe — il function più grande del sistema, aggiorna tutto `gaiaBrain` da
ogni evento in ingresso), `ThreeViewEngineGAME` (costruisce il payload WS dashboard/arte visiva),
`Cognitive Trigger`, `Prepara Query LTM`, `Inietta Memoria`, `Build Prompt (Contestuale)`,
`Extract Thought & Push TTS`, `QdrantStore`. Tab "Inject": `Night Reflection`, `Night Summary
Prompt`, `Save Daily Memory`, `Load Brain at StartUp`/`Parse Brain` (persistenza `gaiaBrain` su
file, per sopravvivere ai riavvii Node-RED).

**Nota:** `Load Brain at StartUp` → `Parse Brain` ha `wires: [[]]` (non collegato in output) —
verificare se il caricamento del brain salvato su file funziona ancora prima di affidarcisi.
