"""
Warmup Stats Monitor
Fetches per-mailbox warmup stats from Smartlead for the last 7 days.
Replaces smartlead_spam_audit.py — writes to InfluxDB instead of CSV.

Endpoint: GET /email-accounts/{id}/warmup-stats
One call per mailbox. Uses configurable delay between calls to avoid
rate limiting on 164+ mailboxes.

InfluxDB measurement: warmup_stats
  tags:  email, domain, account_id
  fields: warmup_inbox_count, warmup_spam_count, warmup_inbox_pct,
          warmup_spam_pct, warmup_health_score, warmup_enabled,
          total_sent, total_inbox, total_spam

Run standalone:  python -m modules.warmup_stats
Called by:       scheduler.py every WARMUP_INTERVAL_HOURS
"""

import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import requests
from influxdb_client import Point, WritePrecision

from config.settings import smartlead as sl_cfg, alerts as alert_cfg
from modules.domain_discovery import get_mailboxes
from modules.influx_writer import writer
from modules.alerter import send_alert
from modules.utils import safe_float as _safe_float, safe_int as _safe_int, health_score as _health_score

log = logging.getLogger(__name__)

MAX_WORKERS = 10


def fetch_warmup_stats(account_id: int) -> Optional[Dict]:
    """Fetch warmup stats for a single email account ID."""
    try:
        r = requests.get(
            f"{sl_cfg.base_url}/email-accounts/{account_id}/warmup-stats",
            params={"api_key": sl_cfg.api_key},
            timeout=15,
        )
        if r.status_code == 404:
            return None   # account has no warmup configured
        r.raise_for_status()
        return r.json()
    except Exception as e:
        log.debug("warmup-stats failed for account %s: %s", account_id, e)
        return None


def parse_warmup(account_id: int, email: str, raw: Dict) -> Dict:
    """
    Normalize Smartlead warmup-stats response into a flat dict.
    The API returns last 7 days of warmup send/inbox/spam counts.
    Field names vary — we probe multiple keys for resilience.
    """
    # Total counts across the 7-day window
    total_sent  = _safe_int(raw.get("total_sent",  raw.get("sent_count",  raw.get("total", 0))))
    inbox_count = _safe_int(raw.get("inbox_count", raw.get("total_inbox", raw.get("inbox", 0))))
    spam_count  = _safe_int(raw.get("spam_count",  raw.get("total_spam",  raw.get("spam",  0))))

    # Percentages — use API value if present, else compute
    inbox_pct = _safe_float(raw.get("inbox_percentage", raw.get("inbox_pct")))
    spam_pct  = _safe_float(raw.get("spam_percentage",  raw.get("spam_pct")))

    if inbox_pct == 0 and total_sent > 0:
        inbox_pct = round(inbox_count / total_sent * 100, 2)
    if spam_pct == 0 and total_sent > 0:
        spam_pct = round(spam_count / total_sent * 100, 2)

    health_score = _health_score(inbox_pct, spam_pct)

    domain = email.split("@")[1] if "@" in email else "unknown"

    return {
        "account_id": account_id,
        "email": email,
        "domain": domain,
        "warmup_enabled": bool(raw.get("warmup_enabled", raw.get("status") == "active")),
        "total_sent": total_sent,
        "inbox_count": inbox_count,
        "spam_count": spam_count,
        "inbox_pct": inbox_pct,
        "spam_pct": spam_pct,
        "health_score": round(health_score, 2),
    }


def build_point(data: Dict) -> Point:
    return (
        Point("warmup_stats")
        .tag("email", data["email"])
        .tag("domain", data["domain"])
        .tag("account_id", str(data["account_id"]))
        .field("warmup_enabled", int(data["warmup_enabled"]))
        .field("total_sent",  data["total_sent"])
        .field("inbox_count", data["inbox_count"])
        .field("spam_count",  data["spam_count"])
        .field("inbox_pct",   data["inbox_pct"])
        .field("spam_pct",    data["spam_pct"])
        .field("health_score", data["health_score"])
        .time(datetime.now(timezone.utc), WritePrecision.S)
    )


