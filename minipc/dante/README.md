# GAIA Dante Monitor

Rileva se la rete audio Dante (Sennheiser TCCM + Solaro QR1-UC) è attiva,
osservando il traffico UDP del driver esterno dell'utente (non versionato
in questo repo — vive fuori, sul Solaro/PC di controllo). Non decodifica
nulla: conta solo "arriva qualcosa sì/no" su un elenco di porte note.

Storia/dettaglio dei canali (H/V Angle, Mic Level, Far End Audio, Camera
Preset, VISCA-over-IP) e delle decisioni prese (OSC abbandonato a favore di
UDP nativo) è in memoria di progetto, non qui — questo file copre solo
questo servizio.

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
| `DANTE_PORTS` | `4554,4555,4556,4557,4558` | porte UDP da ascoltare, virgola-separate |
| `DANTE_TIMEOUT_S` | `8` | secondi senza pacchetti prima di considerare Dante spenta |
| `STATUS_INTERVAL_S` | `3` | intervallo di pubblicazione MQTT |
| `MQTT_HOST` / `MQTT_PORT` | `192.168.1.142` / `1883` | broker |

Elenco porte volutamente ampio/configurabile: il driver esterno del Solaro
è ancora in sviluppo, le porte possono cambiare senza toccare il codice.

## File

| File | Descrizione |
|---|---|
| `dante_monitor.py` | Servizio principale |
| `config.py` | Config (env > `/etc/gaia/dante.conf` > default) |
| `gaia-dante.service` | Unit systemd |
