@echo off
cd /d C:\gaia\plancia
rem Gaia Portable (2026-10-15): bridge.js e osc_bridge.py girano entrambi
rem su OPS -- connettersi alla IP esterna (192.168.1.240) da un processo
rem che vive sulla stessa macchina non e' affidabile su Windows (Docker
rem Desktop/HNS, stesso problema gia' trovato per agent/dhcp_server.py/
rem osc_bridge.py) -- 127.0.0.1 per il canale Gaia.
rem OSC_HOST/OSC_PORT (canale 3, show control) puntano invece a DMX
rem Master su un'ALTRA macchina -- IP reale, non 127.0.0.1.
set PORT=8080
set OSC_HOST=192.168.1.73
set OSC_PORT=7020
set GAIA_OSC_HOST=127.0.0.1
set GAIA_OSC_PORT=9008
node build-app.js
if errorlevel 1 exit /b 1
node bridge.js > plancia.log 2>&1
