"""Human-readable name generator.

Returns names like 'gigantic-kakapo-42'.
Reuse for version names, fork names, run names, API keys — any place
where a stable but human-friendly label is needed.
"""
from __future__ import annotations

import random

from coolname import generate_slug


def generate_name() -> str:
    """Return an adjective-noun-number slug, e.g. 'swift-falcon-42'."""
    return f"{generate_slug(2)}-{random.randint(1, 99)}"
