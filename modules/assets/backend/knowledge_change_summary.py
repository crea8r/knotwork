"""
Generate short handbook change summaries from old/new content.

Uses a deterministic summary only.
"""
from __future__ import annotations

import difflib

_PROMPT = """You are generating a concise git-style change summary for a handbook file edit.

File path: {path}

Old content (truncated):
---
{old_content}
---

New content (truncated):
---
{new_content}
---

Write ONE sentence, plain English, max 16 words, describing the key change.
Be specific and action-oriented. No quotes. No markdown. No prefix labels.
"""


def _fallback_summary(path: str, old_content: str, new_content: str) -> str:
    old_lines = old_content.splitlines()
    new_lines = new_content.splitlines()
    diff = list(difflib.unified_diff(old_lines, new_lines, n=0))
    added = sum(1 for ln in diff if ln.startswith("+") and not ln.startswith("+++"))
    removed = sum(1 for ln in diff if ln.startswith("-") and not ln.startswith("---"))
    if added == 0 and removed == 0:
        return f"No content change in {path}"
    return f"Update {path}: +{added} / -{removed} lines"


async def generate_change_summary(path: str, old_content: str, new_content: str) -> str:
    """Return a short summary sentence for handbook edits."""
    if old_content == new_content:
        return f"No content change in {path}"

    prompt = _PROMPT.format(
        path=path,
        old_content=old_content[:3000],
        new_content=new_content[:3000],
    )

    return _fallback_summary(path, old_content, new_content)
