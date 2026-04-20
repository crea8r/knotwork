from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from modules.communication.backend.channels_models import ChannelMessage
from modules.workflows.backend.runs.human_review import (
    _update_request_message_status,
    build_resolution_payload,
)


def test_build_resolution_payload_uses_member_kind_for_actor_type() -> None:
    payload = build_resolution_payload(
        current_user=SimpleNamespace(id=uuid4(), name="Operator"),
        member=SimpleNamespace(id=uuid4(), kind="agent"),
        resolution="accept_output",
    )

    assert payload.actor_type == "agent"


def test_update_request_message_status_marks_request_resolved() -> None:
    message = ChannelMessage(
        workspace_id=uuid4(),
        channel_id=uuid4(),
        role="assistant",
        author_type="system",
        content="Task",
        metadata_={
            "kind": "request",
            "request": {
                "status": "open",
                "escalation_id": str(uuid4()),
            },
        },
    )
    resolved_at = datetime(2026, 4, 20, 7, 0, tzinfo=timezone.utc)

    changed = _update_request_message_status(
        message,
        status="superseded",
        resolution="superseded_by_new_escalation",
        resolved_at=resolved_at,
        note="superseded_by_new_escalation",
    )

    assert changed is True
    assert message.metadata_["request"]["status"] == "superseded"
    assert message.metadata_["request"]["resolution"] == "superseded_by_new_escalation"
    assert message.metadata_["request"]["note"] == "superseded_by_new_escalation"
    assert message.metadata_["request"]["resolved_at"] == resolved_at.isoformat()
