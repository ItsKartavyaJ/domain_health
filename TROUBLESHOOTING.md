# Deployment Troubleshooting Log

## 1. Python Package Version Conflicts

**Error:** `pip install` failed because requested versions did not exist or conflicted.

**Fix:** Use the pinned ranges in `deliverability_monitor/requirements.txt`.

## 2. Docker Repo Setup Fails On Debian

**Error:** Docker install failed because the setup script used the wrong apt repo.

**Fix:** `setup.sh` detects the OS dynamically:

```bash
OS_ID=$(. /etc/os-release && echo "$ID")
curl -fsSL "https://download.docker.com/linux/${OS_ID}/gpg" ...
```

## 3. `pip --break-system-packages` Not Supported

**Fix:** Use a Python venv:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## 4. `VM_REPO_ROOT` In `.env` Overrides Setup Paths

**Fix:** Do not set `VM_REPO_ROOT` in `.env`. `setup.sh` derives it from its own location:

```bash
VM_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
```

## 5. `deliverability_monitor.service` Wrong Paths

**Fix:** `setup.sh` generates the systemd service using `${VM_REPO_ROOT}`.

## 6. Bad systemd Unit Setting

**Error:** `Unknown key 'StartLimitIntervalSec' in section [Service]`

**Fix:** `StartLimitIntervalSec` and `StartLimitBurst` belong in the `[Unit]` section.

## 7. `.env` Rejected By systemd `EnvironmentFile`

**Fix:** The service does not use `EnvironmentFile`; the app loads `.env` with `python-dotenv` from its working directory.

## 8. Firewall Ports Blocked

**Error:** `ERR_CONNECTION_TIMED_OUT` on `8086` or `8787`.

**Fix:** Make sure the VM has the right tags and firewall rule:

```bash
gcloud compute instances add-tags domain-health --zone=us-central1-b --tags=http-server,https-server
```

Grafana has been removed, so port `3000` is no longer used.

## 9. `node_modules` Owned By root

**Error:** `EACCES: permission denied` when running `npm run build` as a non-root user.

**Fix:**

```bash
sudo chown -R kartavya_jain:kartavya_jain ~/domain_health
```

## 10. Express 5 Wildcard Route Syntax

**Error:** `PathError: Missing parameter name at index 1: *`

**Fix:**

```js
app.get('/{*path}', ...)
```

## 11. `sudo tee` Heredoc Gets Stuck

**Fix:** The `EOF` marker must have no leading whitespace.
