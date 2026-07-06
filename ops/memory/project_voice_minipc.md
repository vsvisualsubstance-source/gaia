---
name: project-voice-minipc
description: "Voce miniPC — GaiaWakeVerifier allenato, gap TTS risposte risolto, bug taglio-comando risolto, modello medium, causa CPU della lentezza trovata"
metadata: 
  node_type: memory
  type: project
  originSessionId: 139b6cd4-d727-4fcd-83d5-910eceaf6073
---

# Voce miniPC — GaiaWakeVerifier (2026-07-04)

**Why:** l'utente vuole il miniPC (in produzione: monitor touch con mic/camera integrati)
allenato per voce e volti **come il Pi**. Verificato che il Pi usa openWakeWord + un
classificatore custom (`gaia_verifier.pkl`, LogisticRegression su embedding `AudioFeatures`),
mentre il miniPC (`gaia_listener.py`) usava **solo** whisper-tiny + ricerca testuale di "gaia"
nella trascrizione — nessun modello, nessuna soglia allenabile, meno robusto in ambienti
rumorosi. La pipeline di training (`train_doorbell_model.py`, `AudioFeatures`+
`train_verifier_model`) già girava sul miniPC ma il modello risultante veniva **solo
distribuito via OTA al Pi**, mai caricato/usato localmente.

