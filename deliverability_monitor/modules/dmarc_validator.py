"""
DMARC DNS Validator — checkdmarc
Validates SPF, DMARC, DKIM (via raw DNS), MTA-STS, and BIMI records for
all SENDING_DOMAINS. Results written to InfluxDB: dmarc_dns_check.

Catches misconfigurations BEFORE parsedmarc does — parsedmarc only reports
after mail has been sent and DMARC reports received.

Run standalone:  python -m modules.dmarc_validator
Called by:       scheduler.py every DMARC_CHECK_INTERVAL_HOURS
"""

import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List

import checkdmarc
import dns.resolver
from influxdb_client import Point, WritePrecision

from config.settings import alerts as alert_cfg
from modules.domain_discovery import get_domains
from modules.influx_writer import writer
from modules.alerter import send_alert

log = logging.getLogger(__name__)

# DKIM selectors to probe. Add your own selectors here.
# Google Workspace always uses "google"; others vary.
DKIM_SELECTORS = ["google", "s1", "s2", "mail", "smtp", "key1", "k1", "default"]

# Public DNS resolvers used for all lookups.
PUBLIC_NAMESERVERS = ["8.8.8.8", "1.1.1.1"]


def _resolver() -> dns.resolver.Resolver:
    """Build a dnspython resolver using public nameservers."""
    r = dns.resolver.Resolver()
    r.nameservers = PUBLIC_NAMESERVERS
    r.timeout = 5
    r.lifetime = 10
    return r


def _check_spf(domain: str) -> Dict:
    out = {"valid": False, "record": "", "error": "", "policy": ""}
    try:
        result = checkdmarc.check_spf(
            domain, nameservers=PUBLIC_NAMESERVERS, timeout=5,
        )
        out["valid"] = bool(result.get("valid", False))
        out["record"] = str(result.get("record") or "")
        out["policy"] = _spf_all_qualifier(out["record"])
        if not out["valid"]:
            out["error"] = str(result.get("error") or "SPF invalid")
    except Exception as e:
        out["error"] = str(e)
    return out


def _check_dmarc(domain: str) -> Dict:
    out = {"valid": False, "record": "", "error": "", "policy": ""}
    try:
        result = checkdmarc.check_dmarc(
            domain, nameservers=PUBLIC_NAMESERVERS, timeout=5,
        )
        out["valid"] = bool(result.get("valid", False))
        out["record"] = str(result.get("record") or "")
        tags = result.get("tags") or {}
        p_tag = tags.get("p") or {}
        out["policy"] = str(p_tag.get("value") or "")
        if not out["valid"]:
            out["error"] = str(result.get("error") or "DMARC invalid")
    except Exception as e:
        out["error"] = str(e)
    return out


def _check_dkim(domain: str) -> Dict:
    """
    checkdmarc has no check_dkim — probe via raw DNS TXT lookup per selector.
    Returns the first selector that resolves a valid DKIM public key.
    """
    out = {"valid": False, "selector": "", "record": "", "error": ""}
    res = _resolver()
    for selector in DKIM_SELECTORS:
        dkim_host = f"{selector}._domainkey.{domain}"
        try:
            answers = res.resolve(dkim_host, "TXT")
            for rdata in answers:
                txt = "".join(
                    s.decode() if isinstance(s, bytes) else s
                    for s in rdata.strings
                )
                if "v=DKIM1" in txt or "k=rsa" in txt or "p=" in txt:
                    out["valid"] = True
                    out["selector"] = selector
                    out["record"] = txt[:400]
                    return out
        except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer,
                dns.resolver.NoNameservers, dns.resolver.LifetimeTimeout):
            continue
        except Exception as e:
            log.debug("DKIM probe %s for %s: %s", selector, domain, e)
            continue
    out["error"] = f"No valid DKIM found. Selectors tried: {DKIM_SELECTORS}"
    return out


def _check_mta_sts(domain: str) -> Dict:
    out = {"valid": False, "policy": "", "error": ""}
    try:
        result = checkdmarc.check_mta_sts(
            domain, nameservers=PUBLIC_NAMESERVERS, timeout=5,
        )
        out["valid"] = bool(result.get("valid", False))
        policy_obj = result.get("policy") or {}
        out["policy"] = str(policy_obj.get("mode") or "")
        if not out["valid"]:
            out["error"] = str(result.get("error") or "MTA-STS not configured")
    except Exception as e:
        out["error"] = str(e)
    return out


def _check_bimi(domain: str) -> Dict:
    out = {"valid": False, "record": "", "error": ""}
    try:
        result = checkdmarc.check_bimi(
            domain, nameservers=PUBLIC_NAMESERVERS, timeout=5,
        )
        out["valid"] = bool(result.get("valid", False))
        out["record"] = str(result.get("record") or "")
        if not out["valid"]:
            out["error"] = str(result.get("error") or "BIMI not configured")
    except Exception as e:
        out["error"] = str(e)
    return out


def _spf_all_qualifier(record: str) -> str:
    """Extract the SPF all-qualifier (-all ~all +all ?all) from a record string."""
    for token in (record or "").split():
        if token in ("-all", "~all", "+all", "?all"):
            return token
    return ""


def validate_domain(domain: str) -> Dict[str, Any]:
    """Run full DNS validation for one domain."""
    return {
        "domain": domain,
        "spf":     _check_spf(domain),
        "dmarc":   _check_dmarc(domain),
        "dkim":    _check_dkim(domain),
        "mta_sts": _check_mta_sts(domain),
        "bimi":    _check_bimi(domain),
    }


