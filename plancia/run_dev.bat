@echo off
rem Plancia-next: istanza di PROVA accanto alla Plancia in esercizio (8080).
rem Porte e dati separati; timeline video/laser verso device inesistenti.
rem OSC: all'avvio verso nessuno (127.0.0.1:7029), MA appena una pagina si collega il
rem bridge prende il bersaglio dalle sue Connessioni: con DMX Master impostato li',
rem la 8092 comanda TD davvero come la Plancia vera.
rem Variabili da PowerShell: $env:OSC_HOST="192.168.1.73"; .un_dev.bat  (set non basta)
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
