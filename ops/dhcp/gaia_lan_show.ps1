# Rete dello SHOW su questo PC (OPS o touring), l'inverso di gaia_lan_home.ps1 (20/11/2026):
# switch isolato senza router, questo PC fa da DHCP per laser, PC di Nicola (.73), tablet;
# internet (se serve) solo dal Wi-Fi.
#   1. CONTROLLO: il router di casa (.254) NON deve rispondere sul cavo. Se risponde, esce senza
#      toccare niente (due DHCP sulla stessa rete = telefoni e PC di casa senza internet, 06/11).
#   2. Cavo: IP statico 192.168.1.240 invariato, SENZA gateway ne' DNS (internet dal Wi-Fi).
#   3. Rete del cavo -> Privata: senza router Windows la vede "non identificata" e la fa Pubblica,
#      e sulle reti Pubbliche broker 11883/19001 e porte Docker non si vedono dagli altri PC.
#   4. Avvia il DHCP Gaia (Scheduled Task GAIA-OPS-DHCP, dhcp_server.py, prenotazioni da
#      minipc/network/gaia-demo-dnsmasq.conf). La task GAIA-OPS-LAN-Activate resta com'e'.
#
# Uso: PowerShell COME AMMINISTRATORE:  C:\gaia\ops\dhcp\gaia_lan_show.ps1
#      -Forza: va avanti anche se il router risponde (deciso dall'operatore, es. router raggiungibile
#      ma senza DHCP su quel cavo); stampa solo un avviso.
# Per tornare a casa (router ricollegato):  C:\gaia\ops\dhcp\gaia_lan_home.ps1

param([switch]$Forza)
$ErrorActionPreference = "Stop"
$IFACE = "Ethernet"
$IP = "192.168.1.240"
$ROUTER = if ($env:GAIA_ROUTER) { $env:GAIA_ROUTER } else { "192.168.1.254" }

$ip = Get-NetIPAddress -InterfaceAlias $IFACE -AddressFamily IPv4 -ErrorAction SilentlyContinue | ? { $_.IPAddress -eq $IP }
if (-not $ip) { Write-Output "ERRORE: '$IFACE' non ha $IP. Nessuna modifica."; exit 1 }
if ((Get-NetAdapter -Name $IFACE).Status -ne 'Up') { Write-Output "ERRORE: cavo '$IFACE' scollegato. Nessuna modifica."; exit 1 }

Write-Output "=== 1. Il router $ROUTER e' ancora sul cavo? ==="
# solo dal cavo (sorgente .240): il ping semplice puo' arrivare al router anche dal Wi-Fi (20/11)
$alive = [bool](ping.exe -n 2 -w 800 -S $IP $ROUTER | Select-String "TTL=")
$arp = Get-NetNeighbor -InterfaceAlias $IFACE -IPAddress $ROUTER -ErrorAction SilentlyContinue | ? { $_.State -in 'Reachable','Stale','Delay','Probe','Permanent' -and $_.LinkLayerAddress -ne '00-00-00-00-00-00' }
if ($alive -and $Forza) {
    Write-Output "AVVISO: $ROUTER risponde, vado avanti lo stesso (-Forza). Se il router fa DHCP su questo cavo, i dispositivi di casa possono prendere l'IP da qui."
} elseif ($alive) {
    Write-Output "ATTENZIONE: $ROUTER risponde: il router di casa e' ancora collegato. Staccalo dallo switch e rilancia (o rilancia con -Forza)."
    Write-Output "Nessuna modifica fatta."
    exit 1
}
else { Write-Output "il router non risponde: ok$(if ($arp) { " (resta in cache ARP: $($arp.LinkLayerAddress), vecchio)" })" }

Write-Output "=== 2. Cavo senza gateway ne' DNS (internet dal Wi-Fi) ==="
Get-NetRoute -InterfaceAlias $IFACE -DestinationPrefix 0.0.0.0/0 -ErrorAction SilentlyContinue | Remove-NetRoute -Confirm:$false
Set-DnsClientServerAddress -InterfaceAlias $IFACE -ResetServerAddresses
Clear-DnsClientCache

Write-Output "=== 3. Rete del cavo -> Privata ==="
Set-NetConnectionProfile -InterfaceAlias $IFACE -NetworkCategory Private

Write-Output "=== 4. DHCP Gaia ==="
$run = Get-CimInstance Win32_Process | ? { $_.Name -like "python*" -and $_.CommandLine -like "*dhcp_server.py*" }
if ($run) { Write-Output "gia' attivo (PID $($run.ProcessId))" }
else {
    Enable-ScheduledTask -TaskName "GAIA-OPS-DHCP" | Out-Null
    Start-ScheduledTask -TaskName "GAIA-OPS-DHCP"
    Start-Sleep 3
}

Write-Output "=== Verifica ==="
Get-NetConnectionProfile -InterfaceAlias $IFACE | Select InterfaceAlias, NetworkCategory | Format-Table -AutoSize
Get-NetRoute -AddressFamily IPv4 -DestinationPrefix 0.0.0.0/0 | Select InterfaceAlias, NextHop | Format-Table -AutoSize
$u = Get-NetUDPEndpoint -LocalPort 67 -ErrorAction SilentlyContinue
if ($u) { Write-Output "DHCP in ascolto su $($u.LocalAddress):67 (PID $($u.OwningProcess))" } else { Write-Output "ATTENZIONE: nessuno in ascolto sulla porta 67" }
Get-Content C:\gaia\ops\dhcp\dhcp_server.log -Tail 12