**How to apply:** aggiunta la classe `GaiaWakeVerifier` in `gaia_listener.py` — stesso
approccio del Pi ma **modello dedicato** (`gaia_wakeword_samples_minipc/gaia_verifier_minipc.pkl`,
mai condiviso col Pi: mic diversi, dataset misto avrebbe generalizzato peggio, deciso
esplicitamente dall'utente). Gira in **parallelo** al text-search whisper-tiny esistente,
non lo sostituisce: se il modello non è ancora allenato, `feed()` ritorna sempre 0.0, zero
regressione rispetto a prima. Quando il verifier rileva "Gaia" (finestra scorrevole 1.5s,
soglia default 0.80), si passa a `STATE_LISTENING` esattamente come fa il ramo esistente per
"Gaia" senza comando diretto nella stessa frase — **stesso comportamento del Pi**: niente
"comando diretto in un unico respiro" per i rilevamenti via verifier (il whisper-tiny path
resta invece capace di quello, come fallback in parallelo).

## Infrastruttura training (admin.html)

Due card separate ora in "Wakeword — Gaia":
- **(Pi)**: dataset/modello esistenti, invariati, distribuiti via OTA. Rimosso il pulsante
  "Registra dal miniPC" (spostato nell'altra card, vedi sotto — mescolare i mic peggiorava la
  qualità per entrambi).
- **(miniPC / monitor touch)**: nuova, dataset e modello dedicati
  (`gaia_wakeword_samples_minipc/`). Il pulsante "🔴 Registra dal miniPC" (che PRIMA scriveva nel
  dataset condiviso del Pi) ora scrive qui — stesso endpoint `/api/gaia-wakeword/record-local`,
  solo la directory di destinazione è cambiata. Training via `/api/gaia-wakeword-minipc/train`
  → nessuna OTA (il modello è già locale) → pubblica `gaia/admin/reload_gaia_verifier` →
  `gaia_listener.py` ricarica a caldo, nessun riavvio.

**Stato al 2026-07-04 (fine sessione)**: infrastruttura completa, **modello allenato e
attivo** — utente ha registrato 9 positivi/7 negativi e addestrato da admin.html, hot-reload
via MQTT confermato (`gaia_verify_active: True`). Con un dataset così piccolo la confidence
resta sotto soglia (~0.56 osservato, soglia 0.80) — serve continuare a registrare fino a
20-30 campioni per lato per un rilevamento affidabile. Slider soglia (`gvt`, card "Soglie
voce") e barra di confidenza live (pattern identico al Pi: `mp-gaia-conf`/`mp-gaia-bar`/
`mp-gaia-tick`) aggiunti in admin.html per coerenza UI — richiesto esplicitamente
dall'utente dopo aver notato l'asimmetria con la sezione Pi.

## Bug aggiuntivi trovati e risolti nella stessa sessione (dopo il primo deploy)

1. **Gap TTS risposte comandi vocali sul miniPC** — l'utente ha notato che le risposte
   finivano su MQTT ma non venivano mai lette ad alta voce. Causa: `gaia/voice/tts/minipc`
   (dove "Build TTS payload"/Node-RED pubblica le risposte) non aveva **nessun sottoscrittore**
   sul miniPC — `gaia_listener.py` lo usa solo per pubblicare "Dimmi", mai per ascoltare. Il Pi
   invece SI iscrive al proprio `gaia/voice/tts/{stanza}` e parla (`pi/voice/main.py`). Diverso
   dal sistema "pensieri spontanei" (`casa/tts/play` → Node-RED "VOCE" → Clean Text → exec
   Speak → `say.sh`), quello sì già funzionante. **Fix**: nuovo `mqtt in` su
   `gaia/voice/tts/minipc` (tab Voice) → estrae `.text` dal JSON → stessa catena "Clean
   Text"/"Speak" già esistente. La separazione dei topic per stanza/device è **intenzionale**
   (altrimenti ogni risposta verrebbe letta da tutti gli altoparlanti della casa) — il problema
   era solo che mancava il listener per il minipc specifico.
2. **`_record_until_silence` tagliava la registrazione del comando troppo presto** — contava
   il silenzio fin dal primissimo frame, anche prima che l'utente iniziasse a rispondere a
   "Dimmi". Una normale pausa di reazione bastava per un taglio a 1.5s di puro silenzio (clip
   vuota). Fix: aggiunta guardia `started` (silenzio conta solo dopo il primo frame sopra
   soglia) — stesso pattern già usato nel ramo IDLE. Aggiunto anche un log
   `[LISTENING] catturati N frame` per diagnosticare casi futuri simili.
3. **`voice_threshold` finito al minimo dello slider (50)** durante i test UI — probabile
   causa concomitante di scarso riconoscimento. Ripristinato a 275 via
   `gaia/admin/config`.
4. **Modello comando: "small" → "medium"** — gia' in cache locale (1.5GB, nessun download).
   Miglior accuratezza italiano confermata ("Come stai oggi?", "Disattiva luci." trascritti
   correttamente contro il precedente "spenghi ruci"/gibberish).
5. **`beam_size` 5→1** per il modello comando — 27s per una frase con beam_size=5 su
   "medium" erano inaccettabili; beam_size=1 (greedy) più veloce, non ha risolto da solo
   (vedi punto 6).
6. **Causa radice della lentezza (~27s): contesa CPU, non il modello** — load average 11.58 su
   4 core; `gaia-vision/main.py` (YOLO locale di test, gestito da `gaia-local-agent`) usava da
   solo 235% CPU, MediaPipe locale 75%. Fermando `gaia-local-agent` la latenza è scesa a
   ~8-9s. **Non risolto in modo permanente** — solo alleviato liberando CPU manualmente per il
   test. Vedi [[project-architettura-core-ops]] per la decisione presa a riguardo.
7. **Cache HuggingFace/pip spostata da `/home/core/.cache` a `/media/core/D/home-cache`**
   (symlink) — root partition era al 94% (2.6GB liberi), rischioso con modelli whisper piu'
   grandi. Liberati 5.4GB, ora all'81%. **Se si scaricano altri modelli in futuro, verificare
   che vadano a finire nella cache su D: (symlink), non ricreare i path originali su /.**

## Volti (seconda parte della richiesta utente)

Il riconoscimento facciale (`face_service.py`, InsightFace+FAISS) è **già condiviso** tra Pi e
miniPC — non è "Pi vs miniPC" per i volti, un solo servizio centrale sul miniPC riceve
snapshot da qualunque camera (Pi o locale) via `gaia/+/snapshot`. Non serve duplicare nulla
qui: la qualità dipende dal numero/qualità delle foto di enrollment (wizard welcome.html, 3
scatti), non dalla macchina. Nessuna azione presa in questa sessione su questo fronte.

## Roadmap

- Continuare a registrare campioni (target 20-30 per lato) finché la confidence supera
  stabilmente la soglia 0.80 senza intervento manuale.
- Vedi [[project-architettura-core-ops]] per la decisione su dove far girare cosa in produzione
  (voce+visione competono per CPU sullo stesso hardware).
- Considerare di aggiungere il rilevamento citofono (`doorbell_verifier.pkl`) anche al miniPC
  se mai servisse un citofono locale — stessa infrastruttura, non richiesto ora.
