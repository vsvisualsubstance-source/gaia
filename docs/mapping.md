# Mapping dei proiettori

Il mapping di Regia (corner pin e mesh) portato dentro la Plancia (20/11/2026). Regia resta in pausa: il 20/11 il suo mapping è stato provato su un proiettore vero da OPS e funziona, ma è una pagina web e il browser la rallenta o la ferma quando non è in primo piano. Va bene per simulare, non per il live. Per il live servirà un motore nativo che fa solo mapping (Rust o simile), che leggerà questi stessi dati.

## Dove sta

| Cosa | Dove |
|---|---|
| Codice comune (omografia, mesh Catmull-Rom, punti, renderer WebGL) | `plancia/mapping/mapping-core.js`, globale `PlanciaMapping`, anche in Node per i test |
| Pagina Mapping | `plancia/src/63-mapping.js`, gruppo **Render 3D → Mapping** |
| Dati | nel progetto della Plancia: `layout.mapping.out[<id proiettore>].map` |
| Lettura dal Render 3D (e domani dal motore nativo) | `GET /api/mapping` del bridge |

## Formato

Coordinate normalizzate dell'uscita del proiettore: 0,0 = in alto a sinistra, 1,1 = in basso a destra.

```
{mode:'corners'|'mesh', corners:[[x,y] alto sx, alto dx, basso dx, basso sx], n:2..8, off:[[du,dv] × n·n]}
```

`off` sposta i punti della mesh nello spazio dell'immagine, prima dell'omografia; come in Regia la mesh resta applicata anche tornando al corner pin. È lo stesso formato delle uscite di Regia.

## La pagina Mapping

- **Proiettore:** quelli del Palco.
- **Anteprima:** la sorgente del proiettore (NDI o URL dal Video Service, oppure l'immagine di prova) deformata con WebGL, coi punti sopra.
- **Corner pin:** trascina i 4 angoli; trascinando fuori dai punti si sposta tutto.
- **Mesh:** da 2×2 a 8×8 punti, per superfici non piane.
- **Tastiera:** frecce 1 px, Maiusc + frecce 10 px, Tab punto successivo.
- **Reset**, **↻ 180°** (proiettore appeso), **⇦ dal Render 3D** (prende gli angoli calcolati sul modello).
- Si salva nel progetto: lo vedono tutti i tablet e viaggia con lo show.

## Con il Render 3D

- Il Render 3D usa il mapping del progetto per l'immagine del proiettore, mesh compresa, e segue le modifiche (controlla ogni 1,5 s).
- **📍 punta qui** (clic sulla scansione) sceglie dove guarda il proiettore.
- **◰ mappa 4 punti:** clicchi sul modello i 4 angoli dove deve cadere l'immagine (alto sx, alto dx, basso dx, basso sx); il Render 3D calcola il corner pin e lo manda alla Plancia (`BroadcastChannel 'plancia-mapping'`), che lo salva nel progetto. Serve la Plancia aperta nello stesso browser (il Render 3D dentro la Plancia va sempre bene).

## Test

`plancia/test/mapping-core.test.js` (calcoli), `plancia/test/mapping-page.js` (pagina), `plancia/test/render3d-mapping.js` (Plancia ↔ Render 3D).
