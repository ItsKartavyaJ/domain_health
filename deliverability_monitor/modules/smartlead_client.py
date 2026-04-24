"""
Shared Smartlead API client helper.
Modules that need date-parameterized calls should add their own date params
on top; this covers the common unauthenticated-path case.
"""

import logging
from typing import Any, Dict, Optional

import requests

from config.settings import smartlead as sl_cfg

log = logging.getLogger(__name__)


def sl_get(path: str, params: Dict = None) -> Optional[Any]:
    """Authenticated GET to Smartlead API. Returns parsed JSON or None on error."""
    base: Dict = {"api_key": sl_cfg.api_key}
    if params:
        base.update(params)
    try:
        r = requests.get(f"{sl_cfg.base_url}{path}", params=base, timeout=30)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        log.warning("Smartlead request failed %s: %s", path, e)
        return None
