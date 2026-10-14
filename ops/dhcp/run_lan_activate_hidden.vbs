' Lancia gaia_lan_activate.ps1 senza nessuna finestra visibile.
' -WindowStyle Hidden di powershell.exe non basta da solo (flash della
' console visibile per un istante, segnalato dal vivo 2026-10-14) -- stesso
' wrapper WScript.Shell.Run (windowstyle 0) gia' usato da ops/agent e
' ops/dhcp per lo stesso motivo.
Set objShell = CreateObject("WScript.Shell")
objShell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File ""C:\gaia\ops\dhcp\gaia_lan_activate.ps1""", 0, True
