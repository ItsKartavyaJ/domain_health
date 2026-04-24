"""
Shared utility helpers used across multiple monitor modules.
"""

from typing import Any


def safe_float(val: Any, default: float = 0.0) -> float:
    try:
        return float(val if val is not None else default)
    except (TypeError, ValueError):
        return default


def safe_int(val: Any, default: int = 0) -> int:
    try:
        return int(val if val is not None else default)
    except (TypeError, ValueError):
        return default
