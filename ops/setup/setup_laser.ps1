<#
Laser gateway (ops/laser) su una macchina Gaia Windows: OPS o la touring.
Idempotente: si puo' rilanciare quante volte si vuole.

  powershell -ExecutionPolicy Bypass -File C:\gaia\ops\setup\setup_laser.ps1

Cosa fa:
  1. controlla venv e paho-mqtt (li installa se mancano);
  2. controlla che la porta dei frame (UDP 7480) non cada in un intervallo
     riservato da Windows (su OPS 44624-48712 lo e', per questo 7480);
  3. regola firewall in ingresso UDP 7480 (serve l'amministratore: senza,
     stampa il comando da lanciare);
  4. lancia i test del gateway contro l'emulatore del cubo.
Il servizio "laser" e' gia' in ops/agent/services.json: dopo questo script
riavviare l'agent e accenderlo da Admin. I cubi: cavo allo switch, modalita'
LAN Client (LED verde), poi "Cerca cubi" nella pagina Laser della Plancia.
#>
$ErrorActionPreference = 'Stop'
$Gaia = 'C:\gaia'
$Py = Join-Path $Gaia 'venv\Scripts\python.exe'
$Laser = Join-Path $Gaia 'ops\laser'
$Port = 7480
$RuleName = 'GAIA Laser gateway (UDP 7480)'
$ok = $true

Write-Host '== 1. venv e paho-mqtt'
if (-not (Test-Path $Py)) { Write-Host "MANCA il venv: $Py (crearlo prima con il setup base)"; exit 1 }
& $Py -c "import paho.mqtt" 2>$null
if ($LASTEXITCODE -ne 0) { & $Py -m pip install --quiet 'paho-mqtt>=2.1' }
& $Py -c "import paho.mqtt; print('paho-mqtt', paho.mqtt.__version__)"

Write-Host "== 2. porta UDP $Port libera e fuori dagli intervalli riservati"
$probe = "import socket`ns=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)`ntry:`n  s.bind(('0.0.0.0',$Port)); print('libera')`nexcept OSError as e:`n  print('OCCUPATA', e.winerror)"
$res = & $Py -I -c $probe
Write-Host "  $Port : $res"
if ($res -notmatch 'libera') {
    # libera = nessuno la usa; se il gateway e' gia' acceso e' normale che sia occupata
    $gw = Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.CommandLine -match 'laser_gateway.py' }
    if ($gw) { Write-Host '  (occupata dal laser gateway gia'' acceso: ok)' } else { $ok = $false; Write-Host '  ATTENZIONE: porta occupata o riservata (netsh int ipv4 show excludedportrange udp)' }
}

Write-Host "== 3. firewall in ingresso UDP $Port"
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue) {
    Write-Host '  regola gia'' presente'
} elseif ($admin) {
    New-NetFirewallRule -DisplayName $RuleName -Direction Inbound -Protocol UDP -LocalPort $Port -Action Allow -Profile Any | Out-Null
    Write-Host '  regola creata'
} else {
    $ok = $false
    Write-Host '  serve l''amministratore. Da una PowerShell come amministratore:'
    Write-Host "  New-NetFirewallRule -DisplayName '$RuleName' -Direction Inbound -Protocol UDP -LocalPort $Port -Action Allow -Profile Any"
}

Write-Host '== 4. test del gateway (emulatore del cubo, porte 39xxx)'
Push-Location $Laser
# via cmd: in PowerShell 5.1 lo stderr di un exe con ErrorAction Stop diventa un errore fatale
try { $out = cmd /c "`"$Py`" -m unittest test_laser 2>&1"; $out | Select-Object -Last 3; if ($LASTEXITCODE -ne 0) { $ok = $false } } finally { Pop-Location }

if ($ok) { Write-Host '== laser pronto: riavviare l''agent e accendere il servizio "laser" da Admin' }
else { Write-Host '== laser NON pronto: vedi sopra'; exit 2 }
