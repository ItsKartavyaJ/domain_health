"""
Domain Auto-Discovery
Pulls the live sending domain and IP list directly from Smartlead at
scheduler startup. All other modules consume the result via get_domains()
and get_ips() — no manual maintenance of config/settings.py domain lists.

Discovery sources (in order of priority):
  1. GET /email-accounts/           → all connected mailboxes → extract domains
  2. GET /analytics/mailbox/domain-wise-health-metrics → domains seen sending
  3. config.settings.SENDING_DOMAINS → static fallback if Smartlead unreachable

IP discovery:
  - SENDING_IPS in settings.py (explicit, highest priority)
  - SPF record resolution for each domain (auto, finds authorized IPs)

Results are cached in module-level state and refreshed every 6h by the scheduler.
"""

import logging
import re
import time
from typing import Dict, List, Optional, Set, Tuple
from datetime import date, timedelta

import dns.resolver

from config.settings import smartlead as sl_cfg, SENDING_DOMAINS, SENDING_IPS
from modules.smartlead_client import sl_get

log = logging.getLogger(__name__)

# Regex for a valid hostname / domain name (labels separated by dots, no
# underscores, each label 1–63 chars, at least two labels required).
_DOMAIN_RE = re.compile(
    r'^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?'
    r'(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$'
)


def _is_valid_domain(value: str) -> bool:
    return bool(_DOMAIN_RE.match(value))

# ── Module-level cache ─────────────────────────────────────────────────────
_cache: Dict = {
    "domains": [],
    "ips": [],
    "mailboxes": [],   # full account objects from /email-accounts/
    "last_refresh": 0,
    "ttl_seconds": 6 * 3600,
}

PUBLIC_NS = ["8.8.8.8", "1.1.1.1"]


def _fetch_all_mailboxes() -> List[Dict]:
    """Fetch every email account from Smartlead, handling pagination."""
    all_mailboxes: List[Dict] = []
    offset = 0
    limit = 100

    while True:
        data = sl_get("/email-accounts/", {"limit": limit, "offset": offset})
        if data is None:
            break

        page = data if isinstance(data, list) else data.get("data", data.get("email_accounts", []))
        if not page:
            break

        all_mailboxes.extend(page)

        # If the page is smaller than the requested limit, we've reached the end.
        if len(page) < limit:
            break

        offset += limit

    return all_mailboxes


def _fetch_active_domains() -> List[str]:
    """Fetch domains that have sent mail recently (domain-wise analytics)."""
    start = (date.today() - timedelta(days=sl_cfg.lookback_days)).isoformat()
    end = date.today().isoformat()
    data = sl_get(
        "/analytics/mailbox/domain-wise-health-metrics",
        {"start_date": start, "end_date": end},
    )
    if not data:
        return []
    rows = data if isinstance(data, list) else data.get("data", [])
    result = []
    for row in rows:
        if isinstance(row, str):
            # Skip non-domain strings (e.g. Smartlead API key names like
            # "domain_health_metrics" that appear as the first list element).
            if _is_valid_domain(row):
                result.append(row)
        elif isinstance(row, dict) and row.get("domain"):
            result.append(str(row["domain"]))
    return result