def run() -> dict:
    """
    Main entry point. Iterates all mailboxes, fetches warmup stats per account,
    writes to InfluxDB, fires alerts for CRITICAL mailboxes (spam > threshold).
    """
    log.info("=== Warmup Stats Monitor run started ===")
    start = time.time()

    mailboxes = get_mailboxes()
    if not mailboxes:
        log.warning("No mailboxes discovered — skipping warmup stats")
        return {"skipped": True, "reason": "no_mailboxes"}

    log.info("Fetching warmup stats for %d mailboxes (workers=%d)", len(mailboxes), MAX_WORKERS)

    points = []
    results = []
    critical = []   # spam_pct > threshold
    no_warmup = 0
    errors = 0

    def _fetch_one(mb: Dict):
        account_id = mb.get("id")
        email = mb.get("from_email") or mb.get("email") or f"unknown_{account_id}"
        if not account_id:
            return None
        raw = fetch_warmup_stats(int(account_id))
        return (account_id, email, raw)

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(_fetch_one, mb): mb for mb in mailboxes}
        for future in as_completed(futures):
            result = future.result()
            if result is None:
                continue
            account_id, email, raw = result
            if raw is None:
                no_warmup += 1
                log.debug("%s — no warmup data (warmup not enabled or no sends)", email)
            else:
                try:
                    data = parse_warmup(int(account_id), email, raw)
                    results.append(data)
                    points.append(build_point(data))
                    log.info(
                        "%s — inbox:%.1f%% spam:%.1f%% score:%.0f (sent:%d)",
                        email, data["inbox_pct"], data["spam_pct"],
                        data["health_score"], data["total_sent"],
                    )
                    if data["spam_pct"] >= alert_cfg.spam_pct_threshold:
                        critical.append(data)
                except Exception as e:
                    log.error("Failed to parse warmup stats for %s: %s", email, e)
                    errors += 1

    if points:
        writer.write_points(points)

    if critical:
        send_alert(
            subject="🔥 Warmup Spam Alert — Mailboxes Critical",
            body={
                "event": "warmup_high_spam",
                "threshold_pct": alert_cfg.spam_pct_threshold,
                "critical_count": len(critical),
                "mailboxes": [
                    {
                        "email": d["email"],
                        "domain": d["domain"],
                        "spam_pct": d["spam_pct"],
                        "inbox_pct": d["inbox_pct"],
                        "health_score": d["health_score"],
                    }
                    for d in critical
                ],
            },
        )

    # Domain-level rollup for logging
    domain_summary: Dict[str, Dict] = {}
    for d in results:
        dom = d["domain"]
        if dom not in domain_summary:
            domain_summary[dom] = {"count": 0, "spam_sum": 0.0, "inbox_sum": 0.0}
        domain_summary[dom]["count"] += 1
        domain_summary[dom]["spam_sum"]  += d["spam_pct"]
        domain_summary[dom]["inbox_sum"] += d["inbox_pct"]

    for dom, agg in domain_summary.items():
        n = agg["count"]
        log.info(
            "  Domain %s — %d mailboxes avg spam:%.1f%% avg inbox:%.1f%%",
            dom, n, agg["spam_sum"] / n, agg["inbox_sum"] / n,
        )

    summary = {
        "mailboxes_checked": len(mailboxes),
        "warmup_data_found": len(results),
        "no_warmup_configured": no_warmup,
        "errors": errors,
        "critical_mailboxes": len(critical),
        "avg_spam_pct": round(
            sum(d["spam_pct"] for d in results) / len(results), 2
        ) if results else 0,
        "avg_inbox_pct": round(
            sum(d["inbox_pct"] for d in results) / len(results), 2
        ) if results else 0,
        "duration_seconds": round(time.time() - start, 2),
    }

    log.info(
        "=== Warmup Stats done: %d/%d mailboxes with data, %d critical (%.1fs) ===",
        summary["warmup_data_found"], summary["mailboxes_checked"],
        summary["critical_mailboxes"], summary["duration_seconds"],
    )
    return summary


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    import json
    print(json.dumps(run(), indent=2, default=str))