def _score_domain(result: Dict) -> float:
    """
    0-100 DNS health score.
    SPF 25 | DMARC 35 (policy-weighted) | DKIM 25 | MTA-STS 10 | BIMI 5
    """
    score = 0.0
    if result["spf"]["valid"]:
        score += 25.0
        if result["spf"]["policy"] == "-all":
            score += 3.0
    if result["dmarc"]["valid"]:
        p = result["dmarc"]["policy"]
        score += 35.0 if p == "reject" else (24.0 if p == "quarantine" else 10.0)
    if result["dkim"]["valid"]:
        score += 25.0
    if result["mta_sts"]["valid"]:
        score += 10.0
    if result["bimi"]["valid"]:
        score += 5.0
    return min(score, 100.0)


def build_points(result: Dict) -> List[Point]:
    """Build InfluxDB points for every record type + composite score."""
    domain = result["domain"]
    now = datetime.now(timezone.utc)
    points = []

    for record_type, data in [
        ("spf",     result["spf"]),
        ("dmarc",   result["dmarc"]),
        ("dkim",    result["dkim"]),
        ("mta_sts", result["mta_sts"]),
        ("bimi",    result["bimi"]),
    ]:
        policy = str(data.get("policy", "") or data.get("selector", "") or "")
        points.append(writer.dmarc_dns_point(
            domain=domain,
            record_type=record_type,
            valid=data.get("valid", False),
            policy=policy,
            error=str(data.get("error", "")),
            raw_record=str(data.get("record", "")),
        ))

    # Composite score summary point
    score = _score_domain(result)
    points.append(
        Point("dmarc_dns_check")
        .tag("domain", domain)
        .tag("record_type", "composite_score")
        .field("score", score)
        .field("spf_valid", int(result["spf"]["valid"]))
        .field("dmarc_valid", int(result["dmarc"]["valid"]))
        .field("dkim_valid", int(result["dkim"]["valid"]))
        .field("mta_sts_valid", int(result["mta_sts"]["valid"]))
        .field("dmarc_policy", result["dmarc"]["policy"])
        .field("spf_policy", result["spf"]["policy"])
        .time(now, WritePrecision.S)
    )
    return points


def run() -> dict:
    """Main entry point. Validates all domains, writes to InfluxDB, fires alerts."""
    SENDING_DOMAINS = get_domains()
    log.info("=== DMARC Validator run started for %d domains ===", len(SENDING_DOMAINS))
    start = time.time()
    all_results, alert_domains, all_points = [], [], []

    for domain in SENDING_DOMAINS:
        try:
            result = validate_domain(domain)
            all_results.append(result)
            all_points.extend(build_points(result))
            score = _score_domain(result)
            log.info(
                "%s — SPF:%s DMARC:%s(%s) DKIM:%s MTA-STS:%s score:%.0f",
                domain,
                "✓" if result["spf"]["valid"] else "✗",
                "✓" if result["dmarc"]["valid"] else "✗",
                result["dmarc"]["policy"] or "—",
                "✓" if result["dkim"]["valid"] else "✗",
                "✓" if result["mta_sts"]["valid"] else "✗",
                score,
            )
            if score < alert_cfg.dmarc_score_threshold or not result["dmarc"]["valid"] or not result["spf"]["valid"]:
                alert_domains.append({"domain": domain, "score": score, "result": result})
        except Exception as e:
            log.error("Failed to validate %s: %s", domain, e)

    if all_points:
        writer.write_points(all_points)

    if alert_domains:
        send_alert(
            subject="⚠️ DNS Config Alert",
            body={
                "event": "dns_validation_failed",
                "domains": [
                    {
                        "domain": d["domain"],
                        "score": d["score"],
                        "spf_valid": d["result"]["spf"]["valid"],
                        "dmarc_valid": d["result"]["dmarc"]["valid"],
                        "dmarc_policy": d["result"]["dmarc"]["policy"],
                        "dkim_valid": d["result"]["dkim"]["valid"],
                        "spf_error": d["result"]["spf"]["error"],
                        "dmarc_error": d["result"]["dmarc"]["error"],
                    }
                    for d in alert_domains
                ],
            },
        )

    summary = {
        "domains_checked": len(all_results),
        "spf_valid":       sum(1 for r in all_results if r["spf"]["valid"]),
        "dmarc_valid":     sum(1 for r in all_results if r["dmarc"]["valid"]),
        "dkim_valid":      sum(1 for r in all_results if r["dkim"]["valid"]),
        "mta_sts_valid":   sum(1 for r in all_results if r["mta_sts"]["valid"]),
        "dmarc_reject":    sum(1 for r in all_results if r["dmarc"]["policy"] == "reject"),
        "dmarc_quarantine":sum(1 for r in all_results if r["dmarc"]["policy"] == "quarantine"),
        "dmarc_none":      sum(1 for r in all_results if r["dmarc"]["policy"] == "none"),
        "alerts_fired":    len(alert_domains),
        "duration_seconds":round(time.time() - start, 2),
    }
    log.info(
        "=== DMARC Validator done: SPF %d/%d  DMARC %d/%d  DKIM %d/%d (%.1fs) ===",
        summary["spf_valid"], summary["domains_checked"],
        summary["dmarc_valid"], summary["domains_checked"],
        summary["dkim_valid"], summary["domains_checked"],
        summary["duration_seconds"],
    )
    return summary


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    import json
    print(json.dumps(run(), indent=2, default=str))
