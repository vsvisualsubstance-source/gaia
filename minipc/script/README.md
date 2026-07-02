# minipc/script — Voice Pipeline & Admin GAIA (miniPC)

Script Python per la pipeline vocale del miniPC: wakeword, STT, speaker ID, enrollment, admin API.
Tutti girano nel venv `~/core-node-0/venv` (symlink → `/media/core/D/venv`).

> **Nota:** Questo è il codice vocale del **miniPC** (i5). Per i Raspberry Pi vedi `pi/voice/`.

---

## Script attivi

### `gaia_listener.py` — Servizio principale

Pipeline vocale: wakeword "Gaia" → STT → speaker ID → MQTT.

```bash
source ~/core-node-0/venv/bin/activate
python3 ~/core-node-0/minipc/script/gaia_listener.py
```

**Pipeline:**
1. Microfono Polycom USB (48kHz stereo → downsample 16kHz mono)
2. Gate energetico RMS > threshold
3. IDLE: accumula frame → whisper-tiny → cerca "gaia" nel testo
4. Wake word trovato → LISTENING, TTS dice "Dimmi"
5. Registra fino al silenzio
6. Parallelo: whisper-small (testo) + resemblyzer (speaker)
7. Pubblica su `gaia/voice/command/minipc`

**Topic MQTT:**
```
gaia/voice/command/minipc  ← pubblica: {text, speaker, confidence, ts}
gaia/voice/status/minipc   ← pubblica: stato (idle/listening/processing)
gaia/voice/tts/minipc      ← ascolta:  {text} da riprodurre con Piper
gaia/voice/stats/minipc    ← pubblica: vol, frames_acc
gaia/voice/admin/{stanza}  ← ascolta:  {cmd:"config"/"record_clip"} (da gaia_admin.py)
```

**Log utili:**
```
[ALIVE] vol=XXX acc=Y state=idle    ← heartbeat ogni 3s
[STT] 'gaia accendi la luce'        ← trascrizione
→ MQTT: [Mauro] 'accendi la luce'   ← pubblicato
```

---

### `gaia_admin.py` — HTTP Admin API (:8765)

Server HTTP per l'interfaccia web `admin.html`. Gestisce configurazione, enrollment, calibrazione, modelli AI.

```bash
source ~/core-node-0/venv/bin/activate
python3 ~/core-node-0/minipc/script/gaia_admin.py
# Oppure come servizio: systemctl start gaia-admin
```

**Endpoint principali:**
```
GET  /api/status                      ← stato live (RMS, config, speakers, faces, pi_stats)
POST /api/config                      ← salva soglie voice (voice_threshold, silence_frames, speaker_threshold)
POST /api/calibrate                   ← calibrazione automatica rumore di fondo (5s)
POST /api/enroll/voice                ← enrollment speaker da mic miniPC
POST /api/enroll/voice-upload         ← enrollment speaker da file audio (base64)
POST /api/enroll/face                 ← enrollment volto da frame YOLO
POST /api/enroll/face-upload          ← enrollment volto da immagine (base64)
POST /api/pi-voice/config             ← invia config al Pi via MQTT
POST /api/pi-voice/calibrate          ← avvia calibrazione mic Pi via MQTT
POST /api/pi-service/{room}/{action}  ← start/stop/restart gaia-voice via SSH+systemctl
POST /api/service/listener/{action}   ← start/stop/restart gaia-listener locale
GET  /api/gaia-wakeword/status        ← contatori campioni wakeword + modello
POST /api/gaia-wakeword/record-local  ← registra campione wakeword dal mic miniPC
POST /api/gaia-wakeword/record        ← registra campione wakeword dal mic Pi (via MQTT)
POST /api/gaia-wakeword/upload        ← carica campione wakeword da file (base64)
POST /api/gaia-wakeword/train         ← addestra gaia_verifier.pkl → distribuisce via OTA
GET  /api/doorbell/status             ← contatori campioni citofono + modello
POST /api/doorbell/record             ← registra campione citofono dal Pi (via MQTT)
POST /api/doorbell/upload             ← carica campione citofono da file (base64)
POST /api/doorbell/sample             ← riceve campione audio dal Pi (callback HTTP)
POST /api/doorbell/train              ← addestra doorbell_verifier.pkl → distribuisce via OTA
POST /api/speaker/{name}/delete       ← rimuove speaker dal DB
POST /api/face/{name}/delete          ← rimuove volto dal DB
GET  /api/microphones                 ← lista dispositivi ALSA
POST /api/admin/set-mic               ← imposta microfono attivo per registrazioni admin
```

---

### `train_doorbell_model.py` — Training modello citofono

