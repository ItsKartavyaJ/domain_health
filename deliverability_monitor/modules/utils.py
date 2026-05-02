"""
Shared utility helpers used across multiple monitor modules.
"""

from typing import Any


def safe_float(val: Any, default: float = 0.0) -> float:
    try:
        if isinstance(val, str):
            val = val.strip().rstrip('%')
        return float(val if val is not None else default)
    except (TypeError, ValueError):
        return default


def safe_int(val: Any, default: int = 0) -> int:
    try:
        return int(val if val is not None else default)
    except (TypeError, ValueError):
        return default


def health_score(inbox_pct: float, spam_pct: float, bounce_rate: float = 0.0) -> float:
    """Composite 0-100 health score. Higher inbox %, lower spam/bounce % → higher score."""
    raw = inbox_pct - (spam_pct * 2.0) - (bounce_rate * 3.0)
    return round(max(0.0, min(100.0, raw)), 2)
