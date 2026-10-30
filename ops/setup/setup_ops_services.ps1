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
  # senza la dichiarazione encoding="UTF-8": a Register-ScheduledTask arriva una stringa UTF-16
  $xml = (Get-Content $f.FullName -Raw -Encoding UTF8).Replace('{USER_SID}', $sid) -replace '^<\?xml[^>]*\?>\s*', ''
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
# e Node (Plancia). Una regola di permesso per il programma evita che Windows
# chieda "Consenti accesso" su ogni rete nuova: senza schermo nessuno risponde
# e Windows crea da solo regole di BLOCCO (touring 2026-10-30, due volte).
foreach ($exe in 'Python311\python.exe', 'Python311\pythonw.exe', 'nodejs\node.exe') {
  $path = Join-Path ${env:ProgramFiles} $exe
  $exe = Split-Path $exe -Leaf
  if (Test-Path $path) {
    $name = "GAIA $exe"
    Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    New-NetFirewallRule -DisplayName $name -Direction Inbound -Action Allow -Program $path -Profile Any | Out-Null
    "Firewall: $name"
  }
}

# Senza schermo la richiesta "Consenti accesso" di Windows al primo avvio di
# node/python non compare e Windows crea da solo regole di BLOCCO, che
# vincono sulle regole qui sopra (touring 2026-10-30: Plancia irraggiungibile).
foreach ($r in Get-NetFirewallRule -Direction Inbound -Action Block -ErrorAction SilentlyContinue) {
  $prog = ($r | Get-NetFirewallApplicationFilter).Program
  if ($prog -match '\\(node|python|pythonw)\.exe$') {
    $r | Remove-NetFirewallRule
    "Firewall: tolta regola di blocco '$($r.DisplayName)' ($prog)"
  }
}

# ── Alimentazione: mai in sospensione (raggiungibile via MQTT/SSH) ─────
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
'Sospensione e ibernazione automatiche disattivate (alimentazione da rete).'
