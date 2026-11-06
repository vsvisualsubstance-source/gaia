# OPS a casa, sulla rete del router (Fastweb 192.168.1.254, che fa da DHCP):
# spegne la "Gaia LAN" di trasferta SENZA cambiare l'IP di OPS.
#   - ferma e disattiva la Scheduled Task GAIA-OPS-LAN-Activate (ogni 5 minuti
#     riaccendeva il DHCP di OPS: il suo controllo guarda solo se OPS e' client
#     DHCP, e con l'IP statico non vede il router -> due DHCP sulla stessa rete)
#   - ferma dhcp_server.py
#   - lascia 192.168.1.240 statico (MQTT, tablet, TD lo cercano li') ma aggiunge
#     gateway e DNS del router, cosi' OPS naviga anche in IPv4
# Trovato il 2026-11-06: telefoni e tablet prendevano l'IP da OPS (gateway .240,
# nessun DNS) e non navigavano; OPS stesso senza gateway IPv4 (GitHub irraggiungibile).
#
# Uso: PowerShell COME AMMINISTRATORE:  C:\gaia\ops\dhcp\gaia_lan_home.ps1
# Per tornare alla rete di trasferta: Enable-ScheduledTask GAIA-OPS-LAN-Activate
# (e togliere il gateway: Remove-NetRoute -DestinationPrefix 0.0.0.0/0 -InterfaceAlias Ethernet)

$ErrorActionPreference = "Stop"
$IFACE = "Ethernet"
$ROUTER = if ($env:GAIA_ROUTER) { $env:GAIA_ROUTER } else { "192.168.1.254" }

Write-Output "=== Scheduled Task GAIA-OPS-LAN-Activate: ferma e disattiva ==="
$t = Get-ScheduledTask -TaskName "GAIA-OPS-LAN-Activate" -ErrorAction SilentlyContinue
if ($t) { Stop-ScheduledTask -TaskName $t.TaskName -ErrorAction SilentlyContinue; Disable-ScheduledTask -TaskName $t.TaskName | Out-Null; Write-Output "disattivata" }
else { Write-Output "non c'e'" }

Write-Output "=== Fermo dhcp_server.py (solo quello) ==="
Get-CimInstance Win32_Process |
    Where-Object { $_.Name -like "python*" -and $_.CommandLine -like "*dhcp_server.py*" } |
    ForEach-Object { Write-Output "  PID $($_.ProcessId)"; Stop-Process -Id $_.ProcessId -Force }
# controllo: nessuno deve piu' ascoltare sulla porta 67 di .240
$still = Get-NetUDPEndpoint -LocalAddress 192.168.1.240 -LocalPort 67 -ErrorAction SilentlyContinue
if ($still) { Write-Output "ATTENZIONE: porta 67 ancora occupata dal PID $($still.OwningProcess)" }

Write-Output "=== Gateway e DNS del router su '$IFACE' (IP .240 invariato) ==="
if (-not (Get-NetRoute -InterfaceAlias $IFACE -DestinationPrefix 0.0.0.0/0 -ErrorAction SilentlyContinue)) {
    New-NetRoute -InterfaceAlias $IFACE -DestinationPrefix 0.0.0.0/0 -NextHop $ROUTER | Out-Null
}
Set-DnsClientServerAddress -InterfaceAlias $IFACE -ServerAddresses $ROUTER
Clear-DnsClientCache

Write-Output "=== Verifica ==="
Get-NetIPConfiguration -InterfaceAlias $IFACE | Select-Object InterfaceAlias, IPv4Address, IPv4DefaultGateway, DNSServer | Format-List
try { Resolve-DnsName github.com -Type A -ErrorAction Stop | Select-Object -First 1 Name, IPAddress | Format-Table -AutoSize } catch { Write-Output "DNS: $($_.Exception.Message)" }
Test-NetConnection github.com -Port 443 -InformationLevel Quiet
