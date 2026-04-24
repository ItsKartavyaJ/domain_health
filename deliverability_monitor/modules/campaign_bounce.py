"""
Campaign Bounce Monitor
Checks bounce rate per active campaign. Catches a bad list burning a domain
before it shows up in domain-level aggregate metrics.

Endpoints:
  GET /campaigns/                      — list all campaigns
  GET /campaigns/{id}/statistics       — per-campaign stats including bounces

InfluxDB measurement: campaign_bounce
  tags:  campaign_id, campaign_name, domain
  fields: sent, bounced, bounce_rate, open_rate, reply_rate, status

Run standalone:  python -m modules.campaign_bounce
Called by:       scheduler.py every CAMPAIGN_BOUNCE_INTERVAL_HOURS
"""

import logging
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from influxdb_client import Point, WritePrecision

from config.settings import smartlead as sl_cfg, alerts as alert_cfg
from modules.influx_writer import writer
from modules.alerter import send_alert
from modules.smartlead_client import sl_get
from modules.utils import safe_float as _safe_float, safe_int as _safe_int

log = logging.getLogger(__name__)


def fetch_active_campaigns() -> List[Dict]:
    """
    GET /campaigns/ — returns all campaigns.
    Filter to those with status ACTIVE or IN_PROGRESS.
    """
    data = sl_get("/campaigns/")
    if data is None:
        return []
    campaigns = data if isinstance(data, list) else data.get("data", data.get("list", []))
    active_statuses = {"ACTIVE", "IN_PROGRESS", "STARTED", "active", "in_progress"}
    return [c for c in campaigns if str(c.get("status", "")).upper() in {s.upper() for s in active_statuses}]


def fetch_campaign_stats(campaign_id: int) -> Optional[Dict]:
    """GET /campaigns/{id}/statistics"""
    return sl_get(f"/campaigns/{campaign_id}/statistics")


def parse_campaign(campaign: Dict, stats: Dict) -> Dict:
    """Merge campaign metadata with its statistics."""
    campaign_id = campaign.get("id", "unknown")
    name = campaign.get("name", campaign.get("campaign_name", f"campaign_{campaign_id}"))
    status = str(campaign.get("status", "unknown"))

    # Stats field name variations
    sent     = _safe_int(stats.get("sent_count",    stats.get("total_sent",    stats.get("emails_sent", 0))))
    bounced  = _safe_int(stats.get("bounce_count",  stats.get("total_bounced", stats.get("bounces", 0))))
    opened   = _safe_int(stats.get("open_count",    stats.get("total_opened",  stats.get("opens", 0))))
    replied  = _safe_int(stats.get("reply_count",   stats.get("total_replied", stats.get("replies", 0))))

    bounce_rate = _safe_float(stats.get("bounce_rate", stats.get("bounce_percentage")))
    open_rate   = _safe_float(stats.get("open_rate",   stats.get("open_percentage")))
    reply_rate  = _safe_float(stats.get("reply_rate",  stats.get("reply_percentage")))

    if bounce_rate == 0 and sent > 0:
        bounce_rate = round(bounced / sent * 100, 3)
    if open_rate == 0 and sent > 0:
        open_rate = round(opened / sent * 100, 2)
    if reply_rate == 0 and sent > 0:
        reply_rate = round(replied / sent * 100, 2)

    # Try to extract sending domain from campaign settings
    domain = (
        campaign.get("sending_domain")
        or campaign.get("from_domain")
        or campaign.get("from_email", "").split("@")[-1]
        or "unknown"
    )

    return {
        "campaign_id": str(campaign_id),
        "campaign_name": name[:100],
        "domain": domain,
        "status": status,
        "sent": sent,
        "bounced": bounced,
        "bounce_rate": bounce_rate,
        "open_rate": open_rate,
        "reply_rate": reply_rate,
    }


