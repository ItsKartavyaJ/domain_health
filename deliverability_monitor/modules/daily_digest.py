"""
Daily Digest
Queries all InfluxDB measurements for the last 24h and posts a structured
summary to the n8n webhook. Runs once daily at DIGEST_HOUR_UTC.

The digest is a single payload covering all modules — one Slack/email per day
instead of a stream of individual threshold alerts.

Measurements queried:
  - rbl_check          → blacklisted domains/IPs
  - dmarc_dns_check    → DNS score per domain
  - smartlead_health   → inbox/spam/bounce per domain
  - warmup_stats       → warmup health per mailbox
  - mailbox_status     → reconnect issues
  - campaign_bounce    → high-bounce campaigns
  - postmaster_metrics → Google reputation per domain
  - spf_ip_validation  → SPF authorization gaps

Run standalone:  python -m modules.daily_digest
Called by:       scheduler.py daily at DIGEST_HOUR_UTC
"""

import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from config.settings import influx as influx_cfg, alerts as alert_cfg, smartlead as sl_cfg
from modules.alerter import send_alert

log = logging.getLogger(__name__)

_shared_client = None


def _query(flux: str) -> List[Dict]:
    """Run a Flux query against InfluxDB and return records as list of dicts."""
    try:
        client = _shared_client
        if client is None:
            from influxdb_client import InfluxDBClient
            client = InfluxDBClient(url=influx_cfg.url, token=influx_cfg.token, org=influx_cfg.org)
        tables = client.query_api().query(flux, org=influx_cfg.org)
        records = []
        for table in tables:
            for record in table.records:
                records.append(record.values)
        return records
    except Exception as e:
        log.warning("Flux query failed: %s", e)
        return []


def _bucket() -> str:
    return influx_cfg.bucket


# ── Per-section query functions ────────────────────────────────────────────

def _rbl_summary() -> Dict:
    records = _query(f'''
        from(bucket: "{_bucket()}")
          |> range(start: -24h)
          |> filter(fn: (r) => r._measurement == "rbl_check" and r._field == "blacklisted")
          |> last()
          |> filter(fn: (r) => r._value == 1)
    ''')
    blacklisted = [r.get("domain", r.get("_tags", {}).get("domain", "?")) for r in records]
    return {
        "blacklisted_count": len(blacklisted),
        "blacklisted_domains": blacklisted[:10],   # cap for readability
    }


def _dns_summary() -> Dict:
    records = _query(f'''
        from(bucket: "{_bucket()}")
          |> range(start: -48h)
          |> filter(fn: (r) => r._measurement == "dmarc_dns_check"
              and r.record_type == "composite_score"
              and r._field == "score")
          |> last()
    ''')
    if not records:
        return {"avg_dns_score": None, "low_score_domains": []}

    scores = [(r.get("domain", "?"), float(r.get("_value", 0))) for r in records]
    low = [(d, s) for d, s in scores if s < alert_cfg.dmarc_score_threshold]
    avg = sum(s for _, s in scores) / len(scores)

    return {
        "domains_checked": len(scores),
        "avg_dns_score": round(avg, 1),
        "low_score_domains": [{"domain": d, "score": round(s, 1)} for d, s in low],
    }


def _smartlead_summary() -> Dict:
    records = _query(f'''
        from(bucket: "{_bucket()}")
          |> range(start: -24h)
          |> filter(fn: (r) => r._measurement == "smartlead_health"
              and r.grain == "domain"
              and r._field == "spam_pct")
          |> last()
    ''')
    if not records:
        return {"avg_spam_pct": None, "high_spam_domains": []}

    spam_data = [(r.get("domain", "?"), float(r.get("_value", 0))) for r in records]
    high_spam = [(d, s) for d, s in spam_data if s >= alert_cfg.spam_pct_threshold]
    avg = sum(s for _, s in spam_data) / len(spam_data) if spam_data else 0

    return {
        "domains_tracked": len(spam_data),
        "avg_spam_pct": round(avg, 1),
        "high_spam_domains": [{"domain": d, "spam_pct": round(s, 1)} for d, s in high_spam],
    }


def _warmup_summary() -> Dict:
    records = _query(f'''
        from(bucket: "{_bucket()}")
          |> range(start: -24h)
          |> filter(fn: (r) => r._measurement == "warmup_stats"
              and r._field == "health_score")
          |> last()
    ''')
    if not records:
        return {"mailboxes_tracked": 0, "avg_health_score": None, "critical_count": 0}

    scores = [float(r.get("_value", 0)) for r in records]
    critical = [r for r in records if float(r.get("_value", 100)) < 30]

    return {
        "mailboxes_tracked": len(scores),
        "avg_health_score": round(sum(scores) / len(scores), 1) if scores else 0,
        "critical_count": len(critical),
    }


def _reconnect_summary() -> Dict:
    records = _query(f'''
        from(bucket: "{_bucket()}")
          |> range(start: -24h)
          |> filter(fn: (r) => r._measurement == "mailbox_status"
              and r._field == "needs_reconnect")
          |> last()
          |> filter(fn: (r) => r._value == 1)
    ''')
    return {
        "needs_reconnect": len(records),
        "accounts": [r.get("email", "?") for r in records[:10]],
    }


