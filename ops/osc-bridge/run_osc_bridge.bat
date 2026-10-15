@echo off
cd /d C:\gaia\ops\osc-bridge
set PYTHONUNBUFFERED=1
rem Gaia Portable (2026-10-15): Node-RED e mosquitto girano QUI su OPS, ma
rem connetterti alla loro IP esterna (192.168.1.240) da un processo che
rem vive sulla stessa macchina non e' affidabile su Windows (Docker
rem Desktop/HNS, stesso problema gia' trovato per l'agent e dhcp_server.py)
rem -- 127.0.0.1 invece.
set GAIA_WS_HOST=127.0.0.1
set GAIA_WS_PORT=1881
set MQTT_HOST=127.0.0.1
set MQTT_PORT=11883
"C:\gaia\venv\Scripts\pythonw.exe" osc_bridge.py > NUL 2>&1
