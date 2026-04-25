"""
Google Postmaster Tools Monitor
Fetches domain reputation, spam rate, and IP reputation from Google's
Postmaster Tools API. This is Google's own view of your sending reputation —
the most authoritative signal for Gmail deliverability.

Auth: Google service account with domain-level delegation.
Setup: See README.md — Postmaster Tools section.

API: https://gmailpostmastertools.googleapis.com/v1/

InfluxDB measurement: postmaster_metrics
  tags:  domain
  fields: domain_reputation, spam_rate, ip_reputation,
          dkim_success_ratio, dmarc_success_ratio, spf_success_ratio,
          inbound_encryption_ratio, outbound_encryption_ratio

Reputation values: HIGH=4, MEDIUM=3, LOW=2, BAD=1, REPUTATION_CATEGORY_UNSPECIFIED=0

Run standalone:  python -m modules.postmaster_monitor
Called by:       scheduler.py every POSTMASTER_INTERVAL_HOURS
"""

import logging
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from influxdb_client import Point, WritePrecision

from config.settings import postmaster as pm_cfg, alerts as alert_cfg
from modules.domain_discovery import get_domains
from modules.influx_writer import writer
from modules.alerter import send_alert
from modules.utils import safe_float

log = logging.getLogger(__name__)

REPUTATION_MAP = {
    "HIGH": 4,
    "MEDIUM": 3,
    "LOW": 2,
    "BAD": 1,
    "REPUTATION_CATEGORY_UNSPECIFIED": 0,
}


def _build_service():
    """Build the Postmaster Tools API service client."""
    from google.oauth2 import service_account
    from googleapiclient.discovery import build

    creds = service_account.Credentials.from_service_account_file(
        pm_cfg.credentials_path,
        scopes=["https://www.googleapis.com/auth/postmaster.readonly"],
    )
    return build("gmailpostmastertools", "v1", credentials=creds, cache_discovery=False)


def _rep_score(rep_string: str) -> int:
    """Convert reputation string to numeric score (higher = better)."""
    return REPUTATION_MAP.get(str(rep_string).upper(), 0)


def fetch_domains(service) -> List[str]:
    """
    List all domains registered in Postmaster Tools.
    Returns list of domain name strings.
    """
    try:
        result = service.domains().list().execute()
        return [d["name"].replace("domains/", "") for d in result.get("domains", [])]
    except Exception as e:
        log.error("Failed to list Postmaster domains: %s", e)
        return []


def fetch_traffic_stats(service, domain: str, days_back: int = 3) -> Optional[Dict]:
    """
    Fetch traffic stats for a domain for the last N days.
    Returns the most recent day's stats, or None if unavailable.
    Postmaster Tools data has a 2-3 day lag.
    """
    stats_list = []
    for i in range(days_back, 0, -1):
        d = date.today() - timedelta(days=i)
        name = f"domains/{domain}/trafficStats/{d.strftime('%Y%m%d')}"
        try:
            stats = service.domains().trafficStats().get(name=name).execute()
            if stats:
                stats_list.append(stats)
        except Exception:
            continue   # no data for this day — normal

    return stats_list[-1] if stats_list else None


def parse_traffic_stats(domain: str, stats: Dict) -> Dict:
    """Normalize Postmaster trafficStats into a flat dict."""
    user_rep = stats.get("userReportedSpamRatio", 0)
    domain_rep = stats.get("domainReputation", "REPUTATION_CATEGORY_UNSPECIFIED")
    ip_rep = stats.get("ipReputations", [{}])
    # IP reputation: take the worst (lowest) score across all IPs
    ip_scores = [_rep_score(r.get("reputation", "REPUTATION_CATEGORY_UNSPECIFIED")) for r in ip_rep]
    worst_ip_rep = min(ip_scores) if ip_scores else 0

    # Delivery errors
    delivery_errors = stats.get("deliveryErrors", [])

    # Auth success ratios
    dkim_ratio  = _safe_float(stats.get("dkimSuccessRatio"))
    dmarc_ratio = _safe_float(stats.get("dmarcSuccessRatio"))
    spf_ratio   = _safe_float(stats.get("spfSuccessRatio"))

    # Encryption
    inbound_enc  = _safe_float(stats.get("inboundEncryptionRatio"))
    outbound_enc = _safe_float(stats.get("outboundEncryptionRatio"))

    return {
        "domain": domain,
        "domain_reputation": _rep_score(domain_rep),
        "domain_reputation_label": str(domain_rep),
        "spam_rate": _safe_float(user_rep),
        "ip_reputation": worst_ip_rep,
        "dkim_success_ratio": dkim_ratio,
        "dmarc_success_ratio": dmarc_ratio,
        "spf_success_ratio": spf_ratio,
        "inbound_encryption_ratio": inbound_enc,
        "outbound_encryption_ratio": outbound_enc,
        "delivery_error_count": len(delivery_errors),
    }