Addestra un classificatore LogisticRegression su embedding AudioFeatures (openWakeWord) per rilevare il suono del citofono. Usato da `gaia_admin.py /api/doorbell/train`, ma può essere eseguito anche da CLI:

```bash
source ~/core-node-0/venv/bin/activate
python3 ~/core-node-0/minipc/script/train_doorbell_model.py
# Legge: gaia_wakeword_samples/doorbell/positive/*.wav
#         gaia_wakeword_samples/doorbell/negative/*.wav
# Scrive: gaia_wakeword_samples/doorbell_verifier.pkl
```

---

### `gaia_wakeword_samples/` — Campioni audio wakeword e citofono

Directory con i campioni audio WAV raccolti per training dei modelli:
```
gaia_wakeword_samples/
├── positive/        ← campioni "Gaia" (da mic miniPC o Pi)
├── negative/        ← campioni negativi (TV, parlato, silenzi)
└── doorbell/
    ├── positive/    ← suono citofono
    └── negative/    ← rumore ambientale ingresso
```
**Non in git** (dati audio — gitignored tranne la struttura directory).

---

### `enroll_voice.py` — Enrollment speaker (CLI)

Registra la voce di una persona nel database (alternativa a admin.html).

```bash
source ~/core-node-0/venv/bin/activate
python3 ~/core-node-0/minipc/script/enroll_voice.py Mauro
# Registra 3 campioni da 5s, calcola embedding medio
# Salva in minipc/script/voice_db.json (gitignored)
```

---

### `audio_debug.py` — Diagnostica audio

Mostra RMS e VAD in tempo reale per calibrare le soglie.

```bash
python3 ~/core-node-0/minipc/script/audio_debug.py
# Output: RMS=1842  floor=87  VAD=SPEECH  ████████
```

---

### `gaia-admin-sudoers.txt` — Sudoers per admin

Permette a `gaia_admin.py` di controllare `gaia-listener` via `systemctl` senza password:

```bash
# Installazione (una tantum, da root):
sudo install -m 440 ~/core-node-0/minipc/script/gaia-admin-sudoers.txt /etc/sudoers.d/gaia-admin
```

---

### `gaia-listener.service` — Systemd unit

```bash
sudo bash ~/core-node-0/minipc/apply-service-update.sh
# oppure manualmente:
sudo cp gaia-listener.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl restart gaia-listener
journalctl -u gaia-listener -f
```

---

## Differenza miniPC vs Pi

| | miniPC (`gaia_listener.py`) | Pi (`pi/voice/main.py`) |
|---|---|---|
| Wakeword | Whisper tiny → cerca "gaia" nel testo | openWakeWord (`alexa`) + `gaia_verifier.pkl` |
| Soglia Gaia | N/A | `GAIA_THRESHOLD=0.80` (alzata per evitare falsi positivi TV) |
| Guardia durata | N/A | Clip ≥10s scartati (rumore ambientale continuo) |
| VAD STT | No | `vad_filter=True` (faster-whisper, latenza ~0.2s su silenzio) |
| Speaker ID | Sì, via resemblyzer | No |
| STT | faster-whisper (small) | faster-whisper (base int8) |
| TTS | Piper via `minipc/say.sh` | Piper binary in `pi/voice/bin/` |
| MQTT out | `gaia/voice/command/minipc` | `gaia/voice/command/{stanza}` |
| MQTT in TTS | `gaia/voice/tts/minipc` | `gaia/voice/tts/{stanza}` |
| Config remota | N/A | `gaia/voice/admin/{stanza}` `{cmd:"config", ...}` |
| Campioni clip | `gaia/voice/record_clip/{stanza}` | Esegue registrazione + POST callback a miniPC |

---

## Dipendenze venv

```bash
python3 -m venv ~/core-node-0/venv
source ~/core-node-0/venv/bin/activate
pip install faster-whisper resemblyzer pyaudio webrtcvad-wheels \
            paho-mqtt scipy numpy soundfile openwakeword
```

**Note:**
- `webrtcvad-wheels` invece di `webrtcvad` per Python 3.12+
- Il Polycom apre a 48kHz stereo (non impostare 16kHz — errore)
- `resemblyzer.preprocess_wav` vuole un path file, non BytesIO
- `openwakeword` usato per `AudioFeatures` (embedding) e `train_verifier_model` per i modelli custom

---

## Hardware audio

| | Valore |
|---|---|
| Microfono | Polycom Communicator USB |
| Sample rate nativa | 48000 Hz stereo |
| Rate interna | 16000 Hz mono (resample_poly) |
| TTS | Piper → `it_IT-paola-medium.onnx` (`/media/core/D/piper-voices/`) |
