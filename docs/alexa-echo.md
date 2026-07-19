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
