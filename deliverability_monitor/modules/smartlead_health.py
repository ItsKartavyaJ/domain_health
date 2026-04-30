"""
Smartlead Health Poller
Fetches domain-wise and name-wise mailbox health metrics from Smartlead
Global Analytics API. Writes to InfluxDB measurement: smartlead_health.

Two grains:
  - grain=domain   one row per sending domain (from domain-wise endpoint)
  - grain=mailbox  one row per email address  (from name-wise endpoint)

API response shape (actual, as of 2026-04):
  domain-wise: {"data": {"domain_health_metrics": [{domain, sent, opened, clicked, replied, unsubscribed, bounced}, ...]}}
  name-wise:   {"data": {"email_health_metrics":  [{from_email, sent, opened, clicked, replied, unsubscribed, bounced}, ...]}}

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

    def _extract_list(self, data, list_key: str) -> List[Dict]:
        """
        Extract a named list from Smartlead's nested envelope shapes:
          {list_key: [...]}
          {"data": {list_key: [...]}}
          {"data": [...]}
          bare list
        """
        if isinstance(data, list):
            return data
        if not isinstance(data, dict):
            return []
        # Top-level named key: {list_key: [...]}
        if list_key in data:
            val = data[list_key]
            return val if isinstance(val, list) else ([val] if isinstance(val, dict) else [])
        # One level down: {"data": {list_key: [...]}} or {"data": [...]}
        inner = data.get("data") or data.get("results")
        if isinstance(inner, list):
            return inner
        if isinstance(inner, dict):
            if list_key in inner:
                val = inner[list_key]
                return val if isinstance(val, list) else ([val] if isinstance(val, dict) else [])
            # Last resort: bare inner dict is a single row
            return [inner]
        return []

    def fetch_domain_health(self) -> Optional[List[Dict]]:
        """GET /analytics/mailbox/domain-wise-health-metrics"""
        data = self._get("/analytics/mailbox/domain-wise-health-metrics")
        if data is None:
            return None
        rows = self._extract_list(data, "domain_health_metrics")
        log.info("domain-wise fetched %d rows", len(rows))
        return rows

    def fetch_name_health(self) -> Optional[List[Dict]]:
        """GET /analytics/mailbox/name-wise-health-metrics"""
        data = self._get("/analytics/mailbox/name-wise-health-metrics")
        if data is None:
            return None
        rows = self._extract_list(data, "email_health_metrics")
        log.info("name-wise fetched %d rows", len(rows))
        return rows

    def fetch_mailbox_overall(self) -> Optional[Dict]:
        """GET /analytics/mailbox/overall-stats — account-wide totals"""
        return self._get("/analytics/mailbox/overall-stats")


def _rate(count: int, sent: int) -> float:
    """Compute percentage from count/sent, avoiding division by zero."""
    return round(count / sent * 100, 2) if sent > 0 else 0.0


def parse_domain_row(row: Dict) -> Dict:
    """
    Normalize one row from domain-wise-health-metrics.
    Actual API fields: domain, sent, opened, clicked, replied, unsubscribed, bounced
    Rates are computed from counts; inbox/spam not provided by this endpoint.
    """
    sent    = _safe_int(row.get("sent",    row.get("sent_count",   row.get("total_sent"))))
    bounced = _safe_int(row.get("bounced", row.get("bounce_count", row.get("total_bounce"))))
    replied = _safe_int(row.get("replied", row.get("reply_count")))
    opened  = _safe_int(row.get("opened",  row.get("open_count")))

    bounce_rate = _safe_float(row.get("bounce_rate", row.get("bounce_percentage"))) or _rate(bounced, sent)
    reply_rate  = _safe_float(row.get("reply_rate",  row.get("reply_percentage")))  or _rate(replied, sent)
    open_rate   = _safe_float(row.get("open_rate",   row.get("open_percentage")))   or _rate(opened,  sent)

    return {
        "domain":              str(row.get("domain", row.get("sending_domain", "unknown"))),
        "sent_count":          sent,
        "inbox_count":         _safe_int(row.get("inbox_count",  row.get("total_inbox"))),
        "spam_count":          _safe_int(row.get("spam_count",   row.get("total_spam"))),
        "inbox_pct":           _safe_float(row.get("inbox_percentage", row.get("inbox_pct",  row.get("inbox_rate")))),
        "spam_pct":            _safe_float(row.get("spam_percentage",  row.get("spam_pct",   row.get("spam_rate")))),
        "bounce_count":        bounced,
        "bounce_rate":         bounce_rate,
        "open_rate":           open_rate,
        "reply_rate":          reply_rate,
        "positive_reply_rate": _safe_float(row.get("positive_reply_rate", row.get("positive_reply_percentage", 0.0))),
        "mailbox_count":       _safe_int(row.get("mailbox_count", row.get("email_count", 1))),
    }


def parse_mailbox_row(row: Dict) -> Dict:
    """
    Normalize one row from name-wise-health-metrics.
    Actual API fields: from_email, sent, opened, clicked, replied, unsubscribed, bounced
    """
    email  = str(row.get("from_email", row.get("email", row.get("email_address", "unknown"))))
    domain = email.split("@")[-1] if "@" in email else "unknown"

    sent    = _safe_int(row.get("sent",    row.get("sent_count",   row.get("total_sent"))))
    bounced = _safe_int(row.get("bounced", row.get("bounce_count")))

    spam_pct    = _safe_float(row.get("spam_percentage",  row.get("spam_pct",  row.get("spam_rate"))))
    inbox_pct   = _safe_float(row.get("inbox_percentage", row.get("inbox_pct", row.get("inbox_rate"))))
    bounce_rate = _safe_float(row.get("bounce_rate", row.get("bounce_percentage"))) or _rate(bounced, sent)

    health_score = _health_score(inbox_pct, spam_pct, bounce_rate)

    return {
        "email":          email,
        "domain":         domain,
        "sent_count":     sent,
        "inbox_pct":      inbox_pct,
        "spam_pct":       spam_pct,
        "bounce_rate":    bounce_rate,
        "warmup_status":  str(row.get("warmup_status", row.get("warmup_enabled", "unknown"))),
        "tag":            str(row.get("tag", row.get("tags", ""))),
        "health_score":   round(health_score, 2),
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
        for raw in domain_rows:
            if not isinstance(raw, dict):
                log.warning("Skipping non-dict domain row (type=%s): %r", type(raw).__name__, raw)
                continue
            try:
                row = parse_domain_row(raw)
                points.append(writer.smartlead_domain_point(**row))
                log.debug(
                    "%s — sent:%d reply:%.1f%% bounce:%.1f%%",
                    row["domain"], row["sent_count"], row["reply_rate"], row["bounce_rate"],
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
        for raw in mailbox_rows:
            if not isinstance(raw, dict):
                log.warning("Skipping non-dict mailbox row (type=%s): %r", type(raw).__name__, raw)
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
        "=== Smartlead Poller done: %d domain rows, %d mailbox rows, %d points, %d alerts (%.1fs) ===",
        summary["domain_rows"], summary["mailbox_rows"], summary["influx_points_written"],
        summary["domain_alerts"], summary["duration_seconds"],
    )
    return summary


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    import json
    print(json.dumps(run(), indent=2, default=str))
