"""
Shared InfluxDB writer.
All modules call write_points() with their own measurement names.

Measurements written:
  - rbl_check          (rbl_monitor.py)
  - dmarc_dns_check    (dmarc_validator.py)
  - smartlead_health   (smartlead_health.py)
  - warmup_stats       (warmup_stats.py)
  - mailbox_status     (reconnect_monitor.py)
  - campaign_bounce    (campaign_bounce.py)
  - postmaster_metrics (postmaster_monitor.py)
  - spf_ip_validation  (spf_ip_validator.py)
"""

import logging
from datetime import datetime, timezone
from typing import List

from influxdb_client import InfluxDBClient, Point, WritePrecision
from influxdb_client.client.write_api import SYNCHRONOUS

from config.settings import influx as cfg

log = logging.getLogger(__name__)


class InfluxWriter:
    def __init__(self):
        self._client = InfluxDBClient(
            url=cfg.url,
            token=cfg.token,
            org=cfg.org,
        )
        self._write_api = self._client.write_api(write_options=SYNCHRONOUS)

    def write_points(self, points: List[Point]) -> None:
        try:
            self._write_api.write(bucket=cfg.bucket, org=cfg.org, record=points)
            log.info("Wrote %d points to InfluxDB", len(points))
        except Exception as e:
            log.error("InfluxDB write failed: %s", e)
            raise

    def close(self):
        self._client.close()

    # ── Point builders ────────────────────────────────────────────────────

    @staticmethod
    def rbl_point(
        domain: str,
        blacklisted: bool,
        list_count: int,
        detected_by: List[str],
        categories: List[str],
        check_type: str = "domain",
    ) -> Point:
        return (
            Point("rbl_check")
            .tag("domain", domain)
            .tag("check_type", check_type)
            .field("blacklisted", int(blacklisted))
            .field("list_count", list_count)
            .field("detected_by", ",".join(detected_by) if detected_by else "")
            .field("categories", ",".join(str(c) for c in categories) if categories else "")
            .time(datetime.now(timezone.utc), WritePrecision.S)
        )

    @staticmethod
    def dmarc_dns_point(
        domain: str,
        record_type: str,
        valid: bool,
        policy: str = "",
        error: str = "",
        raw_record: str = "",
    ) -> Point:
        return (
            Point("dmarc_dns_check")
            .tag("domain", domain)
            .tag("record_type", record_type)
            .field("valid", int(valid))
            .field("policy", policy)
            .field("error", error[:200])
            .field("raw_record", raw_record[:500])
            .time(datetime.now(timezone.utc), WritePrecision.S)
        )

    @staticmethod
    def smartlead_domain_point(
        domain: str,
        sent_count: int,
        inbox_count: int,
        spam_count: int,
        inbox_pct: float,
        spam_pct: float,
        bounce_count: int,
        bounce_rate: float,
        open_rate: float,
        reply_rate: float,
        mailbox_count: int,
    ) -> Point:
        return (
            Point("smartlead_health")
            .tag("domain", domain)
            .tag("grain", "domain")
            .field("sent_count", sent_count)
            .field("inbox_count", inbox_count)
            .field("spam_count", spam_count)
            .field("inbox_pct", inbox_pct)
            .field("spam_pct", spam_pct)
            .field("bounce_count", bounce_count)
            .field("bounce_rate", bounce_rate)
            .field("open_rate", open_rate)
            .field("reply_rate", reply_rate)
            .field("mailbox_count", mailbox_count)
            .time(datetime.now(timezone.utc), WritePrecision.S)
        )

    @staticmethod
    def smartlead_mailbox_point(
        email: str,
        domain: str,
        sent_count: int,
        inbox_pct: float,
        spam_pct: float,
        bounce_rate: float,
        warmup_status: str,
        tag: str,
        health_score: float,
    ) -> Point:
        return (
            Point("smartlead_health")
            .tag("domain", domain)
            .tag("email", email)
            .tag("grain", "mailbox")
            .field("sent_count", sent_count)
            .field("inbox_pct", inbox_pct)
            .field("spam_pct", spam_pct)
            .field("bounce_rate", bounce_rate)
            .field("warmup_status", warmup_status)
            .field("tag", tag)
            .field("health_score", health_score)
            .time(datetime.now(timezone.utc), WritePrecision.S)
        )


class _LazyWriter:
    """Defers InfluxWriter construction until first write_points() call.
    This avoids crashing at import time when INFLUXDB_TOKEN is missing."""

    def __init__(self):
        self._writer: InfluxWriter | None = None

    def _get(self) -> InfluxWriter:
        if self._writer is None:
            self._writer = InfluxWriter()
        return self._writer

    def write_points(self, points: List[Point]) -> None:
        self._get().write_points(points)

    def close(self) -> None:
        if self._writer:
            self._writer.close()

    def __getattr__(self, name):
        return getattr(self._get(), name)


writer = _LazyWriter()
