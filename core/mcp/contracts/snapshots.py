from __future__ import annotations

import hashlib
from datetime import datetime, UTC
from pathlib import Path

from libs.config import settings

from .render import render_mcp_contract_registry_markdown
from .registry import list_mcp_contracts


def persist_mcp_contract_snapshot(*, distribution_code: str) -> dict[str, str]:
    generated_at = datetime.now(UTC).isoformat()
    manifests = list_mcp_contracts()
    manifests.sort(key=lambda item: str(item.id or ""))
    body = render_mcp_contract_registry_markdown(
        distribution_code=distribution_code,
        generated_at=generated_at,
        manifests=manifests,
    )
    checksum = hashlib.sha256(body.encode("utf-8")).hexdigest()

    output_dir = Path(settings.mcp_contract_snapshot_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    snapshot_path = output_dir / "registry.md"
    checksum_path = output_dir / "registry.sha256"

    snapshot_path.write_text(body, encoding="utf-8")
    checksum_path.write_text(f"{checksum}\n", encoding="utf-8")

    return {
        "snapshot_path": str(snapshot_path),
        "checksum_path": str(checksum_path),
        "checksum": checksum,
    }
