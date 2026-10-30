<#
Hotspot mobile di Windows senza schermo (touring via SSH, o OPS): i tablet
si collegano e aprono la Plancia su http://192.168.137.1:8080 (vedi
plancia/README.md, "hotspot").

Da PowerShell come AMMINISTRATORE:
  hotspot.ps1 stato
  hotspot.ps1 accendi     (anche senza internet: usa la Ethernet come connessione)
  hotspot.ps1 spegni
  hotspot.ps1 avvio-si    attivita' GAIA-OPS-Hotspot: accende l'hotspot a ogni
                          accesso (Windows non lo riaccende da solo dopo un riavvio)
  hotspot.ps1 avvio-no    toglie l'attivita'
  hotspot.ps1 esporta -File x.json   nome e password di QUESTA macchina in un file
  hotspot.ps1 importa -File x.json   li applica qui (poi cancellare il file:
                                     contiene la password in chiaro)

Accendere l'hotspot NON cambia l'IP della Ethernet: Windows condivide la
connessione e da' 192.168.137.x ai client sul Wi-Fi. La password non viene
mai stampata. Spegnimento automatico senza client disattivato (come su OPS).
#>
param(
  [Parameter(Mandatory = $true, Position = 0)][ValidateSet('stato', 'accendi', 'spegni', 'avvio-si', 'avvio-no', 'esporta', 'importa')][string]$Azione,
  [string]$File
)
$ErrorActionPreference = 'Stop'

$task = 'GAIA-OPS-Hotspot'
if ($Azione -eq 'avvio-si') {
  # 45 s dopo l'accesso: la Ethernet deve essere gia' su per avere una connessione da condividere
  $a = New-ScheduledTaskAction -Execute powershell.exe -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`" accendi"
  $t = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $t.Delay = 'PT45S'
  $s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName $task -Action $a -Trigger $t -Settings $s -User $env:USERNAME -RunLevel Highest -Force | Out-Null
  "attivita' $task registrata: hotspot acceso 45 s dopo ogni accesso di $env:USERNAME"
  return
}
if ($Azione -eq 'avvio-no') {
  Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue
  "attivita' $task tolta"
  return
}

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskOp = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
$asTaskAct = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' })[0]
function Await($op, $type) { $t = $asTaskOp.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
function AwaitAction($op) { $t = $asTaskAct.Invoke($null, @($op)); $t.Wait(-1) | Out-Null }
$null = [Windows.Networking.Connectivity.NetworkInformation, Windows.Networking.Connectivity, ContentType = WindowsRuntime]
$null = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager, Windows.Networking.NetworkOperators, ContentType = WindowsRuntime]

# connessione da condividere: quella con internet, altrimenti la Ethernet
# (show senza rete: l'hotspot serve solo a raggiungere la Plancia)
$conn = [Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()
if (-not $conn) {
  $eth = (Get-NetAdapter -Physical | Where-Object { $_.MediaType -eq '802.3' -and $_.Status -eq 'Up' } | Select-Object -First 1)
  if ($eth) {
    $conn = [Windows.Networking.Connectivity.NetworkInformation]::GetConnectionProfiles() |
      Where-Object { $_.NetworkAdapter -and $_.NetworkAdapter.NetworkAdapterId -eq [guid]$eth.InterfaceGuid } | Select-Object -First 1
  }
}
if (-not $conn) { throw 'Nessuna connessione da condividere (ne internet ne Ethernet collegata).' }
$mgr = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::CreateFromConnectionProfile($conn)

function Show {
  $c = $mgr.GetCurrentAccessPointConfiguration()
  "hotspot: $($mgr.TetheringOperationalState)  client: $($mgr.ClientCount)/$($mgr.MaxClientCount)"
  "nome: $($c.Ssid)  banda: $($c.Band)  password: $($c.Passphrase.Length) caratteri  condivide: $($conn.ProfileName)"
}

# mai spento da solo quando non ci sono client (registro di icssvc, come OPS).
# icssvc lo legge solo quando parte: senza riavviarlo l'hotspot si spegneva
# comunque dopo 5 minuti senza client (touring 2026-10-30).
$key = 'HKLM:\SYSTEM\CurrentControlSet\Services\icssvc\Settings'
if (-not (Test-Path $key)) { New-Item $key -Force | Out-Null }
if ((Get-ItemProperty $key -ErrorAction SilentlyContinue).PeerlessTimeoutEnabled -ne 0) {
  New-ItemProperty $key -Name PeerlessTimeoutEnabled -Value 0 -PropertyType DWord -Force | Out-Null
  'spegnimento automatico senza client: disattivato'
}

switch ($Azione) {
  'stato' { Show }
  'accendi' {
    if ($mgr.TetheringOperationalState -ne 'On') {
      # hotspot spento: riavviare icssvc non toglie niente e gli fa rileggere il registro
      if ((Get-Service icssvc).Status -eq 'Running') {
        Restart-Service icssvc -Force
        $mgr = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::CreateFromConnectionProfile($conn)
      }
      $r = Await ($mgr.StartTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult])
      if ($r.Status -ne 'Success') { throw "Hotspot non acceso: $($r.Status) $($r.AdditionalErrorMessage)" }
    }
    Show
  }
  'spegni' {
    if ($mgr.TetheringOperationalState -ne 'Off') {
      $r = Await ($mgr.StopTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult])
      if ($r.Status -ne 'Success') { throw "Hotspot non spento: $($r.Status) $($r.AdditionalErrorMessage)" }
    }
    Show
  }
  'esporta' {
    if (-not $File) { throw 'Serve -File' }
    $c = $mgr.GetCurrentAccessPointConfiguration()
    @{ ssid = $c.Ssid; passphrase = $c.Passphrase; band = "$($c.Band)" } | ConvertTo-Json | Set-Content -Encoding UTF8 $File
    "esportato in $File (contiene la password: cancellarlo dopo l'uso)"
  }
  'importa' {
    if (-not $File) { throw 'Serve -File' }
    $j = Get-Content $File -Raw -Encoding UTF8 | ConvertFrom-Json
    $c = $mgr.GetCurrentAccessPointConfiguration()
    $c.Ssid = $j.ssid
    $c.Passphrase = $j.passphrase
    AwaitAction ($mgr.ConfigureAccessPointAsync($c))
    Show
  }
}
