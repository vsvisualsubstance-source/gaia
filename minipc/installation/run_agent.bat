@echo off
cd /d C:\gaia\minipc\installation
set PYTHONUNBUFFERED=1
rem IP Tailscale di Core -- CRITICO per questa macchina (rete diversa da
rem casa per un mese, vedi discovery.py). Valore noto dal lavoro Tailscale
rem precedente: RIVERIFICARE con "tailscale status" su Core prima del
rem deploy, potrebbe essere cambiato.
set GAIA_CORE_TAILSCALE_HOST=100.94.220.65
"C:\gaia\venv\Scripts\pythonw.exe" agent.py >> "C:\gaia\minipc\installation\agent.log" 2>&1
