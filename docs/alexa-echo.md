# Alexa / Echo — bocche e orecchie extra di Gaia (2026-07-19)

Binding **amazonechocontrol** in OpenHAB (account 177e7cac7a): OpenHAB comanda
gli Echo. Direzione opposta (skill Hue su Alexa) copre solo le luci.

## Device e posizioni reali

| Thing | Serial | Stanza |
|---|---|---|
| Echo Show | G091MK08210701HQ | **cucina** |
| Cassa Soggiorno | G2A0U20484950167 | **soggiorno** |
| Cassa camera (etichetta ingannevole!) | G090XG090105149E | **bagno** |

Item testuali in `gaia-data/openhab/conf/items/gaia-alexa.items` (FUORI dal
repo): `{Dev}_TTS` (String textToSpeech), `{Dev}_Volume` (Dimmer),
`{Dev}_LastVoice` (String, gruppo `gGaiaEchoVoice`).

## Bocche — canale `gaia/echo/say`

MQTT `gaia/echo/say` `{room:'cucina'|'soggiorno'|'bagno' | all:true, text, volume?}`
→ flow EchoSay → POST REST sugli item TTS. È il canale **notifiche mirate per
stanza**. Collegato a:
- **TTS Queue Manager**: ogni annuncio della coda (pensieri, level-up) parla
  anche su TUTTI gli Echo — stesse ore di silenzio (23-8) della coda; spegnibile
  con retained `{"enabled":false}` su `gaia/config/echoannounce`.
- **Vessillo** (Tap tasto 3): oltre a Telegram, parla in soggiorno.

**Voce dedicata a Gaia (2026-07-23)**: il canale `textToSpeech` del binding
supporta SSML (documentato nel binding stesso, verificato dal vivo che
`<voice name="...">` cambia voce davvero, non solo nelle skill Alexa
native). EchoSay avvolge ogni testo in
`<speak><voice name="Carla">...</voice></speak>` prima di mandarlo (a meno
che sia già SSML, riconosciuto dal prefisso `<speak`) — così un annuncio
di Gaia si sente subito diverso dalla voce nativa di Alexa (quella resta
quella di default del dispositivo, impostazione dell'app Alexa — non
controllabile da qui). Voci italiane disponibili testate: Giorgio
(maschile), Carla e Bianca (femminili).

## Orecchie — `LastVoice → brain` — ⚠️ BLOCCATE DA AMAZON (2026-07-19)

**Stato reale**: tutta la catena a valle è pronta e testata, ma il canale
`lastVoiceCommand` del binding ufficiale 4.2 NON riceve dati — Amazon ha
rimosso l'API activities/lastSpokenText (problema noto in community, tutte le
versioni 4.x/5.x; su OH5 c'è un trade-off "o TTS o lastVoiceCommand" legato
allo stato di login). Verificato dal vivo: frase all'Echo → item resta NULL.
NON tentare fix cambiando login/binding senza mettere in conto di PERDERE il
TTS (che funziona ed è la parte usata). Se un futuro aggiornamento del binding
rianima il canale, le orecchie si accendono DA SOLE: regola, MQTT, EchoEars e
branch nel brain restano al loro posto.

### La catena pronta (dormiente)

Regola DSL `gaia-data/openhab/conf/rules/gaia-echo.rules`: ogni update di
`gGaiaEchoVoice` → MQTT `openhab/echo/{Item}/voice` (stesso broker Thing
`mqtt:broker:5ad6f42542` della regola busmqtt — l'eventbus mqtt di OH2 NON è
attivo, il cfg è residuo). Flow EchoEars → evento `{source:'alexa',
category:'speech', room}` → brain: push in `brain.voiceCommands`
(`via:'alexa'`) = welcome la scrive in blu + XP voce dal polling. È ascolto
**osservato, non eseguito**: nessun comando parte da ciò che si dice ad Alexa.

## Gotcha

- `/rest/things` e `/rest/rules` di OpenHAB richiedono auth; `/rest/items` no.
  I Things si leggono dal jsondb in `userdata/jsondb/`.
- La config testuale (conf/items, conf/rules) si ricarica da sola in ~10s:
  è la via per creare item/regole senza credenziali API.
- Il bagno e la cucina ora hanno una voce; il bagno resta senza orecchie Gaia
  native — l'Echo è il primo sensore di quella stanza.

## Allarmi mirati e promemoria per stanza (2026-07-20)

Costruiti sopra il canale `gaia/echo/say` già esistente — due consumatori nuovi
in tab_media (Node-RED).

### Allarme citofono/doorbell

`mqtt in gaia/+/alarm` (topic già usato da `pi/voice/main.py` per il
classificatore citofono, mai consumato finora) → `DoorbellAlarm`:
anti-spam 15s, poi annuncia **ovunque** (non solo "dove sei" — un citofono è
urgente): `gaia/echo/say {all:true}`, `gaia/voice/tts/{ingresso,soggiorno,salotto}`
(le stanze con voce Gaia — no-op silenzioso dove il servizio non è attivo),
Telegram. Evento `{source:'doorbell', category:'alarm'}` nel brain (diary/game.html).

**⚠️ Stato reale del rilevamento (2026-07-20): NON allenato.** Il classificatore
citofono (`doorbell_verifier.pkl`) ha 0 campioni positivi e 1 negativo — non è
mai stato distribuito al Pi (`~/gaia/voice/models/` non lo contiene). La CATENA
è pronta e testata con un evento MQTT simulato; per farla scattare davvero
serve: registrare campioni citofono reali da admin.html (come per il wakeword),
allenare, OTA al Pi. Fino ad allora `gaia/{room}/alarm` non riceve mai nulla
da solo — ma qualsiasi altra sorgente (un sensore fisico, un pulsante) può
pubblicare sullo stesso topic e l'annuncio funziona già.

### Promemoria per stanza

Motore semplice, in-memory (non sopravvive a un riavvio di Node-RED — i
promemoria sono per l'ordine dei minuti/ore, non pensati per durare giorni):
- `POST /gaia/reminder {room, text, delay_min}` → crea, ritorna `{id, due_ts}`
- `GET /gaia/reminder` → lista pendenti
- `POST /gaia/reminder/cancel {id}` → annulla
- Inject `Reminder Tick (30s)` → `ReminderFire`: annuncia i promemoria scaduti
  SOLO nella loro stanza (`gaia/echo/say {room}` + `gaia/voice/tts/{room}`,
  niente `all:true` — a differenza del citofono, un promemoria è per chi è lì),
  li rimuove dalla lista, evento `{source:'reminder', category:'reminder'}` nel brain.

**Telegram**: `/promemoria <stanza> <minuti> <testo>` (es. `/promemoria cucina
10 togli la pasta`), `/promemoria` da solo = lista, `/promemoria annulla <id>`.
Manipola direttamente `global.gaiaReminders` (stesso array usato dagli
endpoint HTTP — un solo stato condiviso).

Verificato dal vivo: citofono simulato → 5 messaggi corretti + evento nel
brain; promemoria da HTTP con delay 0.5min → scattato al minuto giusto SOLO
in cucina, rimosso dalla lista; annullamento manuale funzionante. Il comando
Telegram condivide la stessa logica testata via HTTP — verifica diretta da
Telegram lasciata all'utente (il nodo `telegram receiver` non è simulabile
via MQTT).

**Gotcha Node-RED**: una funzione con più messaggi sullo STESSO output va
ritornata come `[msgArray, altroOutput]`, non `[[msgArray], altroOutput]` —
il doppio annidamento produce "Function tried to send a message of type
Array" (capitato qui, corretto subito).
