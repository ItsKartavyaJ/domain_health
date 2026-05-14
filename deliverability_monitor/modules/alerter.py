"""
Alert dispatcher.
All modules call send_alert() — it POSTs to your n8n webhook which
routes to Slack / email / wherever you've wired it.
Fails silently (logs only) so a dead webhook never crashes the monitor.
"""

import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict

import requests

from config.settings import alerts as cfg
from modules.influx_writer import writer as _influx_writer, InfluxWriter

log = logging.getLogger(__name__)

# Deduplication: track last sent time per (event, domain) key.
# Suppresses repeat alerts within DEDUP_WINDOW_SECONDS (default 4 hours).
DEDUP_WINDOW_SECONDS = 4 * 3600
_DEDUP_FILE = Path(os.getenv("ALERT_DEDUP_FILE", "/var/run/deliverability_monitor/alert_dedup.json"))


def _load_dedup() -> Dict[str, float]:
    try:
        if _DEDUP_FILE.exists():
            return json.loads(_DEDUP_FILE.read_text())
    except Exception as e:
        log.warning("Could not load alert dedup state from %s: %s", _DEDUP_FILE, e)
    return {}


def _save_dedup(state: Dict[str, float]) -> None:
    try:
        _DEDUP_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = _DEDUP_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(state))
        os.replace(tmp, _DEDUP_FILE)
    except Exception as e:
        log.warning("Could not persist alert dedup state to %s: %s", _DEDUP_FILE, e)


_last_sent: Dict[str, float] = _load_dedup()


def send_alert(subject: str, body: Dict[str, Any]) -> bool:
    """
    POST alert payload to the configured n8n webhook.
    Returns True if delivered, False otherwise.
    """
    if not cfg.webhook_url:
        log.debug("No ALERT_WEBHOOK_URL configured — alert suppressed: %s", subject)
        return False

    # Deduplicate: suppress re-firing the same (event, domain) within the window.
    event = body.get("event", "unknown")
    # body["domain"] is a plain string; body["domains"] may be a list of strings OR dicts
    _domain_raw = body.get("domain") or ((body.get("domains") or [None])[0])
    if isinstance(_domain_raw, dict):
        domain = str(_domain_raw.get("domain", ""))
    else:
        domain = str(_domain_raw or "")
    dedup_key = f"{event}:{domain}"
    now = time.time()
    if dedup_key in _last_sent and (now - _last_sent[dedup_key]) < DEDUP_WINDOW_SECONDS:
        log.debug("Alert suppressed (dedup, %.0fh window): %s", DEDUP_WINDOW_SECONDS / 3600, subject)
        return False
    _last_sent[dedup_key] = now
    _save_dedup(_last_sent)

    payload = {
        "subject": subject,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "source": "deliverability_monitor",
        **body,
    }

    delivered = False
    try:
        r = requests.post(cfg.webhook_url, json=payload, timeout=10)
        if r.status_code in (200, 201, 202):
            log.info("Alert sent: %s", subject)
            delivered = True
        else:
            log.warning("Alert webhook returned %d: %s", r.status_code, r.text[:200])
    except Exception as e:
        log.error("Alert dispatch failed (%s): %s", subject, e)

    try:
        _influx_writer.write_points([InfluxWriter.alert_point(
            event=event, domain=domain, subject=subject, sent=delivered,
        )])
    except Exception as e:
        log.warning("Failed to write alert history to InfluxDB: %s", e)

    return delivered
