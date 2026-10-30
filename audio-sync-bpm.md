# Audio sync — note di riferimento (BPM, beat tracking, time-stretching)

Stato: **note** (2026-10-30). Promemoria teorico per la parte sync del motore
`gaia-audio` (vedi [console-audio.md](console-audio.md)): da rileggere quando
BPM, griglia o sync danno problemi.

## 1. Rilevamento dei BPM (beat tracking)

L'idea: trovare i transienti (picchi improvvisi di energia, tipo cassa e
rullante) e misurare con che regolarita' si ripetono.

1. **Spettrogramma (FFT)** — il segnale passa dal dominio del tempo a quello
   della frequenza con la Fast Fourier Transform, finestra per finestra.
2. **Onset detection** — si calcola la funzione di onset (dove inizia un
   suono percussivo), di solito come *flusso spettrale* (aumento di energia
   tra una finestra e la successiva), con piu' peso sulle basse
   (sub/kick), dove il ritmo e' piu' marcato.
3. **Autocorrelazione o comb filtering** — si cerca la periodicita' della
   funzione di onset confrontandola con se stessa a ritardi diversi. Il
   ritardo con il picco di correlazione ricorrente e' l'intervallo tra i
   battiti (*inter-beat interval*, IBI):

   ```
   BPM = 60 / IBI_secondi        es. IBI 0,469 s -> 128 BPM
   ```

4. **Alternative / riferimenti** — reti neurali (CNN sugli spettrogrammi),
   librerie consolidate come Librosa (Python) o il beat tracker di Mixxx;
   utili come confronto se il nostro analizzatore sbaglia su un brano.

**Nel motore** (`audio-engine/src/analysis.rs`): flusso spettrale pesato
sulle basse → autocorrelazione con armoniche → BPM fine e fase "piegando"
l'inviluppo sul periodo; intervallo 88-175 (`--range`), BPM arrotondato
all'intero se entro 0,03.

## 2. Sincronizzazione e time-stretching

Noti BPM e posizione del primo battito (downbeat / ancora della griglia) di
due brani, sincronizzare vuol dire allineare i transienti nel tempo:
**tempo** (stessa velocita') e **fase** (battiti che cadono insieme).

### Fattore di scala

```
rapporto = BPM_target / BPM_sorgente
es. 120 -> 128 BPM: 128 / 120 = 1,0667  (+6,67%)
```

Il rapporto deve stare nel range del fader del tempo del deck (±8/16/50%):
+6,67% entra in ±8%, un salto 100 -> 128 (+28%) richiede ±50%.

### Allineamento di fase (beat sync)

Con la griglia di ciascun deck (BPM + ancora) si ricava la fase corrente
0..1 dentro il battito. La correzione e' la differenza di fase, portata in
±mezzo battito e convertita in tempo:

```
d = fase_master - fase_deck          (riportata in -0,5 .. +0,5)
correzione_s = d * 60 / BPM_master
```

### Time-stretching senza cambiare l'intonazione (keylock)

Un resampling semplice cambia velocita' **e** altezza (effetto
"chipmunk"). Per cambiare solo la durata si usano:

- **Phase vocoder** (dominio della frequenza);
- **WSOLA** — Waveform Similarity Overlap-Add (dominio del tempo).

Principio comune:
1. il brano viene tagliato in micro-finestre;
2. le finestre vengono risovrapposte con una spaziatura diversa per
   allungare o accorciare la durata;
3. le fasi delle componenti spettrali vengono corrette per evitare artefatti
   metallici o transienti "sfocati".

Nel motore il keylock e' `signalsmith-stretch`.

### Warping (griglia deformata)

Nelle DAW (Ableton Live, Logic Pro) la griglia viene deformata (*warp*)
perche' i transienti del file coincidano con quarti/sedicesimi del
sequencer. Serve per brani a tempo **non** costante; la nostra griglia per
ora e' a BPM costante + ancora.

## 3. Se qualcosa non va — dove guardare

| Sintomo | Causa probabile | Cosa fare |
|---|---|---|
| BPM doppio o dimezzato (64 invece di 128) | autocorrelazione aggancia un'armonica | controllare `--range`; `grid --double` o ×2/÷2 a mano |
| BPM giusto ma battiti sfasati | ancora sul primo battito sbagliata | `grid --move <ms>` o "il battito e' qui" / `--anchor` |
| In sync all'inizio, poi deriva | brano a tempo non costante (live, vecchi dischi) o BPM non intero | `grid --bpm` esatto; brani live: niente beat sync (servirebbe warping) |
| Sync solo di tempo, niente fase | confidenza bassa, griglia assente | regolare la griglia a mano (si blocca con `locked`) |
| Intonazione cambia con il tempo | keylock spento (resampling semplice) | attivare `keylock` sul deck |
| Suono metallico / transienti impastati | artefatti dello stretching, rapporti grandi | restare entro ±8-16%; verificare impostazioni di `signalsmith-stretch` |
| Click o micro-salti al sync | correzione di fase applicata di colpo | applicarla come nudge graduale, non come seek |
| CPU alta con due deck | keylock + analisi in parallelo | misurare su OPS (Ryzen 8745H), vedi rischi in console-audio.md |

## Fonti

- [Come trovare i BPM di una canzone — produzionemusicale.com](https://www.produzionemusicale.com/come-trovare-i-bpm-di-una-canzone-con-ableton-logic-cubase-e-pro-tools/)
- [Detecting BPM with neural networks — nlml.github.io](https://nlml.github.io/neural-networks/detecting-bpm-neural-networks/)
- [Rilevamento BPM e tonalita' — stemsplit.io](https://stemsplit.io/it/blog/bpm-key-detection-feature)
- [Video: beat detection con FFT](https://www.youtube.com/watch?v=frDQFCRFMB8&t=17)
- [Video: reti neurali per BPM](https://www.youtube.com/watch?v=ylSY3e5T4eI&t=87)
- [Video short: sync](https://www.youtube.com/shorts/1EWMesLFzNc)