def build_point(data: Dict) -> Point:
    return (
        Point("campaign_bounce")
        .tag("campaign_id", data["campaign_id"])
        .tag("campaign_name", data["campaign_name"])
        .tag("domain", data["domain"])
        .tag("status", data["status"])
        .field("sent", data["sent"])
        .field("bounced", data["bounced"])
        .field("bounce_rate", data["bounce_rate"])
        .field("open_rate", data["open_rate"])
        .field("reply_rate", data["reply_rate"])
        .time(datetime.now(timezone.utc), WritePrecision.S)
    )


def run() -> dict:
    """
    Main entry point. Checks all active campaigns for bounce spikes,
    writes to InfluxDB, fires alert if any exceed the threshold.
    """
    log.info("=== Campaign Bounce Monitor run started ===")
    start = time.time()

    campaigns = fetch_active_campaigns()
    if not campaigns:
        log.info("No active campaigns found")
        return {"active_campaigns": 0, "duration_seconds": round(time.time() - start, 2)}

    log.info("Checking %d active campaigns for bounce rates", len(campaigns))

    points = []
    results = []
    high_bounce = []

    for campaign in campaigns:
        campaign_id = campaign.get("id")
        if not campaign_id:
            continue

        stats_raw = fetch_campaign_stats(int(campaign_id))
        if not stats_raw:
            log.debug("No stats for campaign %s", campaign_id)
            continue

        # stats may be nested under a key
        stats = (
            stats_raw
            if isinstance(stats_raw, dict) and "sent_count" in stats_raw
            else stats_raw.get("data", stats_raw.get("statistics", stats_raw))
        )

        try:
            data = parse_campaign(campaign, stats if isinstance(stats, dict) else {})
            results.append(data)
            points.append(build_point(data))

            log.info(
                "Campaign '%s' — sent:%d bounce:%.2f%% open:%.1f%% reply:%.1f%%",
                data["campaign_name"], data["sent"],
                data["bounce_rate"], data["open_rate"], data["reply_rate"],
            )

            if (data["bounce_rate"] >= sl_cfg.campaign_bounce_threshold
                    and data["sent"] >= 50):   # ignore low-volume noise
                high_bounce.append(data)
                log.warning(
                    "HIGH BOUNCE: campaign '%s' — %.2f%% (threshold %.1f%%)",
                    data["campaign_name"], data["bounce_rate"],
                    sl_cfg.campaign_bounce_threshold,
                )

        except Exception as e:
            log.error("Failed to parse campaign %s: %s", campaign_id, e)

        time.sleep(0.2)   # gentle rate limiting

    if points:
        writer.write_points(points)

    if high_bounce:
        send_alert(
            subject=f"⚠️ High Bounce Rate — {len(high_bounce)} campaign(s)",
            body={
                "event": "high_campaign_bounce_rate",
                "threshold_pct": sl_cfg.campaign_bounce_threshold,
                "campaigns": [
                    {
                        "campaign_name": d["campaign_name"],
                        "campaign_id": d["campaign_id"],
                        "domain": d["domain"],
                        "bounce_rate": d["bounce_rate"],
                        "sent": d["sent"],
                    }
                    for d in high_bounce
                ],
                "action": (
                    "Pause these campaigns and audit the lead list for invalid addresses. "
                    "Sustained bounce rates >3% will damage domain reputation."
                ),
            },
        )

    summary = {
        "active_campaigns": len(campaigns),
        "stats_fetched": len(results),
        "high_bounce_campaigns": len(high_bounce),
        "avg_bounce_rate": round(
            sum(d["bounce_rate"] for d in results) / len(results), 3
        ) if results else 0,
        "duration_seconds": round(time.time() - start, 2),
    }

    log.info(
        "=== Campaign Bounce done: %d campaigns, %d high bounce, avg %.2f%% (%.1fs) ===",
        summary["stats_fetched"], summary["high_bounce_campaigns"],
        summary["avg_bounce_rate"], summary["duration_seconds"],
    )
    return summary


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    import json
    print(json.dumps(run(), indent=2, default=str))
