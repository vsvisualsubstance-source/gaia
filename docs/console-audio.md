# Console Audio — motore `gaia-audio` (Rust) + sezione in Plancia

Stato (2026-11-05): **fase 1 in prova su OPS**. Il motore suona (`gaia-audio
serve`), il bridge lo collega e la console lo usa quando c'e'; manca la
prova d'ascolto con l'operatore. Non va in produzione in un giorno di show.

### Fase 1: com'e' fatta (2026-11-05)

- `audio-engine/src/engine.rs`: due deck e mixer dentro la callback dell'uscita
  (clock = scheda). Stessa logica del motore simulato della pagina: CUE stile
  CDJ, hot cue (8), salto ai punti, SNAP, SYNC di tempo e fase, MASTER, nudge,
  fine traccia. Lettura con interpolazione cubica (ricampiona 44,1 -> 48 kHz e
  il tempo). Keylock: solo la scelta, l'algoritmo e' fase 2.
- `audio-engine/src/dsp.rs`: EQ a 3 bande (shelf 250 Hz, campana 1,2 kHz,
  shelf 3 kHz; +6 / -24 dB, tutto a sinistra = taglio), filtro unico (passa
  basso 20 kHz -> 200 Hz, passa alto 20 Hz -> 6 kHz), guadagni inseguiti in
  ~10 ms (niente click), fader al quadrato, crossfader a potenza costante,
  limitatore sul master (tetto -0,2 dB, rilascio 250 ms).
- `audio-engine/src/serve.rs`: WebSocket `127.0.0.1:8790` (tungstenite),
  caricamento tracce in un thread a parte (decodifica intera in RAM),
  `<id>.cues.json` scritto dal motore, stato `audio_state` ~15/s. Senza scheda
  (o se sparisce) clock interno e nuovo tentativo ogni 5 s; `--no-audio` per le
  prove, `--device NOME` per scegliere l'uscita.
- `plancia/audio-engine-link.js`: il bridge si collega al motore (riprova ogni
  3 s), inoltra `{type:'audio'}` e rimanda a tutte le pagine `audio_state` e
  `audio_error`.
- Pagina (`src/52-audio-console.js`): con stato fresco segue il motore e
  interpola la testina; senza stato per 2,5 s torna al simulato. L'etichetta
  della libreria dice SIMULAZIONE, MOTORE · <uscita> o MOTORE · NESSUNA USCITA.
- Agent: servizio `audio` in `ops/agent/services.json` (spento finche' non lo
  si accende).
- Prove: `cargo test` (deck, cue, sync, limitatore, comandi) e
  `plancia/test/audio-engine-live.js` (motore vero `--no-audio` + bridge +
  pagina: tracce vere, play, SYNC in fase, crossfader, CUE, hot cue salvati).
- Manca in fase 1: cuffia (cue) su una seconda uscita, piu' uscite insieme
  (Dante + scheda), stato su MQTT.

### Playlist e traccia AUDIO della timeline (2026-11-05)

- **Playlist** globali (come la collezione di Traktor, non del progetto): le
  salva il bridge in `audio-engine/cache/playlists.json` (`audio-lib.js`) e le
  rimanda a tutti i tablet (`audio_playlists`). Nella libreria: vista "Tutta la
  libreria / playlist", ＋ per aggiungere un brano, ▲ ▼ ✕, menu ⋯ (rinomina,
  duplica, svuota, elimina).
- **Traccia AUDIO** nella timeline dello show (`src/53-audio-timeline.js`,
  `layout.audioTimeline = {active, cues: [{time, label, fade, src: {kind:
  'track'|'playlist'|'stop', id}}]}`). La esegue il bridge (`audio-timeline.js`)
  seguendo `gaia/show/clock/state`, come laser e video:
  - una playlist diventa brani in fila con dissolvenza incrociata di `fade`
    secondi; una cue nuova interrompe la precedente con la sua dissolvenza;
    "stop" sfuma e ferma; i brani si alternano su A e B;
  - a ogni passo (100 ms) il bridge confronta cosa dovrebbe suonare con lo
    stato del motore e corregge (carica, riposiziona oltre 0,3 s, play/pausa,
    fader con rampe brevi, tempo naturale, crossfader al centro): salti nella
    timeline, show in pausa e motore riavviato si sistemano da soli; il brano
    dopo si carica fermo sull'altro deck 30 s prima;
  - LIVE / TIMELINE come per il laser: in TIMELINE il bridge comanda deck e mixer.
