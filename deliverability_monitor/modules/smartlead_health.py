"""
Smartlead Health Poller
Fetches domain-wise and name-wise mailbox health metrics from Smartlead
Global Analytics API. Writes to InfluxDB measurement: smartlead_health.

Two grains:
  - grain=domain   one row per sending domain (from domain-wise endpoint)
  - grain=mailbox  one row per email address  (from name-wise endpoint)

Run standalone:  python -m modules.smartlead_health
Called by:       scheduler.py every SMARTLEAD_POLL_INTERVAL_HOURS
"""

import logging
import time
from datetime import date, timedelta
from typing import Any, Dict, List, Optional

import requests

from config.settings import smartlead as sl_cfg, alerts as alert_cfg
from modules.influx_writer import writer
from modules.alerter import send_alert
from modules.utils import safe_float as _safe_float, safe_int as _safe_int, health_score as _health_score

log = logging.getLogger(__name__)


class SmartleadClient:
    def __init__(self):
        self.api_key = sl_cfg.api_key
        self.base = sl_cfg.base_url
        self.lookback = sl_cfg.lookback_days

    def _params(self, extra: Dict = None) -> Dict:
        start = (date.today() - timedelta(days=self.lookback)).isoformat()
        end = date.today().isoformat()
        p = {"api_key": self.api_key, "start_date": start, "end_date": end}
        if extra:
            p.update(extra)
        return p

    def _get(self, path: str, params: Dict = None) -> Optional[Any]:
        url = f"{self.base}{path}"
        try:
            r = requests.get(url, params=self._params(params), timeout=30)
            r.raise_for_status()
            return r.json()
        except requests.HTTPError as e:
            log.error("Smartlead API error %s %s: %s", r.status_code, path, e)
            return None
        except Exception as e:
            log.error("Smartlead request failed %s: %s", path, e)
            return None

    def fetch_domain_health(self) -> Optional[List[Dict]]:
        """GET /analytics/mailbox/domain-wise-health-metrics"""
        data = self._get("/analytics/mailbox/domain-wise-health-metrics")
        if data is None:
            return None
        # API may return a list directly or {data: [...]}
        if isinstance(data, list):
            return data
        return data.get("data", data.get("results", []))

    def fetch_name_health(self) -> Optional[List[Dict]]:
        """GET /analytics/mailbox/name-wise-health-metrics"""
        data = self._get("/analytics/mailbox/name-wise-health-metrics")
        if data is None:
            return None
        if isinstance(data, list):
            return data
        return data.get("data", data.get("results", []))

    def fetch_mailbox_overall(self) -> Optional[Dict]:
        """GET /analytics/mailbox/overall-stats — account-wide totals"""
        return self._get("/analytics/mailbox/overall-stats")

def parse_domain_row(row: Dict) -> Dict:
    """
    Normalize one row from domain-wise-health-metrics.
    Field names are inferred from Smartlead's API pattern —
    adjust keys if your live response differs.
    """
    return {
        "domain": str(row.get("domain", row.get("sending_domain", "unknown"))),
        "sent_count": _safe_int(row.get("sent_count", row.get("total_sent"))),
        "inbox_count": _safe_int(row.get("inbox_count", row.get("total_inbox"))),
        "spam_count": _safe_int(row.get("spam_count", row.get("total_spam"))),
        "inbox_pct": _safe_float(row.get("inbox_percentage", row.get("inbox_pct", row.get("inbox_rate")))),
        "spam_pct": _safe_float(row.get("spam_percentage", row.get("spam_pct", row.get("spam_rate")))),
        "bounce_count": _safe_int(row.get("bounce_count", row.get("total_bounce"))),
        "bounce_rate": _safe_float(row.get("bounce_rate", row.get("bounce_percentage"))),
        "open_rate": _safe_float(row.get("open_rate", row.get("open_percentage"))),
        "reply_rate": _safe_float(row.get("reply_rate", row.get("reply_percentage"))),
        "positive_reply_rate": _safe_float(row.get("positive_reply_rate", row.get("positive_reply_percentage", row.get("positive_reply_pct", 0.0)))),
        "mailbox_count": _safe_int(row.get("mailbox_count", row.get("email_count", 1))),
    }


