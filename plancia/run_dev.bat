@echo off
rem Plancia-next: istanza di PROVA accanto alla Plancia in esercizio (8080).
rem Porte e dati separati; OSC verso nessuno; timeline video/laser verso device inesistenti.
rem Per pilotare davvero DMX Master: set OSC_HOST=192.168.1.73 prima di lanciare.
rem ATTENZIONE: il broker MQTT e' quello vero: i comandi Gaia/DMX/laser dai widget MQTT arrivano davvero.
rem Per una prova del tutto isolata apri la pagina con ?broker=0.0.0.0 (resta in simulazione).
cd /d "%~dp0"
if "%PORT%"=="" set PORT=8092
if "%OSC_IN%"=="" set OSC_IN=9010
if "%OSC_HOST%"=="" set OSC_HOST=127.0.0.1
if "%OSC_PORT%"=="" set OSC_PORT=7029
if "%GAIA_OSC_HOST%"=="" set GAIA_OSC_HOST=127.0.0.1
if "%GAIA_OSC_PORT%"=="" set GAIA_OSC_PORT=9029
if "%PATCHDECK_ID%"=="" set PATCHDECK_ID=pd-dev-nessuno
if "%LASER_ID%"=="" set LASER_ID=laser-dev-nessuno
if "%PLANCIA_STATE_FILE%"=="" set PLANCIA_STATE_FILE=%~dp0data\state.json
node build-app.js && node bridge.js