def _resolve_spf_ips(domain: str) -> Set[str]:
    """
    Walk the SPF record for a domain and collect all authorized IP addresses.
    Handles ip4:, ip6:, include: (one level deep), and a: mechanisms.
    """
    ips: Set[str] = set()
    res = dns.resolver.Resolver()
    res.nameservers = PUBLIC_NS
    res.timeout = 3
    res.lifetime = 6

    def _fetch_spf(d: str) -> Optional[str]:
        try:
            answers = res.resolve(d, "TXT")
            for rdata in answers:
                txt = "".join(
                    s.decode() if isinstance(s, bytes) else s
                    for s in rdata.strings
                )
                if txt.startswith("v=spf1"):
                    return txt
        except Exception:
            pass
        return None

    def _parse_spf(record: str, depth: int = 0) -> None:
        if depth > 2:   # avoid infinite include loops
            return
        for token in record.split():
            try:
                if token.startswith("ip4:"):
                    ips.add(token[4:].split("/")[0])
                elif token.startswith("ip6:"):
                    ips.add(token[4:].split("/")[0])
                elif token.startswith("include:"):
                    included = _fetch_spf(token[8:])
                    if included:
                        _parse_spf(included, depth + 1)
                elif token.startswith("a:") or token == "a":
                    host = token[2:] if token.startswith("a:") else domain
                    try:
                        a_answers = res.resolve(host, "A")
                        for r in a_answers:
                            ips.add(str(r))
                    except Exception:
                        pass
            except Exception:
                continue

    record = _fetch_spf(domain)
    if record:
        _parse_spf(record)
    return ips


def refresh(force: bool = False) -> None:
    """
    Refresh the domain/IP/mailbox cache from Smartlead.
    Called at startup and every TTL seconds by the scheduler.
    """
    now = time.time()
    if not force and (now - _cache["last_refresh"]) < _cache["ttl_seconds"]:
        return

    log.info("Refreshing domain/mailbox discovery from Smartlead...")

    # ── Mailboxes ──────────────────────────────────────────────────────────
    mailboxes = _fetch_all_mailboxes()
    if not mailboxes:
        log.warning("Could not fetch mailboxes from Smartlead — using static fallback")
        _cache["domains"] = list(SENDING_DOMAINS)
        _cache["ips"] = list(SENDING_IPS)
        _cache["mailboxes"] = []
        _cache["last_refresh"] = now
        return

    _cache["mailboxes"] = mailboxes
    log.info("Discovered %d mailboxes from Smartlead", len(mailboxes))

    # ── Domains from mailboxes ─────────────────────────────────────────────
    domains: Set[str] = set()
    for mb in mailboxes:
        email = mb.get("from_email") or mb.get("email") or ""
        if "@" in email:
            domains.add(email.split("@")[1].lower().strip())

    # Merge with domains that have sent recently (catches domains with no
    # active mailboxes but still in the analytics window)
    active_domains = _fetch_active_domains()
    for d in active_domains:
        domains.add(d.lower().strip())

    # Always include static fallback domains
    for d in SENDING_DOMAINS:
        domains.add(d.lower().strip())

    domains.discard("")
    _cache["domains"] = sorted(domains)
    log.info("Total unique sending domains: %d", len(_cache["domains"]))

    # ── IPs ───────────────────────────────────────────────────────────────
    all_ips: Set[str] = set(SENDING_IPS)

    # Resolve SPF for every domain to find authorized IPs
    log.info("Resolving SPF records for IP discovery...")
    for domain in _cache["domains"]:
        spf_ips = _resolve_spf_ips(domain)
        all_ips.update(spf_ips)

    all_ips.discard("")
    _cache["ips"] = sorted(all_ips)
    _cache["last_refresh"] = now

    log.info(
        "Discovery complete — %d domains, %d IPs",
        len(_cache["domains"]),
        len(_cache["ips"]),
    )


def get_domains() -> List[str]:
    """Return current discovered domain list. Auto-refreshes if stale."""
    if not _cache["domains"]:
        refresh()
    return _cache["domains"]


def get_ips() -> List[str]:
    """Return current discovered IP list. Auto-refreshes if stale."""
    if not _cache["ips"]:
        refresh()
    return _cache["ips"]


def get_mailboxes() -> List[Dict]:
    """Return full mailbox objects from /email-accounts/."""
    if not _cache["mailboxes"]:
        refresh()
    return _cache["mailboxes"]


def get_mailbox_ids() -> List[int]:
    """Return just the numeric IDs of all mailboxes."""
    return [
        int(mb["id"])
        for mb in get_mailboxes()
        if mb.get("id")
    ]
