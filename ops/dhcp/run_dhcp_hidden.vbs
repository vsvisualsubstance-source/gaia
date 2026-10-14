' Lancia run_dhcp.bat senza nessuna finestra visibile, stesso principio di
' ops/agent/run_agent_hidden.vbs (chiudere per sbaglio una finestra console
' termina l'intero processo).
Set objShell = CreateObject("WScript.Shell")
objShell.Run """C:\gaia\ops\dhcp\run_dhcp.bat""", 0, False
