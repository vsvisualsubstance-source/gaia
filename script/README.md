# Script – Voice Pipeline GAIA

Script Python per il riconoscimento vocale e speaker identification.
Tutti girano nel venv `/home/core/core-node-0/venv`.

---

## Script attivi

### `gaia_listener.py` — Servizio principale

Pipeline vocale unificata: wake word → STT → speaker ID → MQTT.

**Avvio rapido:**
```bash
source ~/core-node-0/venv/bin/activate
python3 gaia_listener.py
```

**Come funziona:**
1. Apre il microfono Polycom USB (48kHz stereo → 16kHz mono)
2. In stato IDLE: accumula frame quando RMS > 300
3. Al silenzio (25 frame ≈ 0.75s): trascrive con whisper-tiny, cerca "gaia"
4. Wake word trovato → stato LISTENING, TTS dice "Dimmi"
5. Registra il comando fino al silenzio
6. Parallelo: whisper-small (testo) + resemblyzer (chi parla)
7. Pubblica su `casa/voce/comando`: `{"text": "...", "speaker": "Mauro", "confidence": 0.85}`

**Log utili:**
```
[ALIVE] vol=XXX frames_acc=Y state=idle   ← heartbeat ogni 3s
[TINY] 'gaia accendi la luce'              ← trascrizione wake
[STT] 'gaia accendi la luce' | wake=True  ← risultato gate
→ MQTT comando: [Mauro] 'accendi la luce' ← pubblicato
```

**Costanti chiave:**
```python
VOICE_THRESHOLD = 300    # RMS minimo per parlato
SILENCE_END     = 25     # frame silenzio → fine frase (~0.75s)
SPEAKER_THRESHOLD = 0.72 # soglia cosine similarity speaker
```

---

### `enroll_voice.py` — Enrollment speaker

Registra la voce di una persona nel database.

```bash
python3 enroll_voice.py Mauro
# Registra 3 campioni da 5s, calcola embedding medio
# Salva in voice_db.json
```

Eseguire enrollment con almeno 3 persone diverse per buona discriminazione.

---

### `audio_debug.py` — Diagnostica audio

Mostra RMS e VAD in tempo reale per calibrare le soglie.

```bash
python3 audio_debug.py
# Output: RMS=1842  floor=  87  VAD=SPEECH  ████████
```

Usare per:
- Verificare che il Polycom funzioni
- Misurare il rumore di fondo (`floor`) → impostare `VOICE_THRESHOLD` sopra quel valore
- Verificare che VAD risponda correttamente

---

### `gaia-listener.service` — Systemd unit

Installa il servizio per avvio automatico:

```bash
sudo cp gaia-listener.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now gaia-listener
sudo systemctl status gaia-listener
journalctl -u gaia-listener -f
```

---

### `voice_db.json` — Database speaker

Contiene gli embedding vocali degli utenti registrati.
Formato: `{"Nome": {"embedding": [...]}}`.
Aggiornato da `enroll_voice.py`. Non modificare manualmente.

---

### `mediapipe_service.py` — Servizio MediaPipe

Servizio separato per pose estimation e gesture recognition.
Pubblica su `gaia/mediapipe/pose`, `gaia/mediapipe/gesture`, `gaia/mediapipe/emotion`.

---

## Script obsoleti (non più in uso)

Sostituiti da `gaia_listener.py` e `enroll_voice.py`:

| File | Sostituito da |
|---|---|
| `wakeword_engine.py` | `gaia_listener.py` (usava openwakeword) |
| `identify_speaker.py` | `gaia_listener.py` |
| `identify_once.py` | `gaia_listener.py` |
| `voice_trigger.py` | `gaia_listener.py` |
| `voice_register.py` | `enroll_voice.py` |
| `enroll_speaker.py` | `enroll_voice.py` |
| `resemblyzer_test.py` | — (script di test) |
| `transcribe.py` | — (script di test) |

---

## Dipendenze venv

```bash
# Installazione
python3 -m venv ~/core-node-0/venv
source ~/core-node-0/venv/bin/activate
pip install faster-whisper resemblyzer pyaudio webrtcvad-wheels paho-mqtt scipy numpy
```

**Note:**
- `webrtcvad-wheels` invece di `webrtcvad` per compatibilità Python 3.14
- Il Polycom Communicator apre a 48kHz stereo (non 16kHz — errore se si imposta manualmente)
- resemblyzer.preprocess_wav vuole un path file, non BytesIO → salvare in `/tmp/` prima

## Hardware audio

- **Microfono**: Polycom Communicator USB (hw:1,0, idx=5 tipicamente)
- **Sample rate nativa**: 48000 Hz stereo
- **Rate interna GAIA**: 16000 Hz mono (downsample con `scipy.signal.resample_poly`)
- **TTS output**: Piper → `it_IT-paola-medium.onnx` → speaker audio out
