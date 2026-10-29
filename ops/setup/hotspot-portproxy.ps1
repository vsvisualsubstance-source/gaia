<#
Hotspot di Windows su OPS (o sulla touring): i tablet collegati all'hotspot
(192.168.137.x) aprono la Plancia su http://192.168.137.1:8080, ma le porte
pubblicate da Docker (broker MQTT WebSocket 19001, Node-RED 1881) non si vedono
su quella rete. Questo script le inoltra da 192.168.137.1 a 127.0.0.1, dove
funzionano, e apre il firewall solo per la rete dell'hotspot.

Da PowerShell come AMMINISTRATORE, con l'hotspot acceso:
  powershell -ExecutionPolicy Bypass -File C:\gaia\ops\setup\hotspot-portproxy.ps1
  ... -Remove   per togliere inoltri e regola

Idempotente: si puo' rieseguire. Gli inoltri restano dopo il riavvio; se
l'hotspot viene acceso dopo l'avvio di Windows e non rispondono, rieseguirlo.
#>
param([switch]$Remove)
$ErrorActionPreference = 'Stop'
$HotspotIp = '192.168.137.1'
$Ports = 19001, 1881   # broker MQTT (WebSocket) e Node-RED, entrambi in Docker
$RuleName = 'GAIA hotspot - broker e Node-RED'

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Serve un PowerShell aperto come amministratore.' }

foreach ($p in $Ports) {
  netsh interface portproxy delete v4tov4 listenaddress=$HotspotIp listenport=$p 2>$null | Out-Null
}
Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
if ($Remove) { 'Inoltri e regola tolti.'; netsh interface portproxy show v4tov4; return }

if (-not (Get-NetIPAddress -IPAddress $HotspotIp -ErrorAction SilentlyContinue)) {
  Write-Warning "$HotspotIp non c'e': accendi l'hotspot di Windows e rilancia lo script."
}
# il servizio che fa gli inoltri; netsh li applica subito. Niente Restart-Service:
# altri servizi dipendono da iphlpsvc e forzarlo li fermerebbe tutti.
Set-Service iphlpsvc -StartupType Automatic
Start-Service iphlpsvc
foreach ($p in $Ports) {
  netsh interface portproxy add v4tov4 listenaddress=$HotspotIp listenport=$p connectaddress=127.0.0.1 connectport=$p | Out-Null
}
New-NetFirewallRule -DisplayName $RuleName -Direction Inbound -Protocol TCP -LocalPort $Ports `
  -LocalAddress $HotspotIp -RemoteAddress 192.168.137.0/24 -Action Allow -Profile Any | Out-Null

netsh interface portproxy show v4tov4
Start-Sleep 2
foreach ($p in $Ports) {
  $ok = Test-NetConnection $HotspotIp -Port $p -InformationLevel Quiet -WarningAction SilentlyContinue
  "{0}:{1}  {2}" -f $HotspotIp, $p, $(if ($ok) { 'ok' } else { 'NON risponde' })
}
