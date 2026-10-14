# Torna alla normalita' di casa: ferma il DHCP server Gaia e rimette
# l'adattatore Ethernet in DHCP client (IP preso dal router di casa).
#
# Uso: aprire PowerShell come amministratore, eseguire questo script.

$ErrorActionPreference = "Stop"
$IFACE = "Ethernet"

Write-Output "=== Fermo dhcp_server.py ==="
Get-CimInstance Win32_Process |
    Where-Object { $_.CommandLine -like "*dhcp_server.py*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Write-Output "=== Rimetto '$IFACE' in DHCP client ==="
Set-NetIPInterface -InterfaceAlias $IFACE -Dhcp Enabled
Get-NetIPAddress -InterfaceAlias $IFACE -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.PrefixOrigin -eq "Manual" } |
    Remove-NetIPAddress -Confirm:$false -ErrorAction SilentlyContinue

ipconfig /renew "$IFACE" | Out-Null
Write-Output "Fatto. IP attuale:"
Get-NetIPConfiguration -InterfaceAlias $IFACE | Select-Object InterfaceAlias, IPv4Address
