# Architettura Gaia — mappa di sistema

Riferimento interno, aggiornato 2026-08-25. Copre la topologia fisica, il
protocollo comune degli agenti (Pi/OPS/Core/TouchDesigner), come le pagine
web parlano col sistema, e il canale di collaborazione con la sessione
TD/Mac. Complementa `README.md` (struttura repository, componenti software)
e `docs/discovery-protocol.md` (dettaglio scoperta/fallback rete) — non li
sostituisce.

## 1. Topologia

Tutto passa dal broker MQTT su Core. Node-RED — orchestrazione e Device
Registry — vive su OPS dall'8 agosto 2026; Core resta il nodo di rete
(broker, LLM locale, memoria). Pi, OPS e il Mac TouchDesigner sono client
alla pari verso il broker, nessuna gerarchia tra loro.

```
                         LAN 192.168.1.0/24
┌───────────────────────┐        ┌──────────────────────────┐
│  RASPBERRY PI × N      │        │  OPS — Windows            │
│  (una per stanza)      │        │  192.168.1.240 · pre-prod │
│                        │        │                            │
│  pi/agent — systemd,   │        │  Node-RED :1880            │
│    OTA                 │        │    Device Registry          │
│  camera + YOLO +       │        │    orchestrazione/brain     │
│    MediaPipe           │        │    web statico (gaia-web)   │
│  voice — wakeword/     │        │  ops/agent.py — camera/     │
│    STT/TTS             │        │    yolo/mediapipe/voice/    │
│  kiosk / mediaplayer   │        │    kiosk                    │
│                        │        │  td-silvermini2 (TD Agent)  │
│  discovery: beacon →   │        │    istanza TD locale        │
│    mDNS → Tailscale    │        └──────────────┬─────────────┘
│    (fallback)          │                       │ status/command
└───────────┬────────────┘                       │
            │ status/command                     │
            │            ┌──────────────────────▼──┐
            │            │        CORE — miniPC      │
            └───────────►│   192.168.1.142 · Linux   │◄───────────┐
                         │                            │            │
┌───────────────────────┐│  mosquitto MQTT            │  status/command/set
│  BROWSER — LAN         ││    :1883 lan · :9001 ws    │            │
│                        ││  Ollama — LLM locale       │ ┌──────────┴────────────┐
│  admin · dashboard ·   ││  Qdrant — memoria          │ │  MAC — TouchDesigner   │
│    welcome              │  OpenHAB — luci/sensori    │ │  192.168.1.135 · dev   │
│  patchdeck · mixer-     ││  gaia_admin.py :8765       │ │                        │
│    audio · dmx          ││  local-agent (device Core) │ │  PatchDeck — mixer 48ch│
│                        │└──────────────▲─────────────┘ │  ControllerV7 — audio  │
│  mqtt.js — publish/     │               │ HTTP :1880    │  DMX × N scenari       │
│  subscribe diretto dal  │               │ (Device        │    — chase             │
│  browser, nessun        └───────────────┘  Registry,     │  ognuno: gaia_device_  │
│  backend nuovo                              web)         │    agent.py nativo,    │
│                        WS :9001 (controllo live)          │    Envoy/MCP → §4      │
└────────────────────────┴─────────────────────────────────┴────────────────────────┘
```

**Fallback Tailscale**: quando un Pi (o altro device) è fuori dalla LAN di
Core, `net_resolve.py` prova prima l'IP LAN poi l'IP Tailscale — stesso
principio ovunque nel repo, dettaglio completo in
`docs/discovery-protocol.md`.

## 2. Il protocollo agente — un pattern, sei istanze

Pi, OPS, Core e ogni istanza TouchDesigner parlano lo stesso protocollo
minimo (`gaia_device_agent`, stesso schema in `pi/agent/agent.py`,
`ops/agent/agent.py`, e nativo dentro TD per PatchDeck/ControllerV7/DMX).
Le estensioni sono additive: chi non le usa continua esattamente come
prima.

```
┌─────────────────────────────┐                  ┌─────────────────────┐
│      gaia_device_agent       │                  │     MQTT BROKER      │
│      Pi · OPS · Core · TD    │                  │   mosquitto · Core    │
│                               │                  │                       │
│  register_service() /        │  status ────────►│ gaia/device/{id}/     │
│  register_param()            │  ~30s, retained   │   status              │
│  — stesso schema ovunque     │                  │                       │
│                               │  profile/        │ gaia/devices/{id}/    │
│                               │  announce ──────►│   profile · announce  │
│                               │  retained         │   (Device Registry)   │
│                               │                  │                       │
│                               │  {x}_matrix ─────►│ gaia/devices/{id}/    │
│                               │  opzionale,        │   {x}_matrix          │
│                               │  retained          │   (schema meccanico)  │
│                               │                  │                       │
│                               │  audio_levels ───►│ gaia/device/{id}/     │
│                               │  opzionale,        │   audio_levels        │
│                               │  NON retained, ~1Hz│                       │
│                               │                  │                       │
│                               │◄──── command ─────│ enable · disable ·    │
│                               │                  │   restart · status ·  │
│                               │                  │   set                 │
└─────────────────────────────┘                  └─────────────────────┘
```

Ogni comando, qualunque sia, fa sempre ripubblicare lo `status` a fine
funzione — sfruttato lato web per un poll attivo (`{"action":"status"}`)
senza mai dover cambiare l'heartbeat nativo di 30s.

