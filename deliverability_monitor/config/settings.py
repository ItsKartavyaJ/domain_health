"""
Central configuration for deliverability_monitor.
All modules import from here — never read os.environ directly elsewhere.

Domain list is auto-discovered from Smartlead on startup (see domain_discovery.py).
SENDING_DOMAINS below is the fallback used only if Smartlead is unreachable.
"""

import os
from dataclasses import dataclass, field
from typing import List
from dotenv import load_dotenv

load_dotenv()


# ── Fallback domain list ───────────────────────────────────────────────────
# Used only if Smartlead API is unreachable at startup.
# Normally domains are auto-discovered via domain_discovery.py.
SENDING_DOMAINS: List[str] = [
    "pintel.ai",
    "launchpintel.com",
    "gtmpintel.co",
    # Add fallback domains here ↓
]

# Sending IPs for RBL IP-level checks.
# Auto-populated from Smartlead account if left empty.
SENDING_IPS: List[str] = [
    # "34.44.125.78",
]


@dataclass
class SmartleadConfig:
    api_key: str = field(default_factory=lambda: os.environ["SMARTLEAD_API_KEY"])
    base_url: str = "https://server.smartlead.ai/api/v1"
    lookback_days: int = 7
    # Batch size for warmup stats (per-mailbox calls — space them out)
    warmup_batch_delay_secs: float = field(
        default_factory=lambda: float(os.getenv("WARMUP_BATCH_DELAY_SECS", "0.3"))
    )
    # Reconnect alert: statuses that trigger an alert
    reconnect_alert_statuses: List[str] = field(
        default_factory=lambda: ["reconnect_required", "failed", "disconnected"]
    )
    # Campaign bounce alert threshold
    campaign_bounce_threshold: float = field(
        default_factory=lambda: float(os.getenv("CAMPAIGN_BOUNCE_THRESHOLD", "3.0"))
    )


@dataclass
class InfluxConfig:
    url: str = field(default_factory=lambda: os.getenv("INFLUXDB_URL", "http://localhost:8086"))
    token: str = field(default_factory=lambda: os.environ["INFLUXDB_TOKEN"])
    org: str = field(default_factory=lambda: os.getenv("INFLUXDB_ORG", "pintel"))
    bucket: str = field(default_factory=lambda: os.getenv("INFLUXDB_BUCKET", "deliverability"))


@dataclass
class PostmasterConfig:
    # Path to Google service account JSON key file
    # Service account needs: Gmail Postmaster Tools API, domain-level access
    credentials_path: str = field(
        default_factory=lambda: os.getenv("POSTMASTER_CREDENTIALS_PATH", "")
    )
    enabled: bool = field(
        default_factory=lambda: bool(os.getenv("POSTMASTER_CREDENTIALS_PATH", ""))
    )


@dataclass
class AlertConfig:
    webhook_url: str = field(default_factory=lambda: os.getenv("ALERT_WEBHOOK_URL", ""))
    spam_pct_threshold: float = field(
        default_factory=lambda: float(os.getenv("ALERT_THRESHOLD_SPAM_PCT", "30.0"))
    )
    blacklist_threshold: int = field(
        default_factory=lambda: int(os.getenv("ALERT_THRESHOLD_BLACKLIST", "1"))
    )
    dmarc_score_threshold: float = field(
        default_factory=lambda: float(os.getenv("ALERT_THRESHOLD_DMARC_SCORE", "70"))
    )
    # Postmaster Tools reputation threshold
    postmaster_bad_reputation: List[str] = field(
        default_factory=lambda: ["LOW", "BAD"]
    )
    # Daily digest time (24h UTC)
    digest_hour_utc: int = field(
        default_factory=lambda: int(os.getenv("DIGEST_HOUR_UTC", "8"))
    )


@dataclass
class ScheduleConfig:
    rbl_interval_hours: int = field(
        default_factory=lambda: int(os.getenv("RBL_CHECK_INTERVAL_HOURS", "12"))
    )
    dmarc_interval_hours: int = field(
        default_factory=lambda: int(os.getenv("DMARC_CHECK_INTERVAL_HOURS", "24"))
    )
    smartlead_interval_hours: int = field(
        default_factory=lambda: int(os.getenv("SMARTLEAD_POLL_INTERVAL_HOURS", "6"))
    )
    warmup_interval_hours: int = field(
        default_factory=lambda: int(os.getenv("WARMUP_INTERVAL_HOURS", "12"))
    )
    reconnect_interval_hours: int = field(
        default_factory=lambda: int(os.getenv("RECONNECT_INTERVAL_HOURS", "6"))
    )
    campaign_bounce_interval_hours: int = field(
        default_factory=lambda: int(os.getenv("CAMPAIGN_BOUNCE_INTERVAL_HOURS", "6"))
    )
    postmaster_interval_hours: int = field(
        default_factory=lambda: int(os.getenv("POSTMASTER_INTERVAL_HOURS", "24"))
    )
    spf_ip_interval_hours: int = field(
        default_factory=lambda: int(os.getenv("SPF_IP_INTERVAL_HOURS", "24"))
    )


# Singletons — import these in modules
smartlead = SmartleadConfig()
influx = InfluxConfig()
postmaster = PostmasterConfig()
alerts = AlertConfig()
schedule_cfg = ScheduleConfig()
