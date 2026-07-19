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

## Orecchie — `LastVoice → brain`

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
