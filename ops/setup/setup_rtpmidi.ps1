<#
rtpMIDI su OPS (o sulla touring): MIDI in rete (RTP-MIDI / AppleMIDI) come
porte MIDI normali di Windows. La Plancia apre da sola le porte in ingresso
(plancia/midi-in.js); in uscita si sceglie con MIDI_OUT.

Da PowerShell come AMMINISTRATORE:
  powershell -ExecutionPolicy Bypass -File C:\gaia\ops\setup\setup_rtpmidi.ps1

Idempotente: se rtpMIDI c'e' gia' lo dice e non reinstalla. Scarica il
pacchetto ufficiale di Tobias Erichsen, controlla la firma digitale e lo
installa senza finestre (installatore WiX). Dopo, una volta sola a mano:
aprire rtpMIDI, creare la sessione "OPS" e attivarla (vedi la fine).
#>
$ErrorActionPreference = 'Stop'
$Url = 'https://www.tobias-erichsen.de/wp-content/uploads/2020/01/rtpMIDISetup_1_1_14_247.zip'
$Signer = 'CN=Tobias Erichsen'

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Serve un PowerShell aperto come amministratore.' }

function Find-RtpMidi {
  Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -match '^rtpMIDI' } | Select-Object -First 1
}

$found = Find-RtpMidi
if ($found) {
  "rtpMIDI gia' installato: $($found.DisplayName) $($found.DisplayVersion)"
} else {
  $dir = Join-Path $env:TEMP "rtpmidi-setup-$(Get-Random)"
  New-Item -ItemType Directory $dir | Out-Null
  "Scarico $Url"
  Invoke-WebRequest $Url -OutFile "$dir\rtpmidi.zip" -UseBasicParsing
  Expand-Archive "$dir\rtpmidi.zip" "$dir\x"
  $exe = Get-ChildItem "$dir\x" -Recurse -Filter 'rtpMIDISetup*.exe' | Select-Object -First 1
  if (-not $exe) { throw "Nel pacchetto non c'e' rtpMIDISetup.exe" }
  $sig = Get-AuthenticodeSignature $exe.FullName
  if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch [regex]::Escape($Signer)) {
    throw "Firma non valida o di un altro autore ($($sig.Status), $($sig.SignerCertificate.Subject)): non installo."
  }
  "Firma valida: $Signer. Installo (puo' comparire la richiesta di Windows per il driver: Installa)..."
  $log = "$dir\install.log"
  $p = Start-Process $exe.FullName -ArgumentList '/quiet', '/norestart', '/log', "`"$log`"" -Wait -PassThru
  if ($p.ExitCode -notin 0, 3010) { throw "Installazione fallita (codice $($p.ExitCode)), log: $log" }
  if ($p.ExitCode -eq 3010) { Write-Warning 'Installato: Windows chiede un riavvio per finire (driver).' }
  $found = Find-RtpMidi
  if (-not $found) { throw "Installazione terminata ma rtpMIDI non risulta installato, log: $log" }
  "Installato: $($found.DisplayName) $($found.DisplayVersion)"
}

# firewall: RTP-MIDI usa UDP (sessione 5004/5005 di default) e Bonjour (5353)
$app = Get-ChildItem "${env:ProgramFiles(x86)}\Tobias Erichsen", "$env:ProgramFiles\Tobias Erichsen" -Recurse -Filter 'rtpMIDI.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($app) {
  $rule = 'GAIA rtpMIDI'
  Get-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -DisplayName $rule -Direction Inbound -Program $app.FullName -Action Allow -Profile Private, Domain | Out-Null
  "Firewall: rtpMIDI ammesso in ingresso sulle reti private ($($app.FullName))"
  # avvio con Windows: rtpMIDI resta nell'area di notifica e tiene aperte le sessioni
  $run = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run'
  if (-not (Get-ItemProperty $run -Name 'rtpMIDI' -ErrorAction SilentlyContinue)) {
    New-ItemProperty $run -Name 'rtpMIDI' -Value "`"$($app.FullName)`"" -PropertyType String | Out-Null
    'Avvio automatico con Windows: aggiunto'
  } else { 'Avvio automatico con Windows: gia'' presente' }
} else { Write-Warning 'rtpMIDI.exe non trovato: firewall e avvio automatico da sistemare a mano.' }

@'

Fatto. Una volta sola, a mano (interfaccia di rtpMIDI):
  1. Apri rtpMIDI (area di notifica o menu Start).
  2. "My Sessions" -> "+" -> nome della sessione: OPS (diventa la porta MIDI "OPS").
  3. Spunta "Enabled". In "Who may connect to me": Anyone.
  4. Dal Mac: Configurazione MIDI Audio -> Rete -> si vede "OPS" -> Connetti.
     Da un altro PC con rtpMIDI: la sessione OPS compare in "Directory" -> Connect.
La Plancia apre la porta "OPS" da sola entro pochi secondi (in Impostazioni ->
MIDI in ingresso). Per mandare MIDI in rete: MIDI_OUT=OPS in run_plancia.bat.
'@