def parse_mailbox_row(row: Dict) -> Dict:
    """
    Normalize one row from name-wise-health-metrics.
    """
    email = str(row.get("email", row.get("email_address", row.get("from_email", "unknown"))))
    domain = email.split("@")[-1] if "@" in email else "unknown"
    spam_pct = _safe_float(row.get("spam_percentage", row.get("spam_pct", row.get("spam_rate"))))
    inbox_pct = _safe_float(row.get("inbox_percentage", row.get("inbox_pct", row.get("inbox_rate"))))
    bounce_rate = _safe_float(row.get("bounce_rate", row.get("bounce_percentage")))

    health_score = _health_score(inbox_pct, spam_pct, bounce_rate)

    return {
        "email": email,
        "domain": domain,
        "sent_count": _safe_int(row.get("sent_count", row.get("total_sent"))),
        "inbox_pct": inbox_pct,
        "spam_pct": spam_pct,
        "bounce_rate": bounce_rate,
        "warmup_status": str(row.get("warmup_status", row.get("warmup_enabled", "unknown"))),
        "tag": str(row.get("tag", row.get("tags", ""))),
        "health_score": round(health_score, 2),
    }


def run() -> dict:
    """
    Main entry point. Fetches both grains, writes to InfluxDB, fires alerts.
    """
    log.info("=== Smartlead Health Poller run started ===")
    start = time.time()

    client = SmartleadClient()
    points = []
    alert_domains = []

    # ── Domain-grain ───────────────────────────────────────────────────────
    domain_rows = client.fetch_domain_health()
    if domain_rows:
        log.info("Fetched %d domain-wise rows from Smartlead", len(domain_rows))
        for raw in domain_rows:
            if not isinstance(raw, dict):
                log.debug("Skipping non-dict domain row: %r", raw)
                continue
            try:
                row = parse_domain_row(raw)
                points.append(writer.smartlead_domain_point(**row))

                log.info(
                    "%s — sent:%d inbox:%.1f%% spam:%.1f%% bounce:%.1f%%",
                    row["domain"], row["sent_count"],
                    row["inbox_pct"], row["spam_pct"], row["bounce_rate"],
                )

                if row["spam_pct"] >= alert_cfg.spam_pct_threshold:
                    alert_domains.append(row)
            except Exception as e:
                log.error("Failed to parse domain row: %s — %s", raw, e)
    else:
        log.warning("No domain-wise health data returned from Smartlead")

    # ── Mailbox-grain ──────────────────────────────────────────────────────
    mailbox_rows = client.fetch_name_health()
    if mailbox_rows:
        log.info("Fetched %d name-wise rows from Smartlead", len(mailbox_rows))
        for raw in mailbox_rows:
            if not isinstance(raw, dict):
                log.debug("Skipping non-dict mailbox row: %r", raw)
                continue
            try:
                row = parse_mailbox_row(raw)
                points.append(writer.smartlead_mailbox_point(**row))
            except Exception as e:
                log.error("Failed to parse mailbox row: %s — %s", raw, e)
    else:
        log.warning("No name-wise health data returned from Smartlead")

    if points:
        writer.write_points(points)

    if alert_domains:
        send_alert(
            subject="📬 Smartlead Spam Rate Alert",
            body={
                "event": "high_spam_rate",
                "threshold_pct": alert_cfg.spam_pct_threshold,
                "domains": [
                    {
                        "domain": d["domain"],
                        "spam_pct": d["spam_pct"],
                        "inbox_pct": d["inbox_pct"],
                        "sent_count": d["sent_count"],
                    }
                    for d in alert_domains
                ],
            },
        )

    summary = {
        "domain_rows": len(domain_rows) if domain_rows else 0,
        "mailbox_rows": len(mailbox_rows) if mailbox_rows else 0,
        "influx_points_written": len(points),
        "domain_alerts": len(alert_domains),
        "duration_seconds": round(time.time() - start, 2),
    }

    log.info(
        "=== Smartlead Poller done: %d domain rows, %d mailbox rows, %d alerts (%.1fs) ===",
        summary["domain_rows"], summary["mailbox_rows"],
        summary["domain_alerts"], summary["duration_seconds"],
    )
    return summary


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    import json
    print(json.dumps(run(), indent=2, default=str))
