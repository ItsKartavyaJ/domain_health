"""
RBL Monitor — pydnsbl
Checks all SENDING_DOMAINS and SENDING_IPS against 50+ DNSBL providers
asynchronously. Results written to InfluxDB measurement: rbl_check.

Run standalone:  python -m modules.rbl_monitor
Called by:       scheduler.py every RBL_CHECK_INTERVAL_HOURS
"""

import logging
import time
from typing import List, Tuple

import pydnsbl
from pydnsbl import DNSBLDomainChecker, DNSBLIpChecker
from pydnsbl.providers import BASE_PROVIDERS, BASE_DOMAIN_PROVIDERS

from config.settings import alerts as alert_cfg
from modules.domain_discovery import get_domains, get_ips
from modules.influx_writer import writer
from modules.alerter import send_alert

log = logging.getLogger(__name__)


# ── Provider configuration ──────────────────────────────────────────────────
# BASE_PROVIDERS:        42 IP-level DNSBLs (Spamhaus ZEN, Barracuda, SORBS…)
# BASE_DOMAIN_PROVIDERS: 4 domain-level DNSBLs (dbl.spamhaus.org, surbl, uribl…)
# pydnsbl splits IP and domain checkers — each uses its own provider list.


def _build_checkers():
    # Domain checker uses domain-specific DNSBL providers
    domain_checker = DNSBLDomainChecker(providers=BASE_DOMAIN_PROVIDERS)
    # IP checker uses the full 42-provider IP DNSBL list
    ip_checker = DNSBLIpChecker(providers=BASE_PROVIDERS)
    return domain_checker, ip_checker


def check_domains(domain_checker: DNSBLDomainChecker, domains: List[str]) -> List[dict]:
    """Async check all domains against DNSBL. Returns list of result dicts."""
    results = []

    log.info("Checking %d domains against %d DNSBL providers...", len(domains), len(BASE_DOMAIN_PROVIDERS))

    for domain in domains:
        try:
            result = domain_checker.check(domain)
            entry = {
                "target": domain,
                "check_type": "domain",
                "blacklisted": result.blacklisted,
                "list_count": len(result.detected_by),
                "detected_by": [str(p) for p in result.detected_by],
                "categories": list(result.categories),
            }
            results.append(entry)

            if result.blacklisted:
                log.warning(
                    "DOMAIN BLACKLISTED: %s — detected by: %s",
                    domain,
                    ", ".join(str(p) for p in result.detected_by),
                )
        except Exception as e:
            log.error("RBL domain check failed for %s: %s", domain, e)
            results.append({
                "target": domain,
                "check_type": "domain",
                "blacklisted": False,
                "list_count": 0,
                "detected_by": [],
                "categories": [],
                "error": str(e),
            })

    return results


def check_ips(ip_checker: DNSBLIpChecker, ips: List[str]) -> List[dict]:
    """Async check all sending IPs against DNSBL."""
    results = []

    if not ips:
        log.info("No SENDING_IPS configured — skipping IP RBL checks.")
        return results

    log.info("Checking %d IPs against %d DNSBL providers...", len(ips), len(BASE_PROVIDERS))

    for ip in ips:
        try:
            result = ip_checker.check(ip)
            entry = {
                "target": ip,
                "check_type": "ip",
                "blacklisted": result.blacklisted,
                "list_count": len(result.detected_by),
                "detected_by": [str(p) for p in result.detected_by],
                "categories": list(result.categories),
            }
            results.append(entry)

            if result.blacklisted:
                log.warning(
                    "IP BLACKLISTED: %s — detected by: %s",
                    ip,
                    ", ".join(str(p) for p in result.detected_by),
                )
        except Exception as e:
            log.error("RBL IP check failed for %s: %s", ip, e)

    return results


def write_results(domain_results: List[dict], ip_results: List[dict]) -> None:
    """Write all results to InfluxDB and fire alerts for any blacklisted entries."""
    points = []
    alerts_to_fire = []

    for r in domain_results + ip_results:
        # InfluxDB point — use domain field for both domains and IPs
        # For IPs, we tag the IP itself as the domain value so Grafana can filter
        points.append(
            writer.rbl_point(
                domain=r["target"],
                blacklisted=r.get("blacklisted", False),
                list_count=r.get("list_count", 0),
                detected_by=r.get("detected_by", []),
                categories=r.get("categories", []),
                check_type=r.get("check_type", "domain"),
            )
        )

        # Collect alerts
        if r.get("blacklisted") and r.get("list_count", 0) >= alert_cfg.blacklist_threshold:
            alerts_to_fire.append({
                "target": r["target"],
                "check_type": r["check_type"],
                "list_count": r["list_count"],
                "detected_by": r["detected_by"],
            })

    if points:
        writer.write_points(points)

    # Fire consolidated alert if any blacklists detected
    if alerts_to_fire:
        send_alert(
            subject="🚨 DNSBL Blacklist Alert",
            body={
                "event": "blacklist_detected",
                "entries": alerts_to_fire,
                "total_blacklisted": len(alerts_to_fire),
            },
        )


def run() -> dict:
    """
    Main entry point. Runs domain + IP checks, writes to InfluxDB.
    Returns summary dict for scheduler logging.
    """
    log.info("=== RBL Monitor run started ===")
    start = time.time()

    domain_checker, ip_checker = _build_checkers()
    domain_results = check_domains(domain_checker, get_domains())
    ip_results = check_ips(ip_checker, get_ips())

    write_results(domain_results, ip_results)

    blacklisted_domains = [r for r in domain_results if r.get("blacklisted")]
    blacklisted_ips = [r for r in ip_results if r.get("blacklisted")]

    summary = {
        "domains_checked": len(domain_results),
        "ips_checked": len(ip_results),
        "domains_blacklisted": len(blacklisted_domains),
        "ips_blacklisted": len(blacklisted_ips),
        "blacklisted_domains": [r["target"] for r in blacklisted_domains],
        "blacklisted_ips": [r["target"] for r in blacklisted_ips],
        "duration_seconds": round(time.time() - start, 2),
    }

    log.info(
        "=== RBL Monitor done: %d/%d domains clean, %d/%d IPs clean (%.1fs) ===",
        summary["domains_checked"] - summary["domains_blacklisted"],
        summary["domains_checked"],
        summary["ips_checked"] - summary["ips_blacklisted"],
        summary["ips_checked"],
        summary["duration_seconds"],
    )
    return summary


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    import json
    print(json.dumps(run(), indent=2))
