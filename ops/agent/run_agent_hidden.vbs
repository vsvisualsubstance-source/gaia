' Lancia run_agent.bat senza nessuna finestra visibile (console cmd.exe inclusa).
' Necessario perche' Task Scheduler con logon interattivo mostra una finestra
' per gli eseguibili console — chiuderla per sbaglio (visto in produzione,
' 2026-07-06) termina l'intero albero di processi (agent + camera/yolo/
' mediapipe/voice), non solo quello che sembra "in primo piano".
Set objShell = CreateObject("WScript.Shell")
objShell.Run """C:\gaia\ops\agent\run_agent.bat""", 0, False
