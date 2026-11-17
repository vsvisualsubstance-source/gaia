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

## File

| Cosa | Dove |
|---|---|
| Pagina | `plancia/render3d/index.html` |
| three.js 0.170 e mp4-muxer | `plancia/render3d/vendor/` (niente internet) |
| Scansione e video di prova | `plancia/data/render3d/` (fuori da git, da copiare sulla touring) |
| Stato delle luci | `plancia/data/light-frames/` (fuori da git) |
| Widget | `src/63-render3d.js` |

Il widget è un solo iframe posato sopra il riquadro, così la scansione non si ricarica a ogni ridisegno della Plancia.
