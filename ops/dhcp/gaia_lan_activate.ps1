# Attiva la "Gaia LAN" su OPS: IP statico sull'adattatore Ethernet + avvio
# del mini DHCP server Python (dhcp_server.py) per gli altri device Gaia.
#
# Richiamato in automatico ogni 5 minuti dalla Scheduled Task
# GAIA-OPS-LAN-Activate (2026-10-14, richiesto dopo il test reale in
# trasferta: prima andava rilanciato a mano ad ogni riavvio di OPS) --
# per questo e' scritto per essere IDEMPOTENTE, sicuro da richiamare anche
# se e' gia' tutto attivo. Prima di toccare la config di rete controlla
# sempre che non ci sia GIA' un DHCP server estraneo su questo link (rete
# di casa, es. router) -- se c'e', un secondo DHCP server darebbe IP in
# conflitto a QUALSIASI device della rete, non solo quelli Gaia. In quel
# caso esce senza cambiare nulla.

$ErrorActionPreference = "Stop"
$IFACE = "Ethernet"
$STATIC_IP = "192.168.1.240"
$MASK = "255.255.255.0"
$PREFIX = 24

$alreadyRunning = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like "python*" -and $_.CommandLine -like "*dhcp_server.py*" }
if ($alreadyRunning) {
    Write-Output "Gia' attivo (dhcp_server.py in esecuzione), nessuna modifica."
    exit 0
}

Write-Output "=== Controllo rete attuale su '$IFACE' ==="
$cfg = Get-NetIPConfiguration -InterfaceAlias $IFACE -ErrorAction SilentlyContinue
$dhcpServer = (Get-NetIPInterface -InterfaceAlias $IFACE -AddressFamily IPv4 -ErrorAction SilentlyContinue).Dhcp

if ($dhcpServer -eq "Enabled") {
    $leaseInfo = ipconfig /all | Select-String -Pattern "DHCP Server" -Context 0,0
    $currentIp = ($cfg.IPv4Address | Select-Object -First 1).IPAddress
    if ($currentIp -and -not ($currentIp -like "169.254.*")) {
        Write-Output "ATTENZIONE: trovato un DHCP server esterno attivo su '$IFACE' (IP attuale: $currentIp)."
        Write-Output "Questo e' quasi certamente la rete di casa (router) o Core con dnsmasq."
        Write-Output "Non attivo il DHCP server Gaia per evitare conflitti. Nessuna modifica fatta."
        exit 1
    }
}

Write-Output "Nessun DHCP server esterno rilevato (adattatore senza lease valida, es. APIPA 169.254.x.x o scollegato)."
Write-Output "=== Imposto IP statico $STATIC_IP/$PREFIX su '$IFACE' ==="

Get-NetIPAddress -InterfaceAlias $IFACE -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.PrefixOrigin -ne "WellKnown" } |
    Remove-NetIPAddress -Confirm:$false -ErrorAction SilentlyContinue

Set-NetIPInterface -InterfaceAlias $IFACE -Dhcp Disabled
New-NetIPAddress -InterfaceAlias $IFACE -IPAddress $STATIC_IP -PrefixLength $PREFIX -ErrorAction Stop | Out-Null

# New-NetIPAddress classifica di default la rete come "Public" -- Docker
# Desktop (HNS, WSL2 networkingMode=mirrored) non espone le porte dei
# container sulle interfacce Public, quindi senza questo passo
# gaia-portable-nodered/mosquitto resterebbero raggiungibili solo in
# loopback (127.0.0.1), non dal resto della Gaia LAN. Trovato dal vivo
# 2026-10-14, primo test reale in trasferta (router staccato).
Write-Output "=== Categoria rete '$IFACE' -> Private (serve a Docker/HNS per esporre le porte) ==="
Set-NetConnectionProfile -InterfaceAlias $IFACE -NetworkCategory Private

Write-Output "=== Avvio GAIA-OPS-DHCP (Scheduled Task) ==="
schtasks /run /tn GAIA-OPS-DHCP

Write-Output "Fatto. Verifica con: Get-Content C:\gaia\ops\dhcp\dhcp_server.log -Tail 20"
