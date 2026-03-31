"""
Alert dispatcher.
All modules call send_alert() — it POSTs to your n8n webhook which
routes to Slack / email / wherever you've wired it.
Fails silently (logs only) so a dead webhook never crashes the monitor.
"""

import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict

import requests

from config.settings import alerts as cfg

log = logging.getLogger(__name__)

# Deduplication: track last sent time per (event, domain) key.
# Suppresses repeat alerts within DEDUP_WINDOW_SECONDS (default 4 hours).
_last_sent: Dict[str, float] = {}
DEDUP_WINDOW_SECONDS = 4 * 3600


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
    domain = body.get("domain", body.get("domains", [""])[0] if isinstance(body.get("domains"), list) else "")
    dedup_key = f"{event}:{domain}"
    now = time.time()
    if dedup_key in _last_sent and (now - _last_sent[dedup_key]) < DEDUP_WINDOW_SECONDS:
        log.debug("Alert suppressed (dedup, %.0fh window): %s", DEDUP_WINDOW_SECONDS / 3600, subject)
        return False
    _last_sent[dedup_key] = now

    payload = {
        "subject": subject,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "source": "deliverability_monitor",
        **body,
    }

    try:
        r = requests.post(cfg.webhook_url, json=payload, timeout=10)
        if r.status_code in (200, 201, 202):
            log.info("Alert sent: %s", subject)
            return True
        else:
            log.warning("Alert webhook returned %d: %s", r.status_code, r.text[:200])
            return False
    except Exception as e:
        log.error("Alert dispatch failed (%s): %s", subject, e)
        return False
