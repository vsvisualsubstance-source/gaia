@echo off
cd /d C:\gaia\minipc\installation
set PYTHONUNBUFFERED=1
rem IP Tailscale di Core -- CRITICO per questa macchina (rete diversa da
rem casa per un mese, vedi discovery.py). Valore noto dal lavoro Tailscale
rem precedente: RIVERIFICARE con "tailscale status" su Core prima del
rem deploy, potrebbe essere cambiato.
set GAIA_CORE_TAILSCALE_HOST=100.94.220.65
rem NIENTE venv su questa macchina (deciso dal vivo 2026-09-01): con
rem l'interprete copiato in C:\gaia\venv\Scripts\, Windows Defender
rem rilanciava una seconda copia del processo tramite l'installazione
rem Python "reale" -- vedi _nota in services.json. Si usa direttamente
rem l'installazione Python di sistema (winget, utente vs).
rem Niente redirect su agent.log qui: l'agent scrive il file da solo con
rem rotazione (_RotatingConsole, vedi agent.py) -- un handle ereditato
rem dalla shell resterebbe aperto per tutta la vita del processo e
rem bloccherebbe il rename in rotazione. NUL e' solo una rete di sicurezza
rem se quella classe fallisse ad avviarsi.
"C:\Users\vs\AppData\Local\Programs\Python\Python312\pythonw.exe" agent.py > NUL 2>&1
