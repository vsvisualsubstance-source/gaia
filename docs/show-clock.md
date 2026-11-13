# Orologio dello show

Un solo orologio per tutto lo show: luci (TD DMX), video (PatchDeck,
Resolume), laser, audio, Plancia. Le macchine possono essere tutte diverse
(Win, Mac, Pi): ognuna segue l'orologio via MQTT sul broker di OPS.

## Chi comanda

| prio | chi | dove | quando |
|---|---|---|---|
| 2 | motore audio `gaia-audio --clock ID` | OPS (o touring) | se il servizio audio gira con `--clock` |
| 1 | TD DMX con `Clockrole = master` | dove gira la DMX Master | sempre: e' anche la **riserva** |
| - | tutti gli altri | follower | |

- Il motore audio conta il tempo col contatore ad alta precisione di
  Windows, corretto lentamente sul clock della scheda audio (campioni
  prodotti / tempo, finestra di 30 s, al massimo 500 ppm). Musica e show
  non si allontanano anche in ore di show. Senza scheda la correzione e' 1.
- TD DMX con `Clockrole = master`, quando riceve battiti vivi da un
  orologio con priorita' piu' alta, diventa **riserva**: la sua timeline
  (`show_logic`) segue l'orologio (`clock_follow`), Play e Time cambiati a
  mano in TD diventano comandi per il master. Se il master tace per 3,5 s
  la riserva riprende il comando dalla posizione che ha, senza salti.
- Il motore, quando parte, aspetta 2 s: se c'e' un master vivo (la
  riserva) riprende esattamente da lui; se trova il proprio stato rimasto
  nel broker (riavvio) riprende in corsa se e' piu' giovane di 2 minuti;
  altrimenti riparte fermo dalla posizione rimasta.
- "Vivo" = almeno due `seq` diversi dallo stesso master. Lo stato
  retained ridato dal broker alla connessione (forse vecchio di ore) da
  solo non guida niente.

## Contratto MQTT

Topic sotto `gaia/show/clock/`:

| topic | da -> a | contenuto |
|---|---|---|
| `state` | master -> tutti, retained, a ogni cambio e almeno 1/s | `v, master, prio, kind, seq, sent_ms, playing, pos, rate, length, loop, active, timeline, name, bpm, cue{index,count,label,scene,time,track}, cmd{seq,action,cue}` |
| `command` | chiunque -> master | `{"action": "play"/"pause"/"toggle"/"stop"/"seek"/"go"/"back"/"cue", "value", "from"}` |
| `ping` / `pong/<from>` | follower -> master -> follower | eco del ping, per la latenza |
| `timeline` | TD DMX -> master, retained, a ogni cambio e ogni 10 s | `v, from, timeline, name, bpm, length, loop, active, track, cues[{time,label,scene,fade}]` (traccia principale) |

`cmd` (solo dal motore) e' l'ultimo comando applicato: la riserva lo usa
per la parte locale di GO/BACK/cue (richiamo della scena con la sua
dissolvenza quando la timeline non e' Active).

## Follower

Ogni follower ancora lo stato al **suo** orologio monotono ed estrapola:
`pos + (adesso - ricevuto + latenza) * rate`. Nessuna sincronizzazione
dell'ora di Windows serve.

- **Volano.** Se il master tace, uno stato vivo continua a contare per 10
  minuti (TD `show_clock.py`, Plancia, follower del bridge). Lo show va
  avanti; il prossimo stato riallinea.
- **TD.** TD consegna i messaggi MQTT una volta per frame, quindi stati e
  pong arrivano fino a un frame in ritardo. Dalla latenza misurata col ping
  si toglie un frame, e la posizione usa la migliore previsione fra gli
  stati degli ultimi 10 s (un messaggio in ritardo puo' solo prevedere una
  posizione piu' piccola). La riserva corregge Time oltre 5 ms di scarto.
- **Plancia** (`src/30-show-engine.js`): accetta il TD DMX scelto o un
  master con `prio > 1`.
- **Bridge** (`video-timeline.js`: `clockReceive`, `clockAlive`,
  `clockUsable`): timeline audio, laser, video e movimento teste.

## Precisione misurata

Prova `clock_sim.py` (motore vero + `show_clock.py` e `clock_follow` veri
in un TD simulato a 30 fps, broker di OPS, topic di prova): riserva entro
3-7 ms dall'orologio, passaggio motore -> TD e TD -> motore senza salti,
GO/cue/pausa/seek da Plancia e da TD corretti.

## Avvio

In `ops/agent/services.local.json` (servizio audio) si aggiunge
`--clock ops-audio` (sulla touring `--clock touring-audio`). Broker di
default `127.0.0.1:11883` (`--clock-broker H:P`). `--clock-topic` cambia il
prefisso dei topic, solo per le prove.

## Prossimi passi

1. Flusso UDP a 50 Hz sulla LAN per chi vuole precisione al millisecondo.
2. Follower leggero per TD DMX su Pi.
3. MTC (timecode MIDI) via rtpMIDI verso Resolume.
4. Ableton Link per battito e tempo (TD, Resolume, motore).
