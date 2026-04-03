# Deployment Troubleshooting Log

## 1. Grafana image not found
**Error:** `manifest unknown` when pulling `grafana/grafana:10.4-ubuntu`
**Fix:** Tag `10.4-ubuntu` doesn't exist. Changed to `10.4.0` in `parsedmarc-stack/docker-compose.yml`.

---

## 2. Python package version conflicts
**Error:** `pip install` failed — `pydnsbl>=1.3.2`, `checkdmarc>=8.0.0`, `aiodns>=4.0.0` don't exist
**Fix:** Corrected versions in `deliverability_monitor/requirements.txt`:
- `pydnsbl>=1.1.7` (max available)
- `checkdmarc>=5.13.4` (max available)
- `aiodns>=3.1.0,<4` (v4 conflicts with pydnsbl)

---

## 3. Docker repo setup fails on Debian
**Error:** Docker install failed because setup.sh hardcoded the Ubuntu apt repo
**Fix:** Changed setup.sh to detect OS dynamically:
```bash
OS_ID=$(. /etc/os-release && echo "$ID")
curl -fsSL "https://download.docker.com/linux/${OS_ID}/gpg" ...
```

---

## 4. `pip --break-system-packages` not supported
**Error:** Older pip versions don't support `--break-system-packages`
**Fix:** Switched to a Python venv in setup.sh:
```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

---

## 5. `VM_REPO_ROOT` in `.env` overrides setup.sh variable
**Error:** setup.sh sourced `.env` with `set -a`, which overwrote the hardcoded `VM_REPO_ROOT=/opt/domain_health` with the value from `.env`, breaking all paths
**Fix:** Removed `VM_REPO_ROOT` from `.env`. Changed setup.sh to derive it dynamically from the script's own location:
```bash
VM_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
```

---

## 6. `deliverability_monitor.service` — wrong paths
**Error:** Service failed with `Failed to load environment files: No such file or directory`
**Cause:** Static service file had hardcoded `/opt/domain_health` paths, but repo was cloned to `~/domain_health`
**Fix:** setup.sh now generates the service file dynamically using `${VM_REPO_ROOT}`:
```ini
WorkingDirectory=${VM_REPO_ROOT}/deliverability_monitor
ExecStart=${VM_REPO_ROOT}/deliverability_monitor/.venv/bin/python ...
```

---

## 7. `deliverability_monitor.service` — bad unit file setting
**Error:** `Unknown key 'StartLimitIntervalSec' in section [Service]`
**Fix:** Moved `StartLimitIntervalSec` and `StartLimitBurst` to the `[Unit]` section where they belong.

---

## 8. `deliverability_monitor.service` — EnvironmentFile syntax rejection
**Error:** systemd's `EnvironmentFile` couldn't parse the root `.env` (quotes, special chars)
**Fix:** Removed `EnvironmentFile` from the service entirely — the app loads env via `python-dotenv` from its working directory, which is sufficient.

---

## 9. Firewall ports blocked
**Error:** `ERR_CONNECTION_TIMED_OUT` on ports 3000, 8086, 8787
**Cause:** New VM had no network tags, so the existing firewall rule didn't apply
**Fix:** Added tags to the VM:
```bash
gcloud compute instances add-tags domain-health --zone=us-central1-b --tags=http-server,https-server
```

---

## 10. `node_modules` owned by root after `sudo bash setup.sh`
**Error:** `EACCES: permission denied` when running `npm run build` as non-root user
**Fix:** Fix ownership before building:
```bash
sudo chown -R kartavya_jain:kartavya_jain ~/domain_health
```

---

## 11. Express 5 wildcard route syntax
**Error:** `PathError: Missing parameter name at index 1: *` — `dmarc_dashboard_api` crash-looping
**Cause:** Express 5 / path-to-regexp v8 broke the old `'*'` wildcard syntax
**Fix:** Updated `dmarc-dashboard/server/index.js`:
```js
// Before
app.get('*', ...)
// After
app.get('/{*path}', ...)
```

---

## 12. `sudo tee` heredoc gets stuck
**Symptom:** Terminal hangs after running `sudo tee ... << 'EOF'` — the `EOF` marker was indented
**Fix:** `EOF` must have **no leading whitespace**. Alternatively, use `cp` from the repo or write via Python:
```bash
sudo python3 -c "open('/path/file', 'w').write('...')"
```
