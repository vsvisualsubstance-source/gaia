' Lancia run_agent.bat senza nessuna finestra visibile (console cmd.exe inclusa).
' Necessario perche' Task Scheduler con logon interattivo mostra una finestra
' per gli eseguibili console — chiuderla per sbaglio (stesso rischio gia'
' documentato per OPS, vedi ops/agent/run_agent_hidden.vbs) termina l'intero
' albero di processi (agent + madmapper_bridge), non solo quello che sembra
' "in primo piano". Su questa macchina, non presidiata, il rischio e' anche
' peggiore: nessuno la' per riaprirla se capita per sbaglio.
Set objShell = CreateObject("WScript.Shell")
objShell.Run """C:\gaia\minipc\installation\run_agent.bat""", 0, False