def _campaign_bounce_summary() -> Dict:
    records = _query(f'''
        from(bucket: "{_bucket()}")
          |> range(start: -24h)
          |> filter(fn: (r) => r._measurement == "campaign_bounce"
              and r._field == "bounce_rate")
          |> last()
    ''')
    if not records:
        return {"campaigns_tracked": 0, "high_bounce_count": 0}

    high = [r for r in records if float(r.get("_value", 0)) >= sl_cfg.campaign_bounce_threshold]
    avg = sum(float(r.get("_value", 0)) for r in records) / len(records)

    return {
        "campaigns_tracked": len(records),
        "avg_bounce_rate": round(avg, 2),
        "high_bounce_count": len(high),
        "high_bounce_campaigns": [
            {"name": r.get("campaign_name", "?"), "rate": round(float(r.get("_value", 0)), 2)}
            for r in high[:5]
        ],
    }


def _postmaster_summary() -> Dict:
    records = _query(f'''
        from(bucket: "{_bucket()}")
          |> range(start: -48h)
          |> filter(fn: (r) => r._measurement == "postmaster_metrics"
              and r._field == "domain_reputation")
          |> last()
    ''')
    if not records:
        return {"postmaster_available": False}

    rep_labels = {4: "HIGH", 3: "MEDIUM", 2: "LOW", 1: "BAD", 0: "UNKNOWN"}
    domains = [
        {
            "domain": r.get("domain", "?"),
            "reputation": rep_labels.get(int(r.get("_value", 0)), "UNKNOWN"),
        }
        for r in records
    ]
    bad = [d for d in domains if d["reputation"] in ("LOW", "BAD")]

    return {
        "postmaster_available": True,
        "domains_tracked": len(domains),
        "bad_reputation_count": len(bad),
        "bad_reputation_domains": bad,
    }


def _spf_summary() -> Dict:
    records = _query(f'''
        from(bucket: "{_bucket()}")
          |> range(start: -48h)
          |> filter(fn: (r) => r._measurement == "spf_ip_validation"
              and r._field == "authorized")
          |> last()
          |> filter(fn: (r) => r._value == 0)
    ''')
    return {
        "unauthorized_pairs": len(records),
        "affected_domains": list({r.get("domain", "?") for r in records})[:10],
    }


def _overall_health_score(sections: Dict) -> float:
    """
    Compute a single 0-100 account health score from all section summaries.
    Used as the top-line number in the digest.
    """
    score = 100.0
    deductions = []

    # RBL blacklists
    bl = sections["rbl"].get("blacklisted_count", 0)
    if bl > 0:
        ded = min(bl * 10, 30)
        deductions.append(("blacklisted_domains", ded))
        score -= ded

    # DNS score
    dns_avg = sections["dns"].get("avg_dns_score")
    if dns_avg is not None and dns_avg < 80:
        ded = (80 - dns_avg) * 0.5
        deductions.append(("low_dns_score", round(ded, 1)))
        score -= ded

    # Spam rate
    spam_avg = sections["smartlead"].get("avg_spam_pct")
    if spam_avg is not None and spam_avg > 10:
        ded = min((spam_avg - 10) * 1.5, 30)
        deductions.append(("high_spam_pct", round(ded, 1)))
        score -= ded

    # Reconnect issues
    reconnect = sections["reconnect"].get("needs_reconnect", 0)
    if reconnect > 0:
        ded = min(reconnect * 3, 15)
        deductions.append(("reconnect_issues", ded))
        score -= ded

    # Postmaster bad reputation
    bad_rep = sections["postmaster"].get("bad_reputation_count", 0)
    if bad_rep > 0:
        ded = min(bad_rep * 15, 30)
        deductions.append(("bad_postmaster_reputation", ded))
        score -= ded

    return max(0.0, round(score, 1))


def run() -> dict:
    """
    Main entry point. Assembles digest from all InfluxDB measurements,
    computes overall health score, fires to n8n webhook.
    """
    if not alert_cfg.webhook_url:
        log.info("No ALERT_WEBHOOK_URL configured — digest suppressed")
        return {"skipped": True, "reason": "no_webhook"}

    log.info("=== Daily Digest assembling ===")
    start = time.time()

    global _shared_client
    from influxdb_client import InfluxDBClient
    with InfluxDBClient(url=influx_cfg.url, token=influx_cfg.token, org=influx_cfg.org) as client:
        _shared_client = client
        try:
            sections = {
                "rbl":         _rbl_summary(),
                "dns":         _dns_summary(),
                "smartlead":   _smartlead_summary(),
                "warmup":      _warmup_summary(),
                "reconnect":   _reconnect_summary(),
                "campaign":    _campaign_bounce_summary(),
                "postmaster":  _postmaster_summary(),
                "spf":         _spf_summary(),
            }
        finally:
            _shared_client = None

    overall_score = _overall_health_score(sections)

    # Determine status emoji
    if overall_score >= 85:
        status = "🟢 Healthy"
    elif overall_score >= 65:
        status = "🟡 Needs Attention"
    else:
        status = "🔴 Critical"

    digest = {
        "event": "daily_digest",
        "date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "overall_health_score": overall_score,
        "status": status,
        "sections": sections,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

    send_alert(
        subject=f"{status} — Daily Deliverability Digest ({overall_score}/100)",
        body=digest,
    )

    log.info(
        "=== Daily Digest sent — overall score: %.1f (%s) (%.1fs) ===",
        overall_score, status, time.time() - start,
    )
    return {"overall_score": overall_score, "status": status, **{k: v for k, v in sections.items()}}


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    import json
    print(json.dumps(run(), indent=2, default=str))
