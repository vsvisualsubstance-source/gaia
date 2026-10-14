@echo off
cd /d C:\gaia\ops\dhcp
set PYTHONUNBUFFERED=1
rem Niente redirect su dhcp_server.log qui: lo scrive da solo con rotazione
rem (_RotatingConsole, stesso pattern di ops/agent/agent.py).
"C:\gaia\venv\Scripts\pythonw.exe" dhcp_server.py > NUL 2>&1
