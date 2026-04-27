"""
Shared Smartlead API client helper.
Modules that need date-parameterized calls should add their own date params
on top; this covers the common unauthenticated-path case.
"""

import logging
import time
from typing import Any, Dict, Optional

import requests

from config.settings import smartlead as sl_cfg

log = logging.getLogger(__name__)

_MAX_RETRIES = 4
_RETRY_BACKOFF = [5, 15, 45, 90]  # seconds between attempts — generous for 429 rate limits


def sl_get(path: str, params: Dict = None) -> Optional[Any]:
    """Authenticated GET to Smartlead API. Returns parsed JSON or None on error.

    Retries up to 4 times with exponential backoff on 429/5xx responses.
    """
    base: Dict = {"api_key": sl_cfg.api_key}
    if params:
        base.update(params)

    for attempt in range(_MAX_RETRIES):
        try:
            r = requests.get(f"{sl_cfg.base_url}{path}", params=base, timeout=30)
            if r.status_code in (429, 500, 502, 503, 504) and attempt < _MAX_RETRIES - 1:
                delay = _RETRY_BACKOFF[attempt]
                log.warning(
                    "Smartlead %s returned %d — retrying in %ds (attempt %d/%d)",
                    path, r.status_code, delay, attempt + 1, _MAX_RETRIES,
                )
                time.sleep(delay)
                continue
            r.raise_for_status()
            return r.json()
        except requests.exceptions.RequestException as e:
            if attempt < _MAX_RETRIES - 1:
                delay = _RETRY_BACKOFF[attempt]
                log.warning(
                    "Smartlead request failed %s: %s — retrying in %ds (attempt %d/%d)",
                    path, e, delay, attempt + 1, _MAX_RETRIES,
                )
                time.sleep(delay)
            else:
                log.warning("Smartlead request failed %s after %d attempts: %s", path, _MAX_RETRIES, e)
                return None
    return None
