' Lancia run_dhcp.bat senza nessuna finestra visibile, stesso principio di
' ops/agent/run_agent_hidden.vbs (chiudere per sbaglio una finestra console
' termina l'intero processo).
' 2026-11-11: il task GAIA-OPS-DHCP sulla touring lo richiama ogni 2 minuti
' (DHCP sempre attivo, anche se il cavo si collega dopo l'avvio): se
' dhcp_server.py e' gia' in esecuzione non ne parte un secondo.
Set objWMI = GetObject("winmgmts:\\.\root\cimv2")
Set procs = objWMI.ExecQuery("SELECT ProcessId FROM Win32_Process WHERE CommandLine LIKE '%dhcp_server.py%' AND NOT CommandLine LIKE '%WMIC%'")
If procs.Count > 0 Then WScript.Quit 0
Set objShell = CreateObject("WScript.Shell")
objShell.Run """C:\gaia\ops\dhcp\run_dhcp.bat""", 0, False
