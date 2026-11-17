# Regia video

> **17/11: in pausa.** Il video dello show resta sui motori nativi (PatchDeck/TouchDesigner, Resolume),
> comandati dalla Plancia (riga VIDEO). Un'uscita video da browser ha limiti da show (uscite legate
> alla finestra di controllo, niente HAP, nessuna sincronia garantita). Se servira' un motore nostro
> sara' un player nativo in Rust (wgpu, ffmpeg/HAP, NDI SDK, mapping). Regia resta nel repo come
> riferimento per l'interfaccia (scaletta, timeline, mapping) e il codice qui sotto funziona.

Regia è il mixer video nel browser fatto da Nicola: canali, bus A/B, effetti, scene, scaletta con GO, timeline, uscite mappate sui proiettori e registrazione.

- **Dove sta:** `plancia/regia/index.html`.
- **Chi la serve:** il bridge della Plancia.
- **Dove gira:** sulla macchina collegata ai proiettori, a schermo intero.
- **Che rapporto ha con la Plancia:** non fa parte del bundle della Plancia, che resta il pannello di comando.

## Aprirla

Si apre da `http://<macchina>:8080/regia/`, per esempio `http://192.168.1.240:8080/regia/` su OPS.

Aperta così ha la cartella video, l'orologio dello show e NDI. Aperta come file (`file://`) funziona come la versione originale, senza queste tre cose.

## Sorgenti

| Sorgente | Come arriva |
|---|---|
| Generatori, testo | nel browser, come prima |
| File dalla cartella video | il bridge li serve da `VIDEO_DIR`, di default `C:\gaia\media\video`, sottocartelle comprese |
| File scelti a mano | selettore del browser o trascinamento sul canale, come prima |
| Webcam, schede di acquisizione | `getUserMedia`, come prima |
| NDI | gateway NDI → WebRTC su OPS (`video-gateway/video_gateway.py`, porta 8788) con il profilo `program` (1280×720, banda NDI piena) |
| RTSP | da fare: stesso gateway, convertito in WebRTC come l'NDI |

### Cartella video

- **Endpoint del bridge:**
  - `GET /api/video/library` restituisce l'elenco dei file;
  - `GET /media/video/<percorso>` restituisce il file, anche a pezzi (Range), così il browser salta nel video senza scaricarlo tutto;
  - i percorsi fuori dalla cartella non passano.
- **Formati:** video H.264 in mp4 oppure webm, e immagini.
  - ProRes, HAP e HEVC il browser di solito non li decodifica. Vanno convertiti prima con ffmpeg.
  - La conversione nel browser (ffmpeg.wasm) scarica circa 30 MB da internet al primo uso, quindi in show non si conta su quella.
- **Come si usa:**
  - **Scaletta:** pulsante "Cartella video".
  - **Timeline:** pulsante "+ Dalla cartella".
  - **Sorgente del canale:** voce "Dalla cartella video…".
  - Ogni file si può mandare nel canale selezionato, in un nuovo cue oppure come clip sulla traccia del canale, al cursore.
- **File ritrovati per nome.** Cue e clip ricordano il file con il nome (`m:<nome>`).
  - Se il file non è caricato, Regia lo prende dalla cartella quando il percorso o il nome del file coincidono.
  - Lo fa all'apertura, ogni 30 s se manca qualcosa, e con "Ricarica file mancanti".
  - Così uno show preparato su OPS si riapre sulla touring con gli stessi file nella stessa cartella.

### NDI

- **Scelta della sorgente:**
  - "NDI…" nella sorgente del canale elenca le sorgenti del gateway;
  - nei cue le sorgenti NDI compaiono nel gruppo "NDI";
  - nelle clip della timeline la sorgente si scrive `ndi:<nome>`.
- **Indirizzo del gateway:** di default `http://<host della pagina>:8788`. Si cambia dalla finestra NDI e resta salvato (`ndiUrl`).
- **Ricollegamento:** il canale ricorda la sorgente NDI (`S.ch[i].ndi`). Regia si ricollega da sola all'apertura, se il collegamento cade o se non arrivano fotogrammi per 4 s. Il gateway, se la sorgente sparisce o tace per 5 s, ricrea il ricevitore NDI e scrive nel log i fps ricevuti ogni minuto.
- **Profili del gateway:**
  - `preview` resta quello dei tablet (640×360, banda minima);
  - `program` è quello di Regia.

## Orologio dello show

L'opzione **Orologio show** nella barra della timeline fa seguire alla timeline `gaia/show/clock/state` (vedi [show-clock.md](show-clock.md)). Funziona come i follower del bridge:

- **Stato valido:** conta solo uno stato vivo, cioè due `seq` diversi dallo stesso master. Lo stato rimasto nel broker da solo non muove niente.
- **Cosa arriva dal master:** posizione, play e pausa, e BPM. I video si riallineano quando lo scarto supera 0,3 s. Le cue di scena della timeline scattano quando la posizione le passa.
- **Master muto:** si continua a contare dall'ultima posizione (volano) fino a 10 min, e l'etichetta mostra "volano".
- **Comandi locali:** finché è attiva, play e stop della timeline di Regia non fanno nulla. Lo show si comanda dalla Plancia. Togliendo l'opzione la timeline torna al banco.
- **Prove:** per provare senza toccare l'orologio vero si apre `/regia/?clock=<topic di prova>`. È quello che fa `plancia/test/regia-smoke.js`.

## Da fare

1. **RTSP:** passa dal gateway.
2. **Salvataggio:** lo stato di Regia va spostato nel progetto della Plancia. Oggi è nel browser (`localStorage` `regia4ch.v2`) più "Esporta set" e "Importa set".
3. **Plancia:** la riga VIDEO della timeline sceglie la destinazione, PatchDeck o Regia, e lo stato di Regia (in onda, uscite, errori) torna alla Plancia.
4. **Audio reattivo:** prenderlo dal motore audio o dal VBAN invece che dal microfono.
5. **Prestazioni:** provare con i video veri su OPS e sulla touring (iGPU).

## Prova

```
node plancia/test/regia-smoke.js [video.mp4]
```

Avvia un bridge di prova con una cartella video temporanea e Regia in Edge headless. Controlla font, cartella, Range, file nel canale, cue ripresi per nome, clip in timeline, orologio sul topic di prova e NDI con il gateway assente.
