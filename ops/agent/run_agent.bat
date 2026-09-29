@echo off
cd /d C:\gaia\ops\agent
set PYTHONUNBUFFERED=1
rem Niente redirect su agent.log qui: l'agent scrive il file da solo con
rem rotazione (_RotatingConsole, vedi agent.py) -- un handle ereditato
rem dalla shell resterebbe aperto per tutta la vita del processo e
rem bloccherebbe il rename in rotazione (483MB mai ruotato, 2026-09-29).
rem NUL e' solo una rete di sicurezza se quella classe fallisse ad avviarsi.
"C:\gaia\venv\Scripts\pythonw.exe" agent.py > NUL 2>&1
