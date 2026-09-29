<#
GAIA — setup di una nuova macchina Windows per il contratto agent
(docs/agent-windows-contract.md). Da eseguire UNA VOLTA, come amministratore,
dopo aver copiato il contenuto di questa cartella (o di minipc/installation/,
a seconda del ruolo) in C:\gaia\<ruolo>\agent\.

Fa SOLO setup di sistema (SSH, firewall, Task Scheduler) -- non tocca
services.json/requirements.txt, che restano da adattare a mano alla
macchina (path .exe, device_id, stanza) come sempre.

Uso (PowerShell come amministratore):
    powershell -ExecutionPolicy Bypass -File setup_windows.ps1 -AgentDir "C:\gaia\ops\agent" -AgentUser "vsvis"

Parametri:
  -AgentDir   Cartella dove vive agent.py/run_agent_hidden.vbs su QUESTA
              macchina (es. C:\gaia\ops\agent o C:\gaia\minipc\installation).
  -AgentUser  Utente Windows sotto cui gira il task "AtLogOn" (di solito
              l'utente gia' loggato che userà la macchina).
  -SkipSSH    Salta la parte OpenSSH (se gia' installato/configurato a mano).
#>
param(
    [Parameter(Mandatory = $true)][string]$AgentDir,
    [Parameter(Mandatory = $true)][string]$AgentUser,
    [switch]$SkipSSH
)

$ErrorActionPreference = "Stop"

function Section($title) {
    Write-Host ""
    Write-Host "=== $title ===" -ForegroundColor Cyan
}

# ── 1. OpenSSH Server ──────────────────────────────────────────────────
# Controllo totale via SSH su ogni macchina Windows, stesso principio gia'
# applicato a Core (2026-09-29): niente RDP/AnyDesk come unico accesso.
if (-not $SkipSSH) {
    Section "OpenSSH Server"
    $cap = Get-WindowsCapability -Online -Name OpenSSH.Server*
    if ($cap.State -ne "Installed") {
        Write-Host "Installo OpenSSH.Server..."
        Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0 | Out-Null
    } else {
        Write-Host "OpenSSH.Server gia' installato."
    }
    Set-Service -Name sshd -StartupType Automatic
    Start-Service sshd -ErrorAction SilentlyContinue

    $rule = Get-NetFirewallRule -Name "OpenSSH-Server-In-TCP" -ErrorAction SilentlyContinue
    if (-not $rule) {
        New-NetFirewallRule -Name "OpenSSH-Server-In-TCP" -DisplayName "OpenSSH Server (sshd)" `
            -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 | Out-Null
        Write-Host "Regola firewall porta 22 creata."
    } else {
        Write-Host "Regola firewall porta 22 gia' presente."
    }

    # Chiave pubblica di Core (~/.ssh/id_ed25519 su core-node-0, commento
    # "core-node-0-to-pi") -- STESSA chiave usata per Pi/OPS/installazioni,
    # cosi' Core si logga ovunque senza password. Va aggiunta a mano qui
    # (non hardcoded nello script: la chiave pubblica non e' un segreto ma
    # non appartiene a questo repo) -- vedi docs/agent-windows-contract.md
    # per il valore esatto da incollare.
    $authKeysPath = "$env:ProgramData\ssh\administrators_authorized_keys"
    Write-Host "Ricorda: aggiungi la chiave pubblica di Core a $authKeysPath" -ForegroundColor Yellow
    Write-Host "(poi: icacls `"$authKeysPath`" /inheritance:r; icacls `"$authKeysPath`" /grant SYSTEM:F /grant Administrators:F)" -ForegroundColor Yellow
}

# ── 2. Task Scheduler — avvio nascosto dell'agent al login ─────────────
Section "Task Scheduler (AtLogOn, nascosto)"
$taskName = "GAIA-Agent"
$vbsPath  = Join-Path $AgentDir "run_agent_hidden.vbs"
if (-not (Test-Path $vbsPath)) {
    Write-Warning "run_agent_hidden.vbs non trovato in $AgentDir -- copialo prima di continuare."
} else {
    $action  = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$vbsPath`"" -WorkingDirectory $AgentDir
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $AgentUser
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
        -User $AgentUser -RunLevel Highest -Force | Out-Null
    Write-Host "Task '$taskName' registrato (AtLogOn, utente $AgentUser)."
}

# ── 3. Power: nessuna sospensione automatica ────────────────────────────
# Il contratto gestisce accensione/spegnimento via MQTT/Task Scheduler
# software (agent.py: reboot/shutdown/shutdown_at) -- una sospensione
# automatica di Windows lo renderebbe irraggiungibile senza intervento
# fisico (Wake-on-LAN non e' garantito su tutte le schede).
Section "Power plan"
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
Write-Host "Sospensione/ibernazione automatica disabilitata (alimentazione rete)."

Section "Fatto"
Write-Host "Prossimi passi manuali:"
Write-Host "  1. Chiave pubblica SSH di Core in administrators_authorized_keys (sopra)."
Write-Host "  2. services.json: device_id/stanza/path .exe reali di QUESTA macchina."
Write-Host "  3. requirements.txt: pip install -r (venv solo se la macchina ha bisogno"
Write-Host "     di dipendenze ML pesanti, altrimenti Python di sistema -- vedi contratto)."
Write-Host "  4. Tailscale: 'tailscale up', join alla tailnet gaia."
Write-Host "  5. Riavvia la macchina e verifica GET /gaia/devices/profiles su OPS."
