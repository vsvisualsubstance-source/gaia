# GAIA Dante Monitor

Rileva se la rete audio Dante (Sennheiser TCCM + Solaro QR1-UC) è attiva,
osservando il traffico UDP del driver esterno dell'utente (non versionato
in questo repo — vive fuori, sul Solaro/PC di controllo).

Storia/dettaglio dei canali (H/V Angle, Mic Level, Far End Audio, Camera
Preset, Heartbeat, VISCA-over-IP) e delle decisioni prese (OSC abbandonato
a favore di UDP nativo) è in memoria di progetto, non qui — questo file
copre solo questo servizio.

## Due pubblicazioni MQTT distinte

1. **`gaia/dante/status`** (invariato) — blob generico, "arriva qualcosa
   sì/no" su un elenco di porte note, nessuna decodifica. Usato da
   mediaplayer/musica.html per decidere se instradare l'audio su Dante.
2. **`gaia/device/{SOLARO_DEVICE_ID}/status`** (nuovo, 2026-09-02) — device
   vero nel registro standard (`role:"device"`, `family:"solaro"`), stesso
   schema di madmapper/dmx/patchdeck: compare in Pi Manager/admin.html come
   qualunque altro device. Qui SI decodifica (ogni canale è un intero ASCII
   puro, vedi memoria `project-solaro-dsp`):
   ```json
   {
     "device_id": "solaro-qr1", "name": "Solaro QR1-UC",
     "role": "device", "family": "solaro", "stanza": "",
     "last_heartbeat_age_s": 0.4, "alive": true,
     "channels": {"h_angle": 166, "mic_level_db": -8},
     "capabilities": {"ptz_visca_recall": true},
     "ts": 1788365792755
   }
   ```
   `channels` contiene solo i canali freschi (< `DANTE_TIMEOUT_S`), mai un
   valore stantio spacciato per attuale. Nessun comando inviato al Solaro
   da questo modulo — solo ascolto; i controlli reali vanno derivati dalla
   UI di controllo del Solaro stesso quando si costruiscono (stessa regola
   già seguita per MadMapper/PatchDeck).

## Perché serve

`pi/mediaplayer` può instradare l'audio verso l'uscita Dante del Solaro
invece delle casse locali (vedi `MPV_AUDIO_DEVICE_DANTE` in
`mediaplayer.conf`) — ma instradarlo su una rete Dante spenta non ha senso.
Questo servizio pubblica lo stato su MQTT così chi consuma (Admin, la card
musica) sa se ha senso proporre/abilitare quell'opzione.

## MQTT

Topic: `gaia/dante/status` (retained), pubblicato ogni `STATUS_INTERVAL_S`
secondi (default 3s), **sempre** anche quando inattivo — stesso pattern di
mediapipe/mediaplayer, chi legge non deve gestire un proprio timeout.

```json
{
  "active": true,
  "last_seen_ts": 1785400000000,
  "ports_seen": [4554, 4556, 4557],
  "ts": 1785400001200
}
```

`active` = true se è arrivato almeno un pacchetto su una qualsiasi delle
porte monitorate negli ultimi `DANTE_TIMEOUT_S` secondi (default 8s — i
canali osservati durante i test pubblicavano a ~10Hz, ma H/V Angle può
restare fermo per secondi se nessuno si muove; il margine evita falsi
"spento").

## Config (`/etc/gaia/dante.conf`)

| Variabile | Default | Note |
|---|---|---|
| `DANTE_PORTS` | `4554,4555,4556,4557,4558,4559` | porte UDP da ascoltare, virgola-separate |
| `DANTE_TIMEOUT_S` | `8` | secondi senza pacchetti prima di considerare Dante spenta |
| `STATUS_INTERVAL_S` | `3` | intervallo di pubblicazione MQTT |
| `MQTT_HOST` / `MQTT_PORT` | `192.168.1.142` / `1883` | broker |
| `SOLARO_DEVICE_ID` | `solaro-qr1` | device_id pubblicato su `gaia/device/{id}/status` |
| `SOLARO_STANZA` | `` (vuoto) | stanza del Solaro -- non indovinata, da impostare quando nota |
| `SOLARO_HEARTBEAT_PORT` | `4559` | porta heartbeat DSP, liveness separata dai canali telemetria |

Elenco porte volutamente ampio/configurabile: il driver esterno del Solaro
è ancora in sviluppo, le porte possono cambiare senza toccare il codice.

## File

| File | Descrizione |
|---|---|
| `dante_monitor.py` | Servizio principale |
| `config.py` | Config (env > `/etc/gaia/dante.conf` > default) |
| `gaia-dante.service` | Unit systemd |
