#!/usr/bin/env bash
# One-time SSH setup for the domain-health GCP VM.
# Generates a dedicated keypair, prints the pubkey to paste on the VM,
# writes an ~/.ssh/config entry, and verifies the connection.
#
# Usage: bash scripts/setup-vm-ssh.sh
set -euo pipefail

VM_USER="${VM_USER:-kartavya_jain}"
VM_HOST="${VM_HOST:-35.192.170.220}"
VM_PORT="${VM_PORT:-22}"
HOST_ALIAS="${HOST_ALIAS:-pintel-vm}"
KEY_PATH="${KEY_PATH:-$HOME/.ssh/pintel_vm}"

mkdir -p "$(dirname "$KEY_PATH")"
chmod 700 "$(dirname "$KEY_PATH")" 2>/dev/null || true

if [[ -f "$KEY_PATH" ]]; then
  echo "[1/4] Key already exists: $KEY_PATH"
else
  echo "[1/4] Generating ed25519 key at $KEY_PATH"
  ssh-keygen -t ed25519 -f "$KEY_PATH" -N "" -C "claude-code@$(hostname)"
fi

PUBKEY="$(cat "${KEY_PATH}.pub")"

echo
echo "[2/4] Public key (add this to the VM):"
echo "----------------------------------------"
echo "$PUBKEY"
echo "----------------------------------------"
echo
echo "On the VM, run ONCE:"
echo "  mkdir -p ~/.ssh && chmod 700 ~/.ssh"
echo "  echo '$PUBKEY' >> ~/.ssh/authorized_keys"
echo "  chmod 600 ~/.ssh/authorized_keys"
echo

CONFIG="$HOME/.ssh/config"
touch "$CONFIG"
chmod 600 "$CONFIG"

if grep -q "^Host $HOST_ALIAS\$" "$CONFIG" 2>/dev/null; then
  echo "[3/4] ~/.ssh/config already has entry for '$HOST_ALIAS' (leaving as-is)"
else
  echo "[3/4] Appending entry to $CONFIG"
  cat >> "$CONFIG" <<EOF

Host $HOST_ALIAS
  HostName $VM_HOST
  User $VM_USER
  Port $VM_PORT
  IdentityFile $KEY_PATH
  IdentitiesOnly yes
  ServerAliveInterval 30
EOF
fi

echo
echo "[4/4] Testing connection..."
if ssh -o BatchMode=yes -o ConnectTimeout=5 "$HOST_ALIAS" 'echo OK && whoami && hostname' 2>/dev/null; then
  echo
  echo "Success. You can now run:  ssh $HOST_ALIAS '<command>'"
else
  echo
  echo "Connection failed (expected if pubkey not yet added to the VM)."
  echo "After adding the key on the VM, re-run this script or test with:"
  echo "  ssh $HOST_ALIAS 'echo OK'"
  exit 1
fi
