' Lancia run_osc_bridge.bat senza nessuna finestra visibile, stesso
' principio di ops/agent/run_agent_hidden.vbs e ops/dhcp/run_dhcp_hidden.vbs.
Set objShell = CreateObject("WScript.Shell")
objShell.Run """C:\gaia\ops\osc-bridge\run_osc_bridge.bat""", 0, False
