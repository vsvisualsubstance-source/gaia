# Render 3D

Il Render 3D è la pagina "Luci nello spazio" di Nicola dentro la Plancia: la scansione 3D del locale con le luci dello show. Si apre dal gruppo **Render 3D** del menu, oppure in una scheda a parte da `/render3d/` per esportare più veloce.

## Da dove vengono le luci

1. Nella Plancia registri un video col ⏺ del Render (Palco).
2. Mentre registra, la Plancia salva lo stato di ogni luce a 30 fps (`src/62-light-frames.js`): colore, livello, pixel delle barre, pan/tilt/zoom delle teste e punti del laser.
3. A fine video lo stato va sul server: `data/light-frames/<nome del video>.json`, letto da `/api/light-frames`.
4. Nel Render 3D, alla voce **Sorgente delle luci**, scegli la registrazione e colleghi ogni elemento della scena a una luce della Plancia:
   - colonne;
   - barre della consolle;
   - laser.

   Il collegamento automatico usa:
   - le barre in piedi per le colonne;
   - le barre orizzontali, da sinistra, per la consolle;
   - il primo laser per il laser.
5. **Export video**:
   - genera l'MP4 fotogramma per fotogramma (WebCodecs H.264) dai dati, senza scatti;
   - 10 s a 720p si fanno in circa 4 s su OPS.

La vecchia sorgente "pixel di un video del Render" resta disponibile, ma dipende dall'inquadratura del Render.

## Laser senza cubi e qualità dei video

- **Laser senza cubi in uscita:**
  - il Render della Plancia disegna la scena della timeline LASER all'ora dello show, oppure l'ultima mandata dal tablet;
  - lo stesso vale per lo stato salvato.
- **Video del Render:**
  - 1080 righe, 12-40 Mbit/s;
  - nessuna scritta (SIM, messaggi del LED wall, livelli delle teste).

## Musica (20/11)

Il ⏺ del Render salva nella registrazione anche lo stato dei deck A/B del motore audio (`audio` in `data/light-frames/*.json`): brano, posizione, play, tempo, volume (gain × fader × crossfader). Un evento solo quando qualcosa cambia; vale per la Console suonata a mano e per la traccia AUDIO della timeline.

Nel Render 3D, con quella registrazione scelta in "Sorgente delle luci":
- compare **♪ musica della registrazione** (casella e volume); i brani arrivano dalla libreria della Plancia (`/api/audio/file`);
- in play la musica segue la barra del tempo (salti, giro dall'inizio, pausa); il browser la fa sentire dopo il primo tocco sulla pagina;
- **● registra MP4** rifà il mix offline e lo mette nel video (AAC, altrimenti Opus); il messaggio finale dice "Con musica" o perché no.

Senza motore audio collegato durante il ⏺, o con registrazioni di prima del 20/11, il Render 3D resta muto. Il brano deve essere nella libreria del PC che serve la Plancia. Test: `plancia/test/render3d-audio.js`.

## Elementi del Palco: LED wall, schermi, proiettori (20/11)

Il ⏺ del Render salva anche LED wall, schermi e proiettori del Palco: posizione, misure, rotazione, schermo puntato, rapporto di tiro, sorgente. Il Render 3D li mette nella scansione (sezione **Elementi del Palco**):

- **LED wall:** pannello con le misure vere, del colore registrato (sorgente procedurale), con la luce che butta davanti; con sorgente video per ora resta appena acceso (il contenuto video è il passo dopo).
- **Schermo:** superficie bianca.
- **Proiettore:** corpo, fascio (si spegne con "fasci") e immagine di prova proiettata davvero sulla scansione, puntata al centro dello schermo collegato; la larghezza viene dal rapporto di tiro e dalla distanza vera nello spazio. Il messaggio dice distanza e larghezza dell'immagine.

**Allineamento Palco → scansione.** Coordinate diverse: il Palco ha x = destra/sinistra vista dal pubblico, y = profondità (0 = fondo palco); la scansione ha x verso la consolle, z a destra. Si calcola spostamento + rotazione + scala:
- **automatico:** dalle colonne collegate in "Sorgente delle luci" (posizione nel Palco ↔ posizione nella scansione); con 3 o più colonne il messaggio dà lo scarto medio;
- **manuale (2 punti):** per un Palco non in scala o senza colonne. Scegli un elemento del Palco, 📍, clic dove sta nella scansione; due volte, con punti lontani;
- **ritocchi:** sposta avanti / di lato, ruota, scala, quota; "specchia" se il Palco risulta a specchio.

La scala vale solo per le posizioni: le misure degli oggetti restano quelle del Palco (metri veri). Tutto resta salvato nel browser, punti manuali compresi. Registrazioni di prima del 20/11: niente rotazione né schermo puntato (valori di base). Test: `plancia/test/render3d-palco.js`.

Da fare: contenuto video di LED wall e proiettori (registrato col ⏺); sorgente del proiettore nel Palco come per il LED wall. Dopo: i servizi di mapping di Regia per la geometria del proiettore.

## File

| Cosa | Dove |
|---|---|
| Pagina | `plancia/render3d/index.html` |
| three.js 0.170 e mp4-muxer | `plancia/render3d/vendor/` (niente internet) |
| Scansione e video di prova | `plancia/data/render3d/` (fuori da git, da copiare sulla touring) |
| Stato delle luci | `plancia/data/light-frames/` (fuori da git) |
| Widget | `src/63-render3d.js` |

Il widget è un solo iframe posato sopra il riquadro, così la scansione non si ricarica a ogni ridisegno della Plancia.
