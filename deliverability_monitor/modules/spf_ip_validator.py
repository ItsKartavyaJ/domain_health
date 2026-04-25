"""
SPF IP Validator
Verifies that your actual sending IPs are authorized within each domain's
SPF record. checkdmarc validates that SPF records are syntactically correct;
this module verifies that the right IPs are actually included.

Catches the silent failure case: SPF record is valid, but a Smartlead relay
IP or your GCP IP is not in the include chain — meaning mail passes syntax
checks but fails SPF authentication at the receiving server.

InfluxDB measurement: spf_ip_validation
  tags:  domain, ip
  fields: authorized (0/1), spf_valid (0/1), mechanism_matched, error

Run standalone:  python -m modules.spf_ip_validator
Called by:       scheduler.py every SPF_IP_INTERVAL_HOURS
"""

import ipaddress
import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

import dns.resolver
import requests
from influxdb_client import Point, WritePrecision

from config.settings import smartlead as sl_cfg
from modules.domain_discovery import get_domains, get_ips
from modules.influx_writer import writer
from modules.alerter import send_alert

log = logging.getLogger(__name__)

PUBLIC_NS = ["8.8.8.8", "1.1.1.1"]
MAX_DNS_LOOKUPS = 10   # RFC 7208 limit

_spf_txt_cache: Dict[str, Optional[str]] = {}
_a_record_cache: Dict[str, List[str]] = {}
_mx_record_cache: Dict[str, List[str]] = {}


def _resolver() -> dns.resolver.Resolver:
    r = dns.resolver.Resolver()
    r.nameservers = PUBLIC_NS
    r.timeout = 4
    r.lifetime = 8
    return r


def _is_ip_in_network(ip: str, network_str: str) -> bool:
    """Check if an IP falls within a CIDR range."""
    try:
        return ipaddress.ip_address(ip) in ipaddress.ip_network(network_str, strict=False)
    except ValueError:
        return False


class SPFWalker:
    """
    Walks an SPF record recursively and checks whether a given IP is authorized.
    Tracks DNS lookup count to enforce the RFC 7208 10-lookup limit.
    """

    def __init__(self, res: dns.resolver.Resolver):
        self.res = res
        self.lookup_count = 0

    def _txt_record(self, domain: str) -> Optional[str]:
        """Fetch SPF TXT record for domain. Cache hits don't count against the lookup limit."""
        if domain in _spf_txt_cache:
            return _spf_txt_cache[domain]
        if self.lookup_count >= MAX_DNS_LOOKUPS:
            return None
        self.lookup_count += 1
        result: Optional[str] = None
        try:
            answers = self.res.resolve(domain, "TXT")
            for rdata in answers:
                txt = "".join(
                    s.decode() if isinstance(s, bytes) else s
                    for s in rdata.strings
                )
                if txt.startswith("v=spf1"):
                    result = txt
                    break
        except Exception:
            pass
        _spf_txt_cache[domain] = result
        return result

    def _resolve_a(self, domain: str) -> List[str]:
        """Resolve A records for a domain. Cache hits don't count against the lookup limit."""
        if domain in _a_record_cache:
            return _a_record_cache[domain]
        if self.lookup_count >= MAX_DNS_LOOKUPS:
            return []
        self.lookup_count += 1
        ips = []
        try:
            for rdata in self.res.resolve(domain, "A"):
                ips.append(str(rdata))
        except Exception:
            pass
        _a_record_cache[domain] = ips
        return ips

    def _resolve_mx(self, domain: str) -> List[str]:
        """Resolve MX then A records. Cache hits don't count against the lookup limit."""
        if domain in _mx_record_cache:
            return _mx_record_cache[domain]
        if self.lookup_count >= MAX_DNS_LOOKUPS:
            return []
        self.lookup_count += 1
        ips = []
        try:
            mx_records = self.res.resolve(domain, "MX")
            for mx in mx_records:
                ips.extend(self._resolve_a(str(mx.exchange).rstrip(".")))
        except Exception:
            pass
        _mx_record_cache[domain] = ips
        return ips

    def check_ip(self, ip: str, domain: str, depth: int = 0) -> Tuple[bool, str]:
        """
        Check if ip is authorized by domain's SPF record.
        Returns (authorized: bool, mechanism_matched: str).
        """
        if depth > 5:
            return False, "max_depth_exceeded"

        record = self._txt_record(domain)
        if not record:
            return False, "no_spf_record"

        for token in record.split():
            token_lower = token.lower().lstrip("+-?~")
            try:
                if token_lower.startswith("ip4:"):
                    network = token[4:]
                    if _is_ip_in_network(ip, network):
                        return True, f"ip4:{network}"

                elif token_lower.startswith("ip6:"):
                    network = token[4:]
                    if _is_ip_in_network(ip, network):
                        return True, f"ip6:{network}"

                elif token_lower.startswith("include:"):
                    included_domain = token[8:]
                    authorized, mechanism = self.check_ip(ip, included_domain, depth + 1)
                    if authorized:
                        return True, f"include:{included_domain} → {mechanism}"

                elif token_lower == "a" or token_lower.startswith("a:"):
                    target = token[2:] if token_lower.startswith("a:") else domain
                    for a_ip in self._resolve_a(target):
                        if a_ip == ip:
                            return True, f"a:{target}"

                elif token_lower == "mx" or token_lower.startswith("mx:"):
                    target = token[3:] if token_lower.startswith("mx:") else domain
                    for mx_ip in self._resolve_mx(target):
                        if mx_ip == ip:
                            return True, f"mx:{target}"

                elif token_lower.startswith("redirect="):
                    redirect_domain = token[9:]
                    return self.check_ip(ip, redirect_domain, depth + 1)

            except Exception as e:
                log.debug("SPF token error %s for %s: %s", token, domain, e)
                continue

        return False, "no_match"


