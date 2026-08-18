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

## Helper condiviso `gaiaOllama` (2026-08-18)

I 5 nodi che costruiscono un prompt per Ollama (`Build Prompt (Contestuale)`, `Night Dream
Prompt`, `Night Summary Prompt`, `Prepara prompt chat` nel tab Chat, `Nursery: prepara prompt
Ollama`) duplicavano identico lo stesso blocco: selezione backend sano OPS/Core (via
`global.get('ollamaHealth')`) + shape del payload (`model`, `stream: false`). Estratto in un
helper condiviso, registrato una volta al deploy da un nuovo nodo su tab "Inject" (`Init
gaiaOllama Helper` → `Registra gaiaOllama Helper`, stesso pattern *inject once* + `global.set`
già usato da `Load Brain at StartUp`/`Parse Brain`), letto ovunque con
`global.get('gaiaOllama')`:

```js
global.get('gaiaOllama').pickUrl()               // sceglie OPS o Core, come prima
global.get('gaiaOllama').buildRequest(prompt, opts)  // { model, prompt, stream:false, ...opts }
```

Refactor comportamentale-neutro (stesso identico output verificato con una simulazione offline
dei 3 scenari OPS-sano/stale/nessun-check prima del deploy) — pensato come primo passo verso un
"registro"/stile configurabile (poetico vs più asciutto/underground, IT/EN) per installazioni
diverse dalla casa: quel parametro andrà naturalmente in `buildRequest`/un metodo affine di
questo stesso helper, quando si deciderà il design.

**Nota:** `Load Brain at StartUp` → `Parse Brain` ha `wires: [[]]` (non collegato in output) —
verificare se il caricamento del brain salvato su file funziona ancora prima di affidarcisi.

## Evoluzione linguistica v2 — mood vivo + lessico personale (2026-07-16)

Il mood era rimasto SEMPRE 'neutra' dal fix del 04-07: diagnosi — non un bug ma
sorgenti povere. `curiosity` non aveva NESSUNA sorgente, `calm` poteva solo
scendere, e decadimento 0.002/s (bonus 0.1 = 50 secondi di vita) contro eventi
domestici sparsi = stato invisibile. Correzioni in GAIA Brain:

- decadimento 0.0008/s (un bonus vive ~2 min) + **isteresi** (entra a 0.12,
  esce sotto 0.06 — niente flicker);
- nuove sorgenti: sconosciuto che entra → curiosity +0.2; scena che CAMBIA
  (SceneNorm) → curiosity +0.1; quiete col tick (gente presente, nessun motion
  da 4+ min) → calm +0.004/tick; social enter portato a +0.15.

**Lessico personale** (la vera evoluzione): `Extract Thought` conteggia le
parole significative dei pensieri in `brain.lexicon` (rolling top-80, stopword
filtrate, persistito in brain.json); `Build Prompt (Contestuale)` inietta le
8 più consolidate (count≥3) come "parole che senti tue" + una riga di
**maturità dal livello RPG**: ≤3 semplice e concreta, 4-7 metafore domestiche,
8+ voce matura. Il tono cresce col vissuto della casa.

Effetto collaterale voluto: col mood finalmente vivo, l'inchiostro asemico v2
(welcome + schermino Pi) cambierà colore davvero — calm verde-acqua, stress
corallo, social ambra, curiosity viola.

Verifica live: da osservare nei prossimi giorni (mood ≠ neutra dopo transizioni
reali; `grep lexicon /home/core/gaia/brain.json` dopo qualche pensiero).

## Sogni (2026-07-23)

Terza uscita di Night Reflection (21:00), in parallelo al riassunto:
```
Save Daily Memory → Night Dream Prompt → Night Dream Ollama → Save Dream → {MQTT retained, dreams.json}
```
`Night Dream Prompt` ricicla il riassunto appena scritto in `brain.memories` + `mood.state` +
le 6 parole più consolidate del lessico, ma con un prompt diverso da quello diurno — non
"riassumi", ma "sogna: libera associazione, non-sequitur poetico" — e `temperature: 1.15`
(contro il default degli altri prompt) apposta per un output meno coerente/più immaginifico.
`Save Dream` salva in `brain.dreams` (max 30, in memoria) e persiste `dreams.json` — stesso
pattern write-only-non-riletto-al-boot di `memories.json` (limite noto, non nuovo, non risolto
qui).

Il sogno esce anche dalla cognizione pura: pubblica retained su MQTT `gaia/brain/dream`
(lo riceve `pi/screen`, che lo scrive in viola con tenuta lunghissima — 75-90s contro i 9-10s
normali, v. `docs/vocabolario-asemico.md` §Sogni) ed è esposto nel payload WS come
`lastDream`/`lastDreamWords`/`lastDreamTs` (welcome.html mostra un pannello dedicato sotto il
pensiero corrente). Due modi per farselo raccontare a voce (Echo + voce Gaia, stesso canale
di `/dillo`): `/sogno` su Telegram, o il bottone "raccontamelo" nella welcome
(`POST /gaia/dream/tell`, tab_media).

Verificato dal vivo con un trigger manuale dell'inject "Night Reflection"
(`POST /inject/5e12f921ba0407e8`): prompt generato → risposta Ollama → salvato in
`brain.dreams` + `dreams.json` → pubblicato retained su `gaia/brain/dream` → comparso nel
payload WS (`lastDream`) → `/gaia/dream/tell` risponde `{ok:true, text, mood}` — intera catena
confermata in un'unica sessione di test. Non ancora verificato: la resa visiva su
`pi/screen` (il Pi ha `gaia-kiosk`, non `gaia-screen`, come proprietario attuale del display —
v. gotcha in `docs/vocabolario-asemico.md`) e il comando `/sogno` da Telegram vero (il nodo
`telegram receiver` non è simulabile via MQTT/HTTP, stesso limite già noto per `/promemoria`).
