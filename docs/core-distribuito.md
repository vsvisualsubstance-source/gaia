# GAIA distribuito — più macchine "core", un solo sistema

Progettato 2026-07-06 (richiesta: moduli distribuibili su più macchine per alleggerire i
processi, media player, e predisposizione per una seconda macchina core). Estende la
decisione Core/OPS del 2026-07-04 (memory `project-architettura-core-ops`) da "due ruoli
sulla stessa macchina" a **N macchine con ruoli dichiarati**.

## Principio: l'agent è UNO, il manifest è per-macchina

Il pattern esiste già ed è collaudato su due implementazioni:
- `pi/agent/agent.py` — gestisce servizi **systemd** (SERVICE_MAP nome→unit), device
  registry, OTA, comandi MQTT `gaia/device/{id}/command`.
- `minipc/local_agent.py` — stessa interfaccia MQTT, ma gestisce **subprocess**.

**Non si costruisce un terzo agent**: una nuova macchina core usa l'architettura del Pi
agent (systemd, più robusta dei subprocess) con un `SERVICE_MAP` caricato da manifest
esterno invece che hardcoded. Pi Manager in admin.html la vede automaticamente — parla già
il protocollo `gaia/device/+/status`, zero lavoro UI.

```
/etc/gaia/services.json      ← manifest della macchina: cosa PUÒ girare qui
{
  "machine_role": "media",           // core | ops | media | pi | custom
  "services": {
    "mediaplayer": { "unit": "gaia-mediaplayer", "dir": "/opt/gaia/mediaplayer" },
    "icecast":     { "unit": "icecast2",         "dir": "/etc/icecast2" }
  }
}
```
L'agent legge il manifest al boot: `SERVICE_MAP`/`SERVICE_DIRS` diventano dinamici.
`device.json` (stato enabled/disabled) resta identico. Tutto il resto — announce,
heartbeat, enable/disable/restart/set_config/ota_update — è già scritto e testato.

## Matrice dei ruoli (chi può ospitare cosa)

| Servizio | Core | OPS/Touch | Media | Pi | Vincolo di località |
|---|---|---|---|---|---|
| Node-RED + brain | ✅ unico | — | — | — | è IL cervello, uno solo |
| mosquitto (docker) | ✅ unico | — | — | — | broker unico, tutti puntano qui |
| Ollama, Qdrant (docker) | ✅ | — | — | — | RAM/CPU |
| OpenHAB (docker) | ✅ | — | — | — | — |
| gaia_admin.py (:8765) | ✅ | — | — | — | accede a voice_db/faces del suo host* |
| gaia-listener (voce) | — | ✅ | — | voice | **mic fisico** |
| gaia-camera / yolo / mediapipe / face | — | ✅ | — | ✅ | **camera fisica**; shared-memory = stessi host |
| beacon / provisioning | ✅ | — | — | ✅ | — |
| **mediaplayer** (nuovo) | — | opz. | ✅ | opz. | **audio out fisico** |
| **icecast server** (nuovo) | opz. | — | ✅ | — | banda, sempre acceso |
| **source stream** (darkice/liquidsoap) | — | — | ✅ | ✅ | vicino alla sorgente audio |
| **AV Herbarium** (Carla/synth) | — | — | opz. | ✅ | **sensori piante + audio out** |

\* nota: gaia_admin oggi assume tutto locale (voice_db, faces, systemctl dei servizi voce)
— quando voce/volti migrano su OPS, gli endpoint enrollment vanno proxati via MQTT come
già fa per i Pi (pattern `gaia/admin/...` esistente).

**Regola d'oro dei vincoli**: un servizio è legato alla macchina che ha l'hardware che gli
serve (mic, camera, audio out, sensori GPIO). Tutto ciò che è solo-software può migrare.
La camera shared-memory (`gaia_cam_header/frame`) NON attraversa la rete: camera+yolo+
mediapipe+face vivono sempre sulla stessa macchina.

## Cosa serve quando le macchine diventano ≥2 (checklist migrazione)

1. **MQTT_HOST**: oggi quasi tutto usa `localhost` (miniPC=broker). Ogni servizio spostato
   deve puntare all'IP del Core — già parametrico ovunque (`MQTT_HOST` env/conf).
2. **Discovery**: `gaia_beacon` già annuncia il Core in LAN; il provisioning Pi lo usa —
   le nuove macchine core possono usare lo stesso beacon per trovare il broker.
3. **Node-RED httpStatic** (`/media/core/D/gaia-web`): resta sul Core; le pagine usano
   `location.hostname` → funzionano da qualsiasi client.
4. **gaia-web API :8765**: le pagine puntano a `location.hostname:8765` — se admin resta
   sul Core e la voce va su OPS, vale la nota * sopra.
5. **OTA**: già multi-macchina (URL serviti da Node-RED `GET /gaia/ota/...`).
6. **Sudoers + install**: `pi/agent/install.sh` è il template; per una macchina core
   nuova si crea `core-agent/install.sh` che installa agent+manifest e SOLO i servizi
   elencati nel manifest.

## Percorso di adozione (quando arriva la seconda macchina)

1. Fase 0 (fattibile subito, nessun hardware nuovo): estrarre da `pi/agent` la lettura
   dinamica di SERVICE_MAP da `/etc/gaia/services.json` (retrocompatibile: se il file
   manca, usa la mappa hardcoded attuale). Testabile sul miniPC stesso.
2. Fase 1: sulla macchina nuova — install agent + manifest col ruolo scelto (es. `media`:
   mediaplayer+icecast). Appare in Pi Manager, si gestisce da lì.
3. Fase 2: migrazione OPS vera (visione+voce sul monitor touch) secondo
   `project-architettura-core-ops`.

## Media player (il servizio che sblocca il ruolo "media")

Candidato: **mpv in modalità IPC** (`--input-ipc-server=/tmp/mpv.sock`) pilotato da un
piccolo wrapper Python MQTT (`gaia/media/{room}/command`: play/pause/volume/url) — così
Node-RED comanda musica/annunci per stanza come già fa con TTS. Sorgenti: file locali su
D, stream icecast (vedi `docs/pi-moduli-futuri.md` per la parte streaming), radio web.
Alternativa più ricca: Music Assistant / Snapcast per multi-room sincronizzato — da
valutare quando c'è la macchina dedicata (Snapcast = perfetto per "stessa musica ovunque",
mpv+MQTT = perfetto per "ogni stanza indipendente"; si può partire da mpv e aggiungere
Snapcast dopo).