def run() -> dict:
    """
    Check all discovered sending IPs against all sending domain SPF records.
    Write results to InfluxDB. Alert on any unauthorized IP.
    """
    # Clear per-run DNS caches so stale records from prior scheduled runs are not served.
    _spf_txt_cache.clear()
    _a_record_cache.clear()
    _mx_record_cache.clear()

    log.info("=== SPF IP Validator run started ===")
    start = time.time()

    domains = get_domains()
    ips = get_ips()

    if not ips:
        log.warning("No sending IPs discovered — populate SENDING_IPS in .env or ensure SPF records resolve")
        return {"skipped": True, "reason": "no_ips"}

    log.info("Checking %d IPs against %d domain SPF records", len(ips), len(domains))

    res = _resolver()
    points = []
    results = []
    unauthorized = []

    for domain in domains:
        for ip in ips:
            walker = SPFWalker(res)
            try:
                authorized, mechanism = walker.check_ip(ip, domain)
                data = {
                    "domain": domain,
                    "ip": ip,
                    "authorized": authorized,
                    "mechanism_matched": mechanism,
                    "dns_lookups": walker.lookup_count,
                    "error": "",
                }

                if authorized:
                    log.debug("%s → %s: ✓ authorized via %s", ip, domain, mechanism)
                else:
                    log.warning("%s → %s: ✗ NOT in SPF (mechanism: %s)", ip, domain, mechanism)
                    unauthorized.append(data)

            except Exception as e:
                log.error("SPF check failed %s → %s: %s", ip, domain, e)
                data = {
                    "domain": domain,
                    "ip": ip,
                    "authorized": False,
                    "mechanism_matched": "",
                    "dns_lookups": 0,
                    "error": str(e)[:200],
                }

            results.append(data)
            points.append(
                Point("spf_ip_validation")
                .tag("domain", domain)
                .tag("ip", ip)
                .field("authorized", int(data["authorized"]))
                .field("mechanism_matched", data["mechanism_matched"])
                .field("dns_lookups", data["dns_lookups"])
                .field("error", data["error"])
                .time(datetime.now(timezone.utc), WritePrecision.S)
            )

    if points:
        writer.write_points(points)

    if unauthorized:
        # Deduplicate — group by domain
        by_domain: Dict[str, List[str]] = {}
        for u in unauthorized:
            by_domain.setdefault(u["domain"], []).append(u["ip"])

        send_alert(
            subject=f"⚠️ SPF Authorization Gap — {len(unauthorized)} IP/domain pairs",
            body={
                "event": "spf_ip_not_authorized",
                "total_unauthorized": len(unauthorized),
                "by_domain": {d: ips for d, ips in by_domain.items()},
                "action": (
                    "These IPs are sending mail on behalf of these domains but are NOT "
                    "included in the SPF record. Recipients will see SPF fail. "
                    "Add the IPs to each domain's SPF record or add the Smartlead "
                    "include: mechanism."
                ),
            },
        )

    summary = {
        "domains_checked": len(domains),
        "ips_checked": len(ips),
        "total_pairs": len(results),
        "authorized": sum(1 for r in results if r["authorized"]),
        "unauthorized": len(unauthorized),
        "authorization_rate": round(
            sum(1 for r in results if r["authorized"]) / len(results) * 100, 1
        ) if results else 0,
        "duration_seconds": round(time.time() - start, 2),
    }

    log.info(
        "=== SPF IP Validator done: %d/%d pairs authorized, %d gaps (%.1fs) ===",
        summary["authorized"], summary["total_pairs"],
        summary["unauthorized"], summary["duration_seconds"],
    )
    return summary


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    import json
    print(json.dumps(run(), indent=2, default=str))
