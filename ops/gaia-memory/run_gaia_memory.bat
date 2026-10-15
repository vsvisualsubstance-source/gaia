@echo off
cd /d C:\gaia\ops\gaia-memory
set PYTHONUNBUFFERED=1
rem Gaia Portable (2026-10-15): Qdrant qui e' containerizzato (porta host
rem 16333, non 6333 nativo come su Core), Ollama e' nativo (11434, stesso
rem default di Core). 127.0.0.1 non l'IP esterno di OPS -- stesso motivo
rem hairpin-NAT/Docker Desktop gia' trovato per agent/dhcp/osc-bridge.
set GAIA_QDRANT_URL=http://127.0.0.1:16333
set GAIA_OLLAMA_URL=http://127.0.0.1:11434
"C:\gaia\venv\Scripts\pythonw.exe" brain_memory.py > NUL 2>&1