def build_point(data: Dict) -> Point:
    return (
        Point("postmaster_metrics")
        .tag("domain", data["domain"])
        .tag("domain_reputation_label", data["domain_reputation_label"])
        .field("domain_reputation", data["domain_reputation"])
        .field("spam_rate", data["spam_rate"])
        .field("ip_reputation", data["ip_reputation"])
        .field("dkim_success_ratio", data["dkim_success_ratio"])
        .field("dmarc_success_ratio", data["dmarc_success_ratio"])
        .field("spf_success_ratio", data["spf_success_ratio"])
        .field("inbound_encryption_ratio", data["inbound_encryption_ratio"])
        .field("outbound_encryption_ratio", data["outbound_encryption_ratio"])
        .field("delivery_error_count", data["delivery_error_count"])
        .time(datetime.now(timezone.utc), WritePrecision.S)
    )


def run() -> dict:
    """
    Main entry point. Fetches Postmaster metrics for all verified domains,
    writes to InfluxDB, fires alert for LOW/BAD reputation.
    """
    if not pm_cfg.enabled:
        log.info(
            "Postmaster Tools not configured — set POSTMASTER_CREDENTIALS_PATH in .env to enable"
        )
        return {"skipped": True, "reason": "not_configured"}

    log.info("=== Postmaster Tools Monitor run started ===")
    start = time.time()

    try:
        service = _build_service()
    except Exception as e:
        log.error("Failed to build Postmaster API service: %s", e)
        return {"error": str(e)}

    # Fetch domains registered in Postmaster Tools
    postmaster_domains = fetch_domains(service)
    if not postmaster_domains:
        log.warning("No domains found in Postmaster Tools — have you registered them?")
        return {"postmaster_domains": 0}

    # Cross-reference with our sending domains for relevance
    our_domains = set(get_domains())
    relevant = [d for d in postmaster_domains if d in our_domains]
    log.info(
        "Postmaster domains: %d total, %d overlap with sending domains",
        len(postmaster_domains), len(relevant),
    )

    points = []
    results = []
    bad_reputation = []

    for domain in relevant or postmaster_domains:
        try:
            stats_raw = fetch_traffic_stats(service, domain)
            if not stats_raw:
                log.info("%s — no traffic stats available yet (may be new domain)", domain)
                continue

            data = parse_traffic_stats(domain, stats_raw)
            results.append(data)
            points.append(build_point(data))

            log.info(
                "%s — reputation:%s (%d) spam_rate:%.4f dkim:%.2f dmarc:%.2f",
                domain,
                data["domain_reputation_label"],
                data["domain_reputation"],
                data["spam_rate"],
                data["dkim_success_ratio"],
                data["dmarc_success_ratio"],
            )

            if data["domain_reputation_label"] in alert_cfg.postmaster_bad_reputation:
                bad_reputation.append(data)

        except Exception as e:
            log.error("Failed to fetch Postmaster stats for %s: %s", domain, e)

        time.sleep(0.5)   # Postmaster API is rate-limited

    if points:
        writer.write_points(points)

    if bad_reputation:
        send_alert(
            subject=f"🚨 Google Postmaster — Poor Domain Reputation",
            body={
                "event": "postmaster_poor_reputation",
                "domains": [
                    {
                        "domain": d["domain"],
                        "reputation": d["domain_reputation_label"],
                        "spam_rate": d["spam_rate"],
                        "dkim_ratio": d["dkim_success_ratio"],
                        "dmarc_ratio": d["dmarc_success_ratio"],
                    }
                    for d in bad_reputation
                ],
                "action": (
                    "LOW/BAD reputation means Google is filtering your mail. "
                    "Stop sending from this domain immediately and investigate "
                    "spam complaints, bounce rates, and list quality."
                ),
            },
        )

    summary = {
        "postmaster_domains": len(postmaster_domains),
        "domains_with_data": len(results),
        "bad_reputation_count": len(bad_reputation),
        "avg_domain_reputation": round(
            sum(d["domain_reputation"] for d in results) / len(results), 2
        ) if results else 0,
        "avg_spam_rate": round(
            sum(d["spam_rate"] for d in results) / len(results), 6
        ) if results else 0,
        "duration_seconds": round(time.time() - start, 2),
    }

    log.info(
        "=== Postmaster done: %d domains, %d bad reputation (%.1fs) ===",
        summary["domains_with_data"], summary["bad_reputation_count"],
        summary["duration_seconds"],
    )
    return summary


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    import json
    print(json.dumps(run(), indent=2, default=str))
