# One-time SSH setup for the domain-health GCP VM (PowerShell).
# Generates a dedicated keypair, prints the pubkey to paste on the VM,
# writes a %USERPROFILE%\.ssh\config entry, and verifies the connection.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\setup-vm-ssh.ps1

param(
  [string]$VmUser    = "kartavya_jain",
  [string]$VmHost    = "35.192.170.220",
  [int]   $VmPort    = 22,
  [string]$HostAlias = "pintel-vm",
  [string]$KeyPath   = (Join-Path $env:USERPROFILE ".ssh\pintel_vm")
)

$ErrorActionPreference = "Stop"

$SshDir = Split-Path $KeyPath -Parent
if (-not (Test-Path $SshDir)) {
  New-Item -ItemType Directory -Path $SshDir -Force | Out-Null
}

if (Test-Path $KeyPath) {
  Write-Host "[1/4] Key already exists: $KeyPath"
} else {
  Write-Host "[1/4] Generating ed25519 key at $KeyPath"
  ssh-keygen -t ed25519 -f $KeyPath -N '""' -C "claude-code@$env:COMPUTERNAME"
}

$PubKey = (Get-Content "$KeyPath.pub" -Raw).Trim()

Write-Host ""
Write-Host "[2/4] Public key (add this to the VM):"
Write-Host "----------------------------------------"
Write-Host $PubKey
Write-Host "----------------------------------------"
Write-Host ""
Write-Host "On the VM, run ONCE:"
Write-Host "  mkdir -p ~/.ssh && chmod 700 ~/.ssh"
Write-Host "  echo '$PubKey' >> ~/.ssh/authorized_keys"
Write-Host "  chmod 600 ~/.ssh/authorized_keys"
Write-Host ""

$Config = Join-Path $SshDir "config"
if (-not (Test-Path $Config)) { New-Item -ItemType File -Path $Config -Force | Out-Null }

$existing = Get-Content $Config -ErrorAction SilentlyContinue
if ($existing -match "^Host $HostAlias\s*$") {
  Write-Host "[3/4] $Config already has entry for '$HostAlias' (leaving as-is)"
} else {
  Write-Host "[3/4] Appending entry to $Config"
  $entry = @"

Host $HostAlias
  HostName $VmHost
  User $VmUser
  Port $VmPort
  IdentityFile $KeyPath
  IdentitiesOnly yes
  ServerAliveInterval 30
"@
  Add-Content -Path $Config -Value $entry
}

# Windows OpenSSH rejects files with inherited/group ACEs (e.g. "OWNER RIGHTS").
# Strip inheritance and grant the current user exclusive access on both files.
Write-Host "[3.5/4] Locking down ACLs on key + config"
foreach ($f in @($Config, $KeyPath)) {
  if (Test-Path $f) {
    icacls $f /inheritance:r | Out-Null
    icacls $f /grant:r "$($env:USERNAME):(F)" | Out-Null
  }
}

Write-Host ""
Write-Host "[4/4] Testing connection..."
$result = ssh -o BatchMode=yes -o ConnectTimeout=5 $HostAlias "echo OK && whoami && hostname" 2>$null
if ($LASTEXITCODE -eq 0) {
  Write-Host $result
  Write-Host ""
  Write-Host "Success. You can now run:  ssh $HostAlias '<command>'"
} else {
  Write-Host ""
  Write-Host "Connection failed (expected if pubkey not yet added to the VM)."
  Write-Host "After adding the key on the VM, test with:"
  Write-Host "  ssh $HostAlias 'echo OK'"
  exit 1
}
