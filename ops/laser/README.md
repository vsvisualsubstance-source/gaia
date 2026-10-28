# Laser gateway (LaserCube WiFi)

Unico mittente verso i LaserCube WiFi, collegati via **cavo LAN** in
modalita' *LAN Client* (LED verde). Gira su OPS (e sulla touring) come
servizio `laser` dell'agent e pubblica come device `laser-ops`.

```
TD DMX / TD PatchDeck / TD Yolo --GLF1 udp/7480--> laser_gateway --LaserOS UDP--> cubi
                                                       ^
                               Plancia <--MQTT--> gaia/device/laser-ops/{status,command}
```

Il LaserCube WiFi non ha le modalita' Ether Dream/Art-Net dei modelli
Ultra MK2/Pro e TouchDesigner non lo supporta direttamente: si usa il
protocollo UDP LaserOS ufficiale (Wicked Lasers, *UDP DAC Streaming
Protocol Specification* v1.1, firmware 2.2). In quella modalita' il cubo
**non applica la sua Safety Zone**: la sicurezza la fa il gateway.

## Modalita' per cubo
| mode | sorgente |
|---|---|
| `off` | niente, il cubo non si puo' armare |
| `test` | cerchio di prova interno al gateway |
| `dmx` | frame da TD DMX (show guidato dalla Plancia: timeline, palette, effetti; audio dal controller) |
| `patchdeck` | frame da TD PatchDeck (contorni dell'uscita video; audio dal controller) |
| `yolo` | frame da TD Yolo: **grafica proiettata su una superficie** guidata dalle posizioni, mai il fascio sulle persone |

## Sicurezza
- Si parte sempre **disarmati**; si arma un cubo alla volta, solo se
  risponde, ha una modalita' e non e' surriscaldato.
- `blackout` disarma tutti i cubi.
- Zona di sicurezza per cubo (`zone` = [x0, y0, x1, y1] in -1..1): i
  punti fuori sono riportati sul bordo e spenti.
- Intensita' = colore x `master` x `max_intensity` (default 0.5).
- Figura quasi ferma (raggio statico) attenuata al 15%.
- Sorgente zitta da piu' di 0,5 s: uscita spenta (il cubo resta armato e
  riparte quando i frame tornano).
- Broker MQTT perso da piu' di 5 s: tutti disarmati.
- `laser_guard.py`: processo separato che spegne i cubi se il gateway
  muore; serve perche' l'agent lo ferma con `terminate()`, che su Windows
  non lascia eseguire cleanup. **Mai `kill_tree` su questo servizio.**
- Restano obbligatori il beam block e la chiave/E-Stop del cubo.

## Comandi MQTT (`gaia/device/laser-ops/command`)
```json
{"action": "add_cube", "ip": "192.168.1.61", "name": "Laser SX"}
{"action": "set", "param": "c1_mode", "value": "dmx"}
{"action": "set", "param": "c1_zone", "value": [-1, 0, 1, 1]}
{"action": "arm", "cube": "c1"}
{"action": "disarm", "cube": "all"}
{"action": "blackout"}
{"action": "scan"}
```
Parametri per cubo (`c<N>_<chiave>`): `mode`, `name`, `ip`, `pps`,
`zone`, `scale`, `offset_x`, `offset_y`, `flip_x`, `flip_y`, `master`,
`max_intensity`. Esito dell'ultimo comando in `status.laser.last_result`
(con il `req` del comando, se c'era). La configurazione sta in
`cubes.json` accanto al gateway (fuori dal repo); lo stato armato non si
salva mai.

## TouchDesigner
`td/gaia_laser_out.py` va in un Text DAT: `send_sop()` / `send_chop()` /
`send_points()` a fine frame, ~30 fps, < 1000 punti. Formato GLF1 in
`laser_proto.py`.

## Test
```
cd ops/laser && C:\gaia\venv\Scripts\python.exe -m unittest -v test_laser
```
`cube_emulator.py` emula un cubo (anche a mano: `python cube_emulator.py 39456`
e poi `add_cube` con `"ip": "127.0.0.1", "port_base": 39456`). Su OPS le
porte UDP 44624-48712 sono riservate da Windows: per questo la porta dei
frame e' 7480 e l'emulatore locale usa porte 39xxx.
