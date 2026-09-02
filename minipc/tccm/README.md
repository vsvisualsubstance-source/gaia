# GAIA TCC M Agent

Bridge verso il Sennheiser TeamConnect Ceiling Medium (microfono a
soffitto con beamforming) — parla l'API nativa **SSCv2** del device
(HTTPS + subscription SSE, Basic Auth) invece del canale UDP grezzo usato
per il Solaro (vedi `minipc/dante/`): qui il microfono espone i dati
direttamente (beam azimuth/elevation, room activity, mute), non serve
dedurli da un driver esterno.

Adattato 2026-09-02 da un template scaricato dall'utente. Prima di
adattarlo, i path delle risorse e il formato dei messaggi SSE sono stati
verificati contro:
- la spec ufficiale Sennheiser SSCv2 2.3 (`docs.cloud.sennheiser.com`)
- un binding Go generato da OpenAPI per il TCC M
  (`github.com/chetan-prime/sennheiser-tcc-m-api`)

**Bug reale trovato e corretto nel template**: il parsing degli eventi
SSE `message` assumeva un payload `{"path":..., "value":...}`, ma la
spec dice che il payload è `{"<path della risorsa>": <valore>}` — il
path è la CHIAVE, non un campo separato (un evento può contenere più
risorse aggiornate insieme). Vedi `process_sse_event()` in
`tccm_agent.py`.

## Architettura

```
TCC M (192.168.1.235:443)
  |  HTTPS / SSCv2 (subscription SSE)
  v
gaia-tccm (questo agent)
  |  MQTT
  v
Gaia
```

Nessun comando inviato al device oltre a leggere risorse via
subscription — niente PUT verso l'API in questo modulo. I controlli
reali (es. impostare il beam, il mute) restano da derivare quando
servono, stessa regola già seguita per Solaro/MadMapper: mai costruire
comandi contro un'API mai vista rispondere dal vivo.

## Due pubblicazioni MQTT

1. **Topic custom** `gaia/tccm/{beam,audio,room,room/activity,mute,status}`
   — schema del template originale, per consumatori diretti.
2. **`gaia/device/{TCCM_DEVICE_ID}/status`** (`role:"device"`,
   `family:"tccm"`) — stesso schema di madmapper/solaro/dmx, compare in
   Pi Manager/admin.html come qualunque altro device:
   ```json
   {
     "device_id": "tccm-ceiling", "name": "TCC M (Sennheiser)",
     "role": "device", "family": "tccm", "stanza": "",
     "online": true, "last_seen_age_s": 0.4,
     "beam": {"azimuth": 248, "elevation": 28, "beamFreezeActive": false, "ts": "..."},
     "room_active": true, "muted": false,
     "capabilities": {"beam_direction": true, "room_activity": true},
     "ts": 1788365792755
   }
   ```

## Risorse sottoscritte (confermate contro l'API reale)

| Path | Contenuto | Schema |
|---|---|---|
| `/api/audio/inputs/microphone/beam/direction` | direzione del beam | `{azimuth, elevation, beamFreezeActive}` |
| `/api/audio/inputs/microphone/level` | livello mic | `{peak}` (dB) |
| `/api/audio/roomInUse` | stanza in uso | `{active}` |
| `/api/audio/roomInUse/activityLevel` | livello attività | `{peak}` (dB) |
| `/api/audio/outputs/global/mute` | stato mute | `{enabled}` |

## Configurazione (`/etc/gaia/tccm.conf`)

Stesso schema env > file > default di `minipc/dante/config.py`. File
mai committato — **la password non deve mai finire in git**.

```
TCCM_HOST=192.168.1.235
TCCM_PORT=443
TCCM_USER=api
TCCM_PASSWORD=<password reale>
TCCM_VERIFY_TLS=false

MQTT_HOST=192.168.1.142
MQTT_PORT=1883
MQTT_BASE_TOPIC=gaia/tccm
TCCM_DEVICE_ID=tccm-ceiling
TCCM_STANZA=
```

| Variabile | Default | Note |
|---|---|---|
| `TCCM_HOST` / `TCCM_PORT` | `192.168.1.235` / `443` | indirizzo del TCC M |
| `TCCM_USER` | `api` | utente Basic Auth |
| `TCCM_PASSWORD` | — | **obbligatoria**, mai in git |
| `TCCM_VERIFY_TLS` | `false` | certificato self-signed tipico su device LAN |
| `MQTT_HOST` / `MQTT_PORT` | `192.168.1.142` / `1883` | broker |
| `MQTT_BASE_TOPIC` | `gaia/tccm` | prefisso topic custom |
| `TCCM_DEVICE_ID` | `tccm-ceiling` | device_id nel registro standard |
| `TCCM_STANZA` | `` (vuoto) | non indovinata, da impostare quando nota |
| `TCCM_RECONNECT_MIN` / `MAX` | `2` / `60` | backoff riconnessione SSE |
| `TCCM_STATUS_INTERVAL` | `5` | secondi tra publish di status |

## systemd

```bash
sudo cp minipc/tccm/gaia-tccm.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now gaia-tccm
sudo systemctl status gaia-tccm
journalctl -u gaia-tccm -f
```

## Non ancora fatto

- Non testato dal vivo contro il device reale (serve `TCCM_PASSWORD` e
  conferma che l'host `192.168.1.235` sia ancora quello giusto).
- `TCCM_STANZA` da impostare quando si sa in che stanza è il TCC M.
- Nessun comando inviato al device (solo lettura) — vedi sopra.
