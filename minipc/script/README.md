# minipc/script — Voice Pipeline GAIA (miniPC)

Script Python per la pipeline vocale del miniPC: wakeword, STT, speaker ID, enrollment.
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
```

**Log utili:**
```
[ALIVE] vol=XXX acc=Y state=idle    ← heartbeat ogni 3s
[STT] 'gaia accendi la luce'        ← trascrizione
→ MQTT: [Mauro] 'accendi la luce'   ← pubblicato
```

---

### `enroll_voice.py` — Enrollment speaker

Registra la voce di una persona nel database.

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

### `gaia-listener.service` — Systemd unit

Path aggiornati con `minipc/apply-service-update.sh`. Per reinstallare manualmente:

```bash
sudo bash ~/core-node-0/minipc/apply-service-update.sh
# oppure manualmente:
sudo cp gaia-listener.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl restart gaia-listener
journalctl -u gaia-listener -f
```

---

### `voice_db.json` — Database speaker

Embedding vocali degli utenti. **Gitignored** (dati personali).
Aggiornato da `enroll_voice.py`. Non modificare manualmente.

---

## Differenza miniPC vs Pi

| | miniPC (`gaia_listener.py`) | Pi (`pi/voice/main.py`) |
|---|---|---|
| Wakeword | Whisper tiny → cerca "gaia" nel testo | openWakeWord (ML model "alexa") |
| Speaker ID | Sì, via resemblyzer | No |
| STT | faster-whisper | faster-whisper |
| TTS | Piper via `minipc/say.sh` | Piper binary in `pi/voice/bin/` |
| MQTT out | `gaia/voice/command/minipc` | `gaia/voice/command/{stanza}` |
| MQTT in TTS | `gaia/voice/tts/minipc` | `gaia/voice/tts/{stanza}` |

---

## Dipendenze venv

```bash
python3 -m venv ~/core-node-0/venv
source ~/core-node-0/venv/bin/activate
pip install faster-whisper resemblyzer pyaudio webrtcvad-wheels \
            paho-mqtt scipy numpy soundfile
```

**Note:**
- `webrtcvad-wheels` invece di `webrtcvad` per Python 3.12+
- Il Polycom apre a 48kHz stereo (non impostare 16kHz — errore)
- `resemblyzer.preprocess_wav` vuole un path file, non BytesIO

## Hardware audio

| | Valore |
|---|---|
| Microfono | Polycom Communicator USB |
| Sample rate nativa | 48000 Hz stereo |
| Rate interna | 16000 Hz mono (resample_poly) |
| TTS | Piper → `it_IT-paola-medium.onnx` (`/media/core/D/piper-voices/`) |
