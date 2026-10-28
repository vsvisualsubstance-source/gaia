<#
Inventario di una macchina Windows prima di prepararla come OPS/touring.
Sola lettura: non installa e non cambia niente.

  powershell -NoProfile -ExecutionPolicy Bypass -File touring-inventory.ps1
  (via ssh da OPS: ssh touring "powershell -NoProfile -Command -" < touring-inventory.ps1)
#>
$ErrorActionPreference = 'SilentlyContinue'
function Section($t) { "`n== $t" }

Section 'Sistema'
$os = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem
"{0} {1} build {2} - {3} - utente {4}" -f $os.Caption, $os.OSArchitecture, $os.BuildNumber, $cs.Name, $env:USERNAME
"RAM {0:N1} GB - avvio {1}" -f ($cs.TotalPhysicalMemory / 1GB), $os.LastBootUpTime
(Get-CimInstance Win32_Processor | Select-Object -First 1).Name
Get-CimInstance Win32_VideoController | ForEach-Object { "GPU: {0} - driver {1}" -f $_.Name, $_.DriverVersion }

Section 'Dischi'
Get-PSDrive -PSProvider FileSystem | Where-Object Used -ne $null | ForEach-Object { "{0}: liberi {1:N0} GB su {2:N0} GB" -f $_.Name, ($_.Free / 1GB), (($_.Used + $_.Free) / 1GB) }

Section 'Rete'
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254*' } | ForEach-Object { "{0,-28} {1}/{2}" -f $_.InterfaceAlias, $_.IPAddress, $_.PrefixLength }
Get-NetConnectionProfile | ForEach-Object { "profilo {0}: {1}" -f $_.InterfaceAlias, $_.NetworkCategory }
"internet: " + [bool](Test-NetConnection 1.1.1.1 -Port 443 -InformationLevel Quiet -WarningAction SilentlyContinue)

Section 'Programmi'
$cmds = 'git','node','npm','python','py','docker','wsl','ollama','mpv','winget','tailscale'
foreach ($c in $cmds) {
  $p = (Get-Command $c -ErrorAction SilentlyContinue | Select-Object -First 1).Source
  if ($p) { $v = try { (& $c --version 2>$null | Select-Object -First 1) } catch { '' }; "{0,-10} {1}  {2}" -f $c, $v, $p } else { "{0,-10} MANCA" -f $c }
}
$apps = Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*','HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' |
  Where-Object { $_.DisplayName -match 'TouchDesigner|NDI|AnyDesk|Tailscale|Docker|Ollama|Python|Node|Git|MPV|Visual C\+\+ 2015|Edge|Chrome|loopMIDI|Dante' } |
  Where-Object { $_.DisplayName -notmatch 'Python .*(Core|Development|Documentation|Executables|pip|Standard|Tcl|Test Suite|Utility|Add to Path)' } |
  Sort-Object DisplayName -Unique
$apps | ForEach-Object { "{0} {1}" -f $_.DisplayName, $_.DisplayVersion }

Section 'Servizi e attivita'
Get-Service sshd, Tailscale, 'com.docker.service', AnyDesk | ForEach-Object { "{0,-22} {1,-8} {2}" -f $_.Name, $_.Status, $_.StartType }
Get-ScheduledTask | Where-Object { $_.TaskName -like 'GAIA*' -or $_.TaskName -match 'shutdown|spegn' } | ForEach-Object { "task {0} ({1})" -f $_.TaskName, $_.State }
if (Test-Path "$env:USERPROFILE\.wslconfig") { "--- .wslconfig"; Get-Content "$env:USERPROFILE\.wslconfig" }

Section 'Cartelle note'
foreach ($d in 'C:\gaia', "$env:USERPROFILE\Documents\td", "$env:USERPROFILE\Documents\Derivative") { "{0,-45} {1}" -f $d, (Test-Path $d) }

Section 'Spegnimenti recenti (1074 = richiesto da un programma, 41/6008 = improvviso)'
Get-WinEvent -FilterHashtable @{LogName='System';Id=1074,6008,41} -MaxEvents 5 | ForEach-Object { "{0} id {1}: {2}" -f $_.TimeCreated, $_.Id, (($_.Message -split "`n")[0]) }
