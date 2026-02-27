"""
In-memory designer session store.

Each session is a conversation thread keyed by session_id.
Session state is process-local (no persistence). Suitable for S4;
production would back this with Redis or a sessions table.
"""
from __future__ import annotations

from typing import TypedDict

# {session_id: [{"role": "user"|"assistant", "content": "..."}]}
_sessions: dict[str, list[dict]] = {}


class Message(TypedDict):
    role: str   # "user" | "assistant" | "system"
    content: str


def get_history(session_id: str) -> list[Message]:
    return list(_sessions.get(session_id, []))


def add_message(session_id: str, role: str, content: str) -> None:
    if session_id not in _sessions:
        _sessions[session_id] = []
    _sessions[session_id].append({"role": role, "content": content})


def clear_session(session_id: str) -> None:
    _sessions.pop(session_id, None)
