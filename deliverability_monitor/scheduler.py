"""
Deliverability Monitor — Main Scheduler
Runs all modules on independent schedules. On startup, auto-discovers
domains and IPs from Smartlead before any module runs.

Usage:
  python scheduler.py              # long-running daemon (systemd/Docker)
  python scheduler.py --once       # run everything once and exit (cron)
  python scheduler.py --module X   # run one module and exit

Modules:
  discovery      — refresh domain/IP list from Smartlead
  dmarc          — DNS validation (SPF/DMARC/DKIM/MTA-STS/BIMI)
  rbl            — DNSBL blacklist check (domains + IPs)
  spf_ip         — SPF IP authorization validation
  smartlead      — domain/mailbox health metrics
  warmup         — per-mailbox warmup stats (replaces spam_audit.py)
  reconnect      — mailbox connection status
  campaign       — per-campaign bounce rate
  postmaster     — Google Postmaster Tools reputation
  digest         — daily summary digest to n8n
"""

import argparse
import logging
import os
import sys
import time
from pathlib import Path
from typing import Callable

import schedule

from config.settings import schedule_cfg as sched, alerts as alert_cfg

# ── Logging ────────────────────────────────────────────────────────────────
_log_file = Path(os.getenv("LOG_FILE", "/var/log/deliverability_monitor.log"))
_handlers: list = [logging.StreamHandler(sys.stdout)]
if _log_file.parent.exists():
    _handlers.append(logging.FileHandler(_log_file, mode="a"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=_handlers,
)
log = logging.getLogger("scheduler")


def _run_safe(name: str, fn: Callable) -> None:
    """Wrap any module run() so one failure never kills the scheduler."""
    log.info("▶ Starting: %s", name)
    try:
        result = fn()
        log.info("✔ Done: %s — %s", name, result)
    except Exception as e:
        log.exception("✘ Failed: %s — %s", name, e)


# ── Module runners ─────────────────────────────────────────────────────────

def run_discovery():
    from modules.domain_discovery import refresh
    _run_safe("domain_discovery", lambda: refresh(force=True))

def run_dmarc():
    from modules.dmarc_validator import run
    _run_safe("dmarc_validator", run)

def run_rbl():
    from modules.rbl_monitor import run
    _run_safe("rbl_monitor", run)

def run_spf_ip():
    from modules.spf_ip_validator import run
    _run_safe("spf_ip_validator", run)

def run_smartlead():
    from modules.smartlead_health import run
    _run_safe("smartlead_health", run)

def run_warmup():
    from modules.warmup_stats import run
    _run_safe("warmup_stats", run)

def run_reconnect():
    from modules.reconnect_monitor import run
    _run_safe("reconnect_monitor", run)

def run_campaign():
    from modules.campaign_bounce import run
    _run_safe("campaign_bounce", run)

def run_postmaster():
    from modules.postmaster_monitor import run
    _run_safe("postmaster_monitor", run)


def run_digest():
    from modules.daily_digest import run
    _run_safe("daily_digest", run)


MODULE_MAP = {
    "discovery":  run_discovery,
    "dmarc":      run_dmarc,
    "rbl":        run_rbl,
    "spf_ip":     run_spf_ip,
    "smartlead":  run_smartlead,
    "warmup":     run_warmup,
    "reconnect":  run_reconnect,
    "campaign":   run_campaign,
    "postmaster": run_postmaster,
    "digest":     run_digest,
}


def setup_schedule():
    """Register all modules with the schedule library."""
    # Discovery runs most frequently — keeps domain list fresh
    schedule.every(6).hours.do(run_discovery)

    # Core checks
    schedule.every(sched.dmarc_interval_hours).hours.do(run_dmarc)
    schedule.every(sched.rbl_interval_hours).hours.do(run_rbl)
    schedule.every(sched.spf_ip_interval_hours).hours.do(run_spf_ip)

    # Smartlead API checks
    schedule.every(sched.smartlead_interval_hours).hours.do(run_smartlead)
    schedule.every(sched.warmup_interval_hours).hours.do(run_warmup)
    schedule.every(sched.reconnect_interval_hours).hours.do(run_reconnect)
    schedule.every(sched.campaign_bounce_interval_hours).hours.do(run_campaign)

    # External API checks
    schedule.every(sched.postmaster_interval_hours).hours.do(run_postmaster)
    # Daily digest at configured UTC hour
    schedule.every().day.at(f"{alert_cfg.digest_hour_utc:02d}:00").do(run_digest)

    log.info(
        "Schedules registered:\n"
        "  Discovery   every 6h\n"
        "  DMARC DNS   every %dh\n"
        "  RBL         every %dh\n"
        "  SPF/IP      every %dh\n"
        "  Smartlead   every %dh\n"
        "  Warmup      every %dh\n"
        "  Reconnect   every %dh\n"
        "  Campaign    every %dh\n"
        "  Postmaster  every %dh\n"
        "  Digest      daily at %02d:00 UTC",
        sched.dmarc_interval_hours,
        sched.rbl_interval_hours,
        sched.spf_ip_interval_hours,
        sched.smartlead_interval_hours,
        sched.warmup_interval_hours,
        sched.reconnect_interval_hours,
        sched.campaign_bounce_interval_hours,
        sched.postmaster_interval_hours,
        alert_cfg.digest_hour_utc,
    )


def run_all_once():
    """
    Run every module once in dependency order.
    Discovery must run first to populate domain/IP/mailbox lists.
    """
    log.info("=== Running all modules once ===")

    # 1. Discovery — must be first
    run_discovery()

    # 2. DNS/network checks (no Smartlead API needed)
    run_dmarc()
    run_rbl()
    run_spf_ip()

    # 3. Smartlead API checks (use discovered mailbox list)
    run_smartlead()
    run_warmup()
    run_reconnect()
    run_campaign()

    # 4. External APIs
    run_postmaster()

    # 5. Digest last (reads from InfluxDB — all data must be written first)
    run_digest()

    log.info("=== All modules complete ===")


def main():
    parser = argparse.ArgumentParser(description="Deliverability Monitor Scheduler")
    parser.add_argument(
        "--once",
        action="store_true",
        help="Run all modules once and exit",
    )
    parser.add_argument(
        "--module",
        choices=sorted(MODULE_MAP.keys()),
        help="Run a single module once and exit",
    )
    args = parser.parse_args()

    if args.module:
        # For non-discovery modules, ensure domain list is populated first
        if args.module != "discovery":
            run_discovery()
        log.info("Running single module: %s", args.module)
        MODULE_MAP[args.module]()
        return

    if args.once:
        run_all_once()
        return

    # ── Long-running daemon mode ───────────────────────────────────────────
    log.info("=== Deliverability Monitor starting (long-running mode) ===")

    # Run everything immediately on startup
    run_all_once()

    setup_schedule()

    log.info("Entering schedule loop — Ctrl-C to stop")
    while True:
        try:
            schedule.run_pending()
            time.sleep(30)
        except KeyboardInterrupt:
            log.info("Scheduler stopped by user")
            break
        except Exception as e:
            log.exception("Unexpected error in schedule loop: %s", e)
            time.sleep(60)


if __name__ == "__main__":
    main()
