@echo off
cd /d C:\gaia\ops\agent
set PYTHONUNBUFFERED=1
"C:\gaia\venv\Scripts\python.exe" agent.py >> "C:\gaia\ops\agent\agent.log" 2>&1
