<#
Servizi di OPS su una macchina Windows (OPS stessa o la touring): attivita'
pianificate, firewall, alimentazione. Le attivita' sono le stesse di OPS,
esportate in ops/setup/tasks/*.xml con l'utente al posto di {USER_SID}.

Da PowerShell come AMMINISTRATORE, con l'utente che fa l'accesso alla console:
  powershell -ExecutionPolicy Bypass -File C:\gaia\ops\setup\setup_ops_services.ps1 -SenzaLan

  -User      utente delle attivita' (predefinito: chi esegue lo script)
  -SenzaLan  DHCP e LAN-Activate registrati ma DISATTIVATI. Da usare sulla
             touring finche' non sostituisce OPS: entrambe prendono
             192.168.1.240 e fanno da DHCP, mai accese insieme sulla stessa
             LAN. Per attivarle dopo:
               Enable-ScheduledTask GAIA-OPS-DHCP; Enable-ScheduledTask GAIA-OPS-LAN-Activate

Idempotente: riregistra le attivita' e ricrea le regole ogni volta.
Non avvia nulla: le attivita' partono al prossimo accesso (o Start-ScheduledTask).
Restano a parte: agent (services.local.json, mqtt_override.json), laser
(setup_laser.ps1), rtpMIDI (setup_rtpmidi.ps1), stack Docker.
#>
param(
  [string]$User = $env:USERNAME,
  [switch]$SenzaLan
)
$ErrorActionPreference = 'Stop'

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Serve un PowerShell aperto come amministratore.' }

$sid = (New-Object Security.Principal.NTAccount($User)).Translate([Security.Principal.SecurityIdentifier]).Value
"Utente delle attivita': $User ($sid)"

# ── Attivita' pianificate ─────────────────────────────────────────────
$lan = 'GAIA-OPS-DHCP', 'GAIA-OPS-LAN-Activate'
foreach ($f in Get-ChildItem (Join-Path $PSScriptRoot 'tasks') -Filter '*.xml') {
  $name = $f.BaseName
  $xml = (Get-Content $f.FullName -Raw -Encoding UTF8).Replace('{USER_SID}', $sid)
  Register-ScheduledTask -TaskName $name -Xml $xml -Force | Out-Null
  if ($SenzaLan -and $name -in $lan) {
    Disable-ScheduledTask -TaskName $name | Out-Null
    "Attivita' $name registrata DISATTIVATA (-SenzaLan)"
  } else { "Attivita' $name registrata" }
}

# ── Firewall in ingresso (come su OPS) ────────────────────────────────
function Rule($name, $proto, $port, $profile) {
  Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -DisplayName $name -Direction Inbound -Action Allow -Protocol $proto -LocalPort $port -Profile $profile | Out-Null
  "Firewall: $name"
}
Rule 'Gaia Mosquitto MQTT TCP 11883'      TCP 11883 Private
Rule 'Gaia Mosquitto WebSocket TCP 19001' TCP 19001 Private
Rule 'Gaia Node-RED TCP 1881'             TCP 1881  Any
Rule 'Gaia Plancia TCP 8080'              TCP 8080  'Private,Public'
Rule 'GAIA-VideoGateway-8788'             TCP 8788  Any
Rule 'GAIA DHCP Server (UDP 67 in)'       UDP 67    Any
# Python di sistema (OSC bridge, agent, video gateway: il venv avvia questo interprete)
foreach ($exe in 'python.exe', 'pythonw.exe') {
  $path = Join-Path ${env:ProgramFiles} "Python311\$exe"
  if (Test-Path $path) {
    $name = "GAIA Python ($exe)"
    Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    New-NetFirewallRule -DisplayName $name -Direction Inbound -Action Allow -Program $path -Profile Any | Out-Null
    "Firewall: $name"
  }
}

# ── Alimentazione: mai in sospensione (raggiungibile via MQTT/SSH) ─────
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
'Sospensione e ibernazione automatiche disattivate (alimentazione da rete).'