- Motore: `deck.load` con `pos`, `play`, `force`; `deck.play` e `deck.sync`
  con `value` esplicito; `mix.ramp` (fader verso un valore in N secondi, con
  pausa alla fine).
- Prove: `test/audio-timeline.test.js` (segmenti, dissolvenze, comandi),
  `test/audio-playlists.js`, `test/audio-timeline-live.js` (motore vero,
  orologio finto su un topic MQTT di prova).

### Autoplay (2026-11-11)

**▶ AUTO** nella barra della Libreria: la Console suona da sola, indipendente
dalla timeline. La esegue il bridge (`plancia/audio-auto.js`), quindi va avanti
anche a tablet chiusi.

- Sorgente: la vista scelta nella Libreria (una playlist o tutta la libreria).
  Ordine: "In ordine" (solo playlist, poi ricomincia) o "A caso" (niente
  ripetizioni finché non sono passati quasi tutti i brani). Dissolvenza: 0, 4,
  8, 12 o 20 s, mai oltre metà brano.
- Ha un suo orologio. La coda di brani cresce da sola (il prossimo entra quando
  alla fine dell'ultimo mancano 45 s) e ogni 100 ms il bridge usa
  `audioDesired`/`audioCommands` della timeline: deck A e B alternati, il
  prossimo caricato fermo, correzioni automatiche. Il primo brano parte pieno
  sul deck libero (se l'altro suona a mano non lo interrompe).
- ⏭ fa sfumare il brano in onda e entrare il prossimo; ■ sfuma e ferma
  (subito, se il motore è spento).
- Se la traccia AUDIO della timeline è accesa con l'orologio dello show vivo,
  comanda lei: l'autoplay aspetta con l'orologio fermo e poi riprende. Con
  l'autoplay attivo i controller MIDI non muovono fader e crossfader.
- Protocollo: pagina → bridge `{type:'audio_auto', action:'start', source,
  mode:'order'|'shuffle', fade}` | `'next'` | `'stop'`; bridge → pagine
  `{type:'audio_auto', state:{active, waiting, stopping, sourceName, mode,
  fade, error, now:{title, artist, deck, pos, len}, next}}`.
- Prove: `test/audio-auto.test.js` (coda, dissolvenze, avanti, a caso,
  precedenza della timeline), `test/audio-auto-ui.js` (pagina e bridge di prova,
  senza motore).

## Cosa serve

Una console stile Traktor/Serato per la libreria musicale di Gaia:

- **due deck** (A/B): forma d'onda, play/pausa, cue, hot cue, loop, tempo
  con keylock, BPM e sync;
- **mixer**: gain, EQ a 3 bande e filtro per canale, fader, crossfader,
  preascolto in cuffia (cue), master;
- **libreria e playlist**: ricerca, ordinamento (BPM, titolo, cartella),
  carica su A o B, preferiti (gia' in Node-RED);
- **timeline**: clip audio nella timeline dello show ("brano X parte a 2:10
  sul deck A, dissolvenza 8 s"), insieme a cue luci, video e laser;
- **uscite**: qualsiasi uscita disponibile — Dante (Dante Virtual
  Soundcard), scheda audio della macchina, NDI — anche piu' d'una insieme;
- uso **sia dal vivo** (operatore che mixa) **sia preparato** (timeline).

Il motore gira su OPS o sulla touring (non sul tablet): il mix continua con
i tablet chiusi e l'audio esce dall'impianto.

## Scelta: motore nativo in Rust

| Requisito | Web Audio (browser) | Rust nativo |
|---|---|---|
| Scheda audio / Dante via WASAPI | si' | si' (cpal) |
| Dante a bassa latenza, molti canali (ASIO) | no | si' (cpal + SDK ASIO) |
| Uscita NDI audio | no | si' (grafton-ndi, SDK NDI 6) |
| Ableton Link | no | si' (rusty_link) |
| MTC / LTC | no (MTC solo via Web MIDI) | si' |
| Keylock | AudioWorklet da scrivere | signalsmith-stretch |
| Senza schermo, come servizio dell'agent | fragile (autoplay, tab in background) | si' |

Costo: piu' lavoro iniziale e una toolchain (Rust + MSVC + LLVM) su OPS.
La touring non compila: riceve il binario gia' fatto.

Librerie previste: `cpal` (uscite), `symphonia` (mp3, poi flac/wav/aac),
`signalsmith-stretch` (keylock), `grafton-ndi` (NDI), `rusty_link` (Link,
GPLv2+: va bene per uso interno, da rivedere se il codice venisse
distribuito), `tokio-tungstenite` (WebSocket di controllo), `rumqttc` (stato
su MQTT).

## Architettura

```
 tablet (Plancia)  ──WS──►  bridge.js (Plancia, :8080)  ──WS 127.0.0.1:8790──►  gaia-audio (Rust)
   console audio              inoltra comandi/stato                              deck, mixer, uscite
   Impara MIDI                MIDI in → comandi audio                            analisi, clock
                                                                                   │
                         MQTT gaia/device/audio-ops/status  ◄──────────────────────┤ (Admin, agent)
                         gaia/show/clock/state  ───────────────────────────────────► (timeline)
                                                                                   │
                                                     WASAPI/ASIO (scheda, Dante) ◄─┤
                                                                       NDI audio ◄─┘
```

- **Il motore e' l'unica fonte di verita'**: le pagine mostrano lo stato
  che ricevono, non tengono un loro stato del mix (evita il ping-pong del
  layout condiviso, vedi plancia/REFACTOR.md).
- **Il bridge** fa da ponte come per MIDI e OSC: le pagine non parlano
  direttamente col motore (stesso indirizzo da hotspot, Tailscale, LAN).
- **I comandi MIDI** (Impara MIDI) li esegue il bridge, una volta sola,
  come gli altri.
- **L'agent** avvia e ferma il motore (servizio `audio` in services.json,
  `kill_tree`), come laser e video gateway.

## Motore

### Clock

Il clock di riferimento e' quello del **dispositivo d'uscita master**
(campioni contati dalla callback audio). I due deck vivono nella stessa
callback: sync e crossfade sono esatti al campione.

- Posizione deck = campioni del file (a velocita' 1), con `rate` corrente.
- Ogni stato inviato porta `t` = clock del motore (secondi) + posizione +
  rate: la pagina **interpola** la testina a 60 fps senza ricevere 60
  messaggi al secondo.
- Uscite secondarie su un altro dispositivo (es. NDI mentre il master e'
  Dante) hanno un clock diverso: ricampionamento adattivo per non derivare.
- Sync esterno (fase 3, dipende dalla nota OPS 38 a TD): Ableton Link
  (tempo/fase), MTC/LTC (posizione). La timeline segue
  `gaia/show/clock/state` come fa gia' quella video.

### Deck

`load(track)`, `play`, `pause`, `cue` (stile CDJ: tenuto = preascolto dal
punto di cue), `seek`, `tempo` (±8/16/50%), `keylock`, `sync` (tempo e fase
sull'altro deck o su Link), `hotcue set/go/clear` (8), `loop` (in/out,
1/4…32 battute), `nudge`.

### Mixer

Per canale: `gain`, `eq_low/mid/high` (kill a −∞), `filter` (−1 passa
basso … 0 neutro … +1 passa alto), `fader`, `cue` (in cuffia).
`xfader` con curva (morbida / taglio DJ), `master`, `cue_mix` (cuffia:
cue ↔ master), `cue_level`. Limitatore sul master.

### Uscite

Configurazione salvata dal motore (file JSON accanto al binario):

```json
{
  "master": [{"kind": "wasapi", "device": "Dante Virtual Soundcard", "channels": [1, 2]},
             {"kind": "ndi", "name": "GAIA Audio Master"}],
  "cue":    [{"kind": "wasapi", "device": "Altoparlanti (Realtek)", "channels": [1, 2]}]
}
```

**Come e' oggi (2026-11-06)**: tre uscite da riga di comando, ognuna
cercata per parte del nome (`gaia-audio list` mostra i nomi che vede):

| opzione | cosa esce | OPS |
|---|---|---|
| `--device` | master | `Main (Traktor Kontrol Z1` |
| `--cue-device` | cuffia | `Headphone (Traktor Kontrol Z1` |
| `--tap-device` | **luci**: copia del mix dopo fader e crossfader, *prima* del volume master | `CABLE Input (VB-Audio` |
| `--vban IP[,IP]` `--vban-name Gaia` | **rete**: lo stesso mix delle luci in UDP col protocollo VBAN (porta 6980) | `192.168.1.73` (PC Win di Controller e PatchDeck) |

Ogni opzione accetta piu' schede in ordine di preferenza, separate da `|`:
vale la prima collegata, mai la stessa del master per cuffia e luci. Sulla
touring: `--device "Main (Traktor Kontrol Z1|MOTU|predefinita"`, cioe' la Z1 se c'e',
altrimenti la MOTU M2, altrimenti l uscita predefinita di Windows (parola `predefinita` o `default` nell elenco; mai VB-Cable, che Windows a volte mette come predefinito). La M2 ha due uscite e la sua presa cuffie ripete il
master: con la sola M2 il preascolto separato non c'e' (🎧 grigio nella
console), serve una seconda uscita (Z1, altra scheda) per `--cue-device`.

**Uscita in rete, VBAN (2026-11-11).** Per Controller e PatchDeck, che girano su un altro PC, il motore
manda lo stesso mix delle luci col protocollo VBAN di VB-Audio (`audio-engine/src/vban.rs`): pacchetti UDP
da 256 campioni stereo a 16 bit, alla frequenza del motore (48 kHz con la Z1, circa 187 pacchetti al secondo),
flusso col nome scelto (`--vban-name`, default `Gaia`). Va anche senza scheda audio (clock interno). Piu'
indirizzi separati da virgola; un PC spento non ferma gli altri. Sul PC che riceve: **VBAN Receptor** (gratuito,
VB-Audio) con sorgente IP di OPS e nome `Gaia`, uscita su **CABLE Input** di VB-Cable; in TD un **Audio Device In**
su **CABLE Output** (lo possono leggere insieme Controller e PatchDeck). Latenza in LAN di qualche decina di ms.
Firewall del PC che riceve: UDP 6980 in ingresso. Nello stato del motore compare come uscita `vban`.
Si accende e si spegne al volo (comando `net.vban` con `value` true/false, pulsante **VBAN** nella Libreria
della Console, con il livello del segnale); vale in tutti i modi (LIVE, PLAYLIST, TIMELINE) e non dipende piu'
dalla scheda delle luci. **Thread audio in tempo reale** (12/11): cpal con la feature `realtime`, cioe' MMCSS
"Pro Audio" di Windows (priorita' 21 contro 15 di prima), senza permessi di amministratore; prima il thread
della scheda girava a priorita' normale e con la macchina carica poteva perdere qualche blocco (scatti dopo 40 min).
**In esercizio (13/11, nota OPS 61):** ricezione configurata sul PC .73, Controller e PatchDeck leggono CABLE Output.
La touring manda lo stesso flusso (`--vban 192.168.1.73 --vban-name Gaia`): in tournee e' .240 sulla LAN dello show
e la .73 prende il suo IP dalla riserva del DHCP della touring, quindi la stessa configurazione della .73 vale con
OPS e con la touring. A casa la .73 non e' raggiungibile dalla touring (rotta .64/27 sul cavo del laser).

**Sorgente luci della DMX Master (13/11).** Su OPS e sulla touring la DMX legge **CABLE Output** (copia luci del
motore), non piu' il Touch In 8001 dal Controller: in TCP costava ~50 ms a cook (DMX a 13 fps) e riportava a OPS il
suo stesso mix.

**Ingresso VBAN per le luci (13/11, nota OPS 62).** Quando l'audio master entra nel Controller (mixer del DJ sul
PC .73), il Controller lo manda al motore in **VBAN al contrario** e la copia per le luci (VB-Cable -> DMX Master)
la prende dalla rete invece che dalla Console: tutto il giro audio usa una sola tecnologia, niente Touch In.
- Motore: `--vban-in NOME[:porta]` (`audio-engine/src/vban_in.rs`; OPS e touring: `--vban-in Controller`, porta
  6980; `*` = qualsiasi nome). Accetta ogni formato PCM VBAN, frequenza e canali; ricampiona alla frequenza del
  motore tenendo ~40 ms di coda. Un mittente alla volta: il primo vivo tiene il posto, un altro con lo stesso nome
  e' ignorato e segnalato (`other`).
- Sorgente luci: pulsante **LUCI ← CONSOLE / RETE** nella Libreria (comando `lights.source` `net`/`console`;
  all'avvio Console, `--lights-net` per partire dalla rete). Con RETE scelta e rete muta da 0,5 s le luci tornano
  da sole sulla Console (bordo rosso): mai luci al buio per un cavo.
- Il VBAN in uscita resta il mix della Console.
- Stato del motore: `inputs[]` con `role: lights_in`, `from`, `stream`, `rate`, `level`, `lost`, `source`, `using`.
- Firewall del PC col motore: UDP 6980 in ingresso per `gaia-audio.exe` (un blocco del programma vince sul
  permesso: se Windows ha creato "gaia-audio, Blocca" va tolto).
- Su una DMX senza motore (PC Win, Mac, Pi) basta un ricevitore VBAN verso un cavo virtuale.

L'uscita luci serve a DMX Master sulla stessa macchina: la DMX legge un
ingresso audio, e la Z1 non ne ha. Con **VB-Audio Virtual Cable** il motore
suona su "CABLE Input" e la DMX ascolta "CABLE Output" (sorgente
`scheda_audio`, driver DirectSound). Il volume master non conta, quindi
abbassare la sala non cambia quanto reagiscono le luci. Il cavo ha un
orologio suo (spesso 48 kHz): il motore adatta frequenza e deriva con
interpolazione lineare, bene per l'analisi delle luci e non per l'ascolto.
La Console Audio mostra lo stato (LUCI ✓ / ✗). TouchDesigner legge le
schede all'avvio: dopo aver installato il cavo va riavviato.
L'alternativa senza cavo e' la sorgente `touch_audio` dal controller
della .73.

`kind`: `wasapi` | `asio` | `ndi`. Il motore elenca i dispositivi visti
(`outputs.list`) e la Plancia li offre in un menu: "qualsiasi uscita
disponibile". Se un dispositivo sparisce (Dante spento) il motore continua
sulle altre uscite e lo segnala nello stato.

### Libreria e analisi

- Cartella: `C:\gaia-docker-cfg\core-node-0\musica` (la stessa che Node-RED
  serve come `/media/core/D/musica`), letta direttamente dal disco.
- Analisi in background, una volta per traccia (chiave: percorso +
  dimensione + data): BPM, griglia dei battiti (offset del primo battito),
  forma d'onda a due risoluzioni (panoramica ~1000 punti, dettaglio ~150
  punti/s con 3 bande per i colori), durata, guadagno per normalizzare.
  Cache in `audio-engine/cache/`.
- Preferiti: restano in Node-RED (`/gaia/music/favorites`).
- **Punti della traccia** (come la collezione di Traktor): cue e 8 hot cue
  in `audio-engine/cache/<id>.cues.json` (`{cue, hot:[s|null ×8], updated}`),
  separati dall'analisi cosi' una rianalisi non li tocca. Oggi li scrive il
  bridge (`POST /api/audio/cues?id=`), il motore li leggera' dallo stesso
  file. Una traccia caricata riparte dal suo cue.

### Analisi, sync e regolazioni a mano (come Traktor)

**Versione 2 (2026-11-06): griglia sulla cassa e sync agganciato.**

- *Perche'*: la versione 1 metteva l'ancora della griglia sul picco dell'inviluppo di
  tutto lo spettro, che nella tech house e' spesso un hi-hat: su 514 brani su 639 la
  fase era fuori dalla cassa di oltre 50 ms (mediana circa 110 ms). Due brani sbagliati
  allo stesso modo restavano vicini tra loro, due sbagliati diversamente si sdoppiavano.
- *Analisi*: cassa ad alta risoluzione (passa-basso 120 Hz, 1 ms); inizio del colpo =
  meta' della salita dell'ampiezza (stesso punto per casse secche e morbide); retta pesata
  su tutti i colpi del brano con scarto dei colpi fuori posto; ancora con la mediana pesata
  (le note del basso nella stessa banda non la spostano); BPM intero solo se spiega i colpi
  come quello misurato; meta' brano contro meta' brano = tempo variabile; battito 1 dai
  cambi di sezione; `first_kick` = cue automatico sul primo battito 1 con la cassa.
  Nel JSON della griglia: `first_kick`, `residual_ms` (dispersione dei colpi), `variable`.
  Prove sintetiche: fase entro 2-4 ms (secondo la forma della cassa), deriva sotto 1,5 ms
  in tre minuti, hi-hat forti in levare ignorati. Libreria vera: 586/639 brani sulla cassa,
  235 con dispersione sotto 3 ms.
- *Sync*: aggancio continuo della fase per blocco (~10 ms): ritocco di velocita' fino allo
  0,4% (inudibile, ~4 ms recuperati al secondo); oltre 80 ms (salto del master) si
  riallinea subito; il nudge tenuto sospende l'aggancio e al rilascio lo scarto scelto a
  orecchio diventa il riferimento; vale anche a tempo meta'/doppio. Il range del fader si
  allarga da solo (8, 16, 50%) quando il BPM del master lo richiede, invece di tagliare.
  Stato: `phase_err` in ms per il deck in SYNC; la console lo mostra (SYNC · fase).

**Analisi** (fatta: `audio-engine/src/analysis.rs`, `library.rs`):
- per traccia: BPM, griglia (BPM costante + ancora sul primo battito),
  confidenza 0..1, forma d'onda (panoramica + 3 bande a 50 punti/s),
  livello RMS e di picco;
- su una traccia, su una o piu' cartelle, o su tutta la musica; in
  parallelo, ~0,2 s a traccia; si rianalizza solo cio' che e' cambiato;
- intervallo dei BPM come Traktor (default 88-175, `--range`): un brano
  trovato a 64 diventa 128;
- metodo: flusso spettrale con peso sulle basse, autocorrelazione con
  armoniche, poi BPM fine e fase "piegando" l'inviluppo sul periodo; BPM
  intero se ci si e' a meno di 0,03. Provato su click sintetici: BPM
  esatto, fase entro 1 ms.

**Sync** (fase 2 del motore):
- ogni deck ha un **tempo master**: l'altro deck, il clock interno o
  Ableton Link; un deck in sync segue il tempo del master (*tempo sync*) e
  si allinea alla sua fase usando le griglie (*beat sync*);
- regolare un deck non cambia mai l'altro (2026-11-07): il fader del tempo di un deck
  agganciato a un master lo toglie dal SYNC (il master resta com'e'); il nudge sul master
  non viene inseguito dal deck agganciato (al rilascio lo scarto nuovo resta);
- **fase fine** (`deck.trim`, ms, + = anticipa, fino a ±50): sposta subito il deck e il
  SYNC la mantiene; nella console i tasti ‹1 / 1› (1 ms, doppio tocco = 0), sull'LPD8 le
  manopole K7 (A) e K8 (B): centro 0, ai lati ±20 ms; la riga di stato mostra "fine";
- senza griglia (confidenza bassa) il sync e' solo di tempo e la pagina
  lo segnala.

**Regolazioni a mano**:
- deck: fader del tempo (±8/16/50%), nudge (spinta/freno finche' tenuto), fase fine,
  keylock; caricare una traccia parte sempre dall'inizio (0:00), il CUE salvato resta il
  punto del tasto CUE;
- griglia: BPM esatto, ×2 / ÷2, sposta ancora (ms), "il battito e' qui",
  tap; ogni correzione **blocca** la griglia: un'analisi nuova non la
  sovrascrive (`locked`). Da riga di comando:
  `gaia-audio grid FILE --bpm 126 | --move 12 | --double | --anchor 0.42 | --unlock`.

## Protocollo pagina ↔ bridge ↔ motore

JSON su WebSocket. La pagina manda `{"type":"audio", ...comando}` al
bridge, che lo inoltra al motore; il motore risponde con stato e eventi che
il bridge rimanda a tutte le pagine.

Comandi (esempi):

```json
{"cmd": "deck.load",  "deck": "A", "track": "BEAT 0225/brano.mp3"}
{"cmd": "deck.play",  "deck": "A"}
{"cmd": "deck.tempo", "deck": "B", "value": 0.025}
{"cmd": "deck.sync",  "deck": "B", "to": "A"}
{"cmd": "deck.hotcue","deck": "A", "n": 1, "op": "go"}
{"cmd": "mix.set",    "ch": "A", "eq_low": 0.0, "fader": 0.8}
{"cmd": "mix.set",    "xfader": -1.0}
{"cmd": "outputs.set","config": {...}}
{"cmd": "library.scan"}
{"cmd": "clip.schedule", "id": "c12", "deck": "A", "track": "…", "at_show": 130.0, "fade_in": 8}
```

Stato (dal motore, ~10 Hz; la testina si interpola):

```json
{"type": "audio_state", "t": 1234.567,
 "decks": {"A": {"track": "…", "pos": 61.20, "rate": 1.025, "playing": true,
                 "bpm": 124.0, "beat_phase": 0.31, "keylock": true, "loop": null}},
 "mix": {"A": {"gain": 1, "eq_low": 0, "eq_mid": 0, "eq_high": 0, "filter": 0, "fader": 0.8, "cue": false},
         "xfader": -1, "master": 0.9},
 "meters": {"A": [-12.1, -11.8], "B": [-60, -60], "master": [-9.5, -9.7]},
 "outputs": [{"kind": "wasapi", "device": "Dante…", "ok": true}]}
```

Eventi: `audio_track_analyzed` (forma d'onda, BPM, griglia),
`audio_library` (elenco), `audio_error`. La forma d'onda viaggia una volta
per traccia, non nello stato.

MQTT (per Admin e agent, non per la console): `gaia/device/audio-ops/status`
retained con servizi, uscite e deck in onda.

## Plancia: sezione Console Audio

Pagina operativa nuova (template "Console Audio"):

```
┌─────────────── forme d'onda A e B, allineate sulla griglia ───────────────┐
├── DECK A ──────────┬──────── MIXER ────────┬────────── DECK B ────────────┤
│ titolo, BPM, tempo │ gain  EQ  filtro  cue │ titolo, BPM, tempo           │
│ play cue sync      │ fader A     fader B   │ play cue sync                │
│ hot cue 1-8, loop  │ ───── crossfader ──── │ hot cue 1-8, loop            │
├────────────────────┴───────────────────────┴──────────────────────────────┤
│ LIBRERIA: cerca, cartelle, BPM, preferiti — trascina su A/B o in timeline │
└───────────────────────────────────────────────────────────────────────────┘
```

- Widget del registro (`registerWidget`) per deck, mixer, forma d'onda,
  libreria: si possono anche mettere in altre pagine.
- Ogni controllo ha "Impara MIDI" (APC40 o altro controller) come i fader.
- Timeline: traccia **Audio** con clip (brano, deck, inizio, dissolvenze),
  stesso orologio delle cue.
- Senza motore la pagina usa un **motore simulato** (come
  `73-gaia-simulation.js`): si sviluppa e si prova la UI anche senza Rust.

## Fasi

1. **Protocollo + prototipo**: motore con 2 deck, EQ, filtro, crossfader,
   uscita WASAPI (scheda e Dante Virtual Soundcard); console in Plancia con
   motore simulato e poi vero; libreria dalla cartella.
   Fatto quando: si mixano due brani dalla Plancia e l'audio esce da Dante.
2. **DJ vero**: forme d'onda, BPM e griglia, sync, keylock, hot cue, loop,
   cuffia su seconda uscita, NDI.
3. **Show**: clip in timeline, Link / MTC / LTC (risposta TD alla nota 38),
   ASIO, mappature MIDI pronte per APC40.

## Da decidere / rischi

- **SDK**: NDI 6 SDK (licenza NDI, scaricato a mano dal sito NDI) e SDK
  ASIO Steinberg (licenza Steinberg): installati a mano su OPS, mai nel repo.
- **Keylock**: CPU su Ryzen 8745H da misurare con due deck + analisi.
- **Dante**: con DVS in WASAPI la latenza e' alta ma per la musica va bene;
  ASIO solo se serve il cue in cuffia via Dante.
- **Build**: compilato su OPS (macchina di sviluppo), binario copiato sulla
  touring con l'aggiornamento; il binario non va nel repo.
- **Audio-reattivita' delle luci**: DMX Master analizza il suo ingresso
  audio; il master del motore va mandato anche li' (Dante o cavo).
