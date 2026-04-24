"""
Reconnect Monitor
Checks every connected email account for failed/disconnected OAuth status.
Fires an alert immediately when any account needs reconnecting — before
campaigns silently stop sending.

Endpoint: GET /email-accounts/  (uses status field per account)

InfluxDB measurement: mailbox_status
  tags:  email, domain, account_id
  fields: status (string), connected (0/1), needs_reconnect (0/1)

Run standalone:  python -m modules.reconnect_monitor
Called by:       scheduler.py every RECONNECT_INTERVAL_HOURS
"""

import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List

from influxdb_client import Point, WritePrecision

from config.settings import smartlead as sl_cfg
from modules.domain_discovery import get_mailboxes
from modules.influx_writer import writer
from modules.alerter import send_alert

log = logging.getLogger(__name__)

# Status strings Smartlead uses for a healthy connected account.
# Everything not in this set is considered a problem.
HEALTHY_STATUSES = {"connected", "active", "1", "true", "ok"}
_RECONNECT_STATUSES: frozenset = frozenset(s.lower() for s in sl_cfg.reconnect_alert_statuses)


def _normalize_status(raw_status: Any) -> str:
    """Normalize whatever Smartlead sends as status to a clean string."""
    if raw_status is None:
        return "unknown"
    s = str(raw_status).lower().strip()
    # Smartlead may return booleans, ints, or strings
    if s in ("true", "1", "connected", "active"):
        return "connected"
    if s in ("false", "0"):
        return "disconnected"
    return s  # pass through: "reconnect_required", "failed", etc.


def _is_healthy(status: str) -> bool:
    return status in HEALTHY_STATUSES


def _needs_reconnect(status: str) -> bool:
    return status in _RECONNECT_STATUSES


def parse_mailbox_status(mb: Dict) -> Dict:
    """Extract status info from a mailbox object."""
    account_id = mb.get("id", "unknown")
    email = mb.get("from_email") or mb.get("email") or f"account_{account_id}"
    domain = email.split("@")[1] if "@" in email else "unknown"

    # Smartlead uses different field names across API versions
    raw_status = (
        mb.get("status")
        or mb.get("connection_status")
        or mb.get("smtp_connection_status")
        or mb.get("is_connected")
    )
    status = _normalize_status(raw_status)

    return {
        "account_id": str(account_id),
        "email": email,
        "domain": domain,
        "status": status,
        "connected": int(_is_healthy(status)),
        "needs_reconnect": int(_needs_reconnect(status)),
        "raw_status": str(raw_status),
    }


def build_point(data: Dict) -> Point:
    return (
        Point("mailbox_status")
        .tag("email", data["email"])
        .tag("domain", data["domain"])
        .tag("account_id", data["account_id"])
        .field("status", data["status"])
        .field("connected", data["connected"])
        .field("needs_reconnect", data["needs_reconnect"])
        .time(datetime.now(timezone.utc), WritePrecision.S)
    )


def run() -> dict:
    """
    Main entry point. Checks all mailbox statuses, writes to InfluxDB,
    fires an alert if any account needs reconnecting.
    """
    log.info("=== Reconnect Monitor run started ===")
    start = time.time()

    mailboxes = get_mailboxes()
    if not mailboxes:
        log.warning("No mailboxes returned — skipping reconnect check")
        return {"skipped": True, "reason": "no_mailboxes"}

    points = []
    results = []
    disconnected = []
    needs_reconnect_list = []

    for mb in mailboxes:
        try:
            data = parse_mailbox_status(mb)
            results.append(data)
            points.append(build_point(data))

            if not data["connected"]:
                disconnected.append(data)
                log.warning(
                    "DISCONNECTED: %s — status: %s",
                    data["email"], data["status"],
                )
            elif data["needs_reconnect"]:
                needs_reconnect_list.append(data)
                log.warning(
                    "NEEDS RECONNECT: %s — status: %s",
                    data["email"], data["status"],
                )
            else:
                log.debug("%s — %s ✓", data["email"], data["status"])

        except Exception as e:
            log.error("Failed to parse mailbox status for %s: %s", mb.get("id"), e)

    if points:
        writer.write_points(points)

    problem_accounts = disconnected + needs_reconnect_list
    if problem_accounts:
        send_alert(
            subject=f"🔌 Mailbox Reconnect Required — {len(problem_accounts)} account(s)",
            body={
                "event": "mailbox_reconnect_required",
                "total_problem_accounts": len(problem_accounts),
                "disconnected": len(disconnected),
                "needs_reconnect": len(needs_reconnect_list),
                "accounts": [
                    {
                        "email": d["email"],
                        "domain": d["domain"],
                        "status": d["status"],
                    }
                    for d in problem_accounts
                ],
                "action": (
                    "Go to Smartlead → Email Accounts → reconnect the listed accounts. "
                    "Campaigns sending from these accounts are paused until reconnected."
                ),
            },
        )

    summary = {
        "total_checked": len(results),
        "connected": sum(1 for r in results if r["connected"]),
        "disconnected": len(disconnected),
        "needs_reconnect": len(needs_reconnect_list),
        "healthy": sum(1 for r in results if r["connected"] and not r["needs_reconnect"]),
        "duration_seconds": round(time.time() - start, 2),
    }

    log.info(
        "=== Reconnect Monitor done: %d/%d healthy, %d disconnected, %d need reconnect (%.1fs) ===",
        summary["healthy"], summary["total_checked"],
        summary["disconnected"], summary["needs_reconnect"],
        summary["duration_seconds"],
    )
    return summary


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    import json
    print(json.dumps(run(), indent=2, default=str))