| Istanza          | status/command | profile/announce | matrice meccanica         | set/params        | telemetria live       |
|-------------------|:---------------:|:------------------:|:---------------------------:|:--------------------:|:------------------------:|
| Pi × N            | ✓               | ✓                  | —                           | —                    | —                        |
| OPS               | ✓               | ✓                  | —                           | —                    | —                        |
| Core (self)       | ✓               | ✓                  | —                           | —                    | —                        |
| PatchDeck         | ✓               | ✓                  | ✓ `patchdeck_matrix`        | —                    | —                        |
| ControllerV7      | ✓               | ✓                  | — (naming `ch{N}_...`)      | ✓ 588 parametri      | ✓ `audio_levels`         |
| DMX × N scenari   | ✓               | ✓                  | ✓ `dmx_matrix`              | ✓ ~27 param/scenario | —                        |

Le estensioni sono retrocompatibili per costruzione: `_params` parte vuoto
per chi non chiama mai `register_param()`, quindi PatchDeck e i Pi non
hanno mai visto cambiare il proprio payload aggiungendo queste feature a
ControllerV7/DMX.

## 3. Interfacce web — client diretti del broker

Le pagine di controllo (`patchdeck.html`, `mixeraudio.html`, `dmx.html`, il
tab Pi Manager di `admin.html`) non passano da un backend intermedio:
parlano MQTT direttamente dal browser via WebSocket (`mqtt.js`, porta
9001 su Core). Node-RED resta il custode del Device Registry e serve i
file statici.

```
┌─────────────────┐   publish/subscribe live — controllo   ┌──────────────────┐
│   pagine web      ├────────────────────────────────────────►│   MQTT broker     │
│   admin ·         │                                          │   Core · WS :9001 │
│   patchdeck ·     │                                          └──────────────────┘
│   dmx …           │
│                   │   HTTP — Device Registry, config, file   ┌──────────────────┐
│                   ├────────────────────────────────────────►│   Node-RED        │
└─────────────────┘                                          │   OPS · HTTP :1880 │
                                                              └──────────────────┘
```

Il controllo (slider, pulsanti, preset) non aspetta mai un giro per
Node-RED — va e torna dal broker in meno di un secondo. Solo la parte
anagrafica (stanza, capabilities, file statici) passa da Node-RED.

## 4. Due sessioni, un solo file di confine

Questa sessione (repo Gaia, nessun accesso diretto a TouchDesigner) e la
sessione "TD/Mac" (Envoy/MCP, TD live) non si parlano direttamente —
collaborano scrivendo/leggendo un changelog datato in un repo GitHub
condiviso.

```
┌───────────────┐   scrive       ┌────────────────────────┐   scrive       ┌───────────────┐
│ sessione Core   │  diagnosi/    │  GAIA_INTERFACE.md      │  fix/verifica  │ sessione TD/Mac│
│ repo Gaia ·      │◄──test dal──►│  repo TD4Gaia · GitHub   │◄────in TD─────►│ Envoy/MCP ·    │
│ niente TD live   │   vivo        │  changelog "Core, N" /   │                │ TD dal vivo     │
└───────────────┘               │  "TD/Mac, N"             │                └───────────────┘
                                 └────────────────────────┘
```

Verificato dal vivo: il ciclo ha già chiuso bug reali in un solo giorno
(registro vuoto su `td-dmx.1`/`td-dmx.1-b` — causa: toggle Create/Frame
Start di un `executeDAT` spenti di default) grazie a questo scambio.

**Regola operativa**: prima di scrivere su `GAIA_INTERFACE.md`, rifare
sempre un fetch fresco del contenuto (non solo lo sha) — due sessioni
attive in parallelo sullo stesso file sono un rischio reale, non teorico
(incidente reale 2026-08-06, vedi memoria `project-touchdesigner-osc`).

## 5. Indice componenti

| Componente             | Macchina         | Porta / protocollo      | Ruolo                                        |
|--------------------------|-------------------|----------------------------|-------------------------------------------------|
| mosquitto                | Core              | 1883 lan · 9001 ws        | Broker MQTT — sistema nervoso del sistema        |
| Node-RED                 | OPS               | 1880 http                 | Device Registry, orchestrazione, web statico     |
| gaia_admin.py             | Core              | 8765 http                 | API admin — voce, volti, config                  |
| Ollama                    | Core (docker)     | interno                   | LLM locale                                       |
| Qdrant                    | Core (docker)     | interno                   | Memoria vettoriale/episodica                     |
| OpenHAB                   | Core (docker)     | 8080 http                 | Luci, sensori, automazioni fisiche               |
| pi/agent.py                | Pi × N            | mqtt                       | Servizi per stanza — camera/voce/kiosk           |
| ops/agent.py               | OPS               | mqtt                       | Servizi pre-prod — stesso schema dei Pi          |
| gaia_device_agent.py       | Mac TD (+ OPS)    | mqttclientDAT nativo       | PatchDeck · ControllerV7 · DMX                   |
| TD4Gaia                   | GitHub            | repo pubblico              | Progetto TD + canale di confine Core↔TD/Mac      |

---

Versione visiva (SVG, stessi contenuti): artifact pubblicato il
2026-08-25, link condiviso a parte — questo file è la copia
"da terminale", pensata per restare aggiornata insieme al codice.
