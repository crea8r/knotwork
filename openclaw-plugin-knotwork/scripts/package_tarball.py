#!/usr/bin/env python3
"""Build a distributable .tar.gz for the OpenClaw plugin."""

from __future__ import annotations

import json
import tarfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PACKAGE_JSON = ROOT / "package.json"
ARTIFACTS_DIR = ROOT / "artifacts"

EXCLUDE_NAMES = {
    ".DS_Store",
    "node_modules",
    "artifacts",
}


def load_metadata() -> tuple[str, str]:
    data = json.loads(PACKAGE_JSON.read_text())
    name = str(data["name"]).split("/")[-1]
    version = str(data["version"])
    return name, version


def should_include(path: Path) -> bool:
    rel = path.relative_to(ROOT)
    return not any(part in EXCLUDE_NAMES for part in rel.parts)


def main() -> None:
    name, version = load_metadata()
    archive_name = f"{name}-{version}.tar.gz"
    archive_path = ARTIFACTS_DIR / archive_name
    prefix = f"{name}-{version}"

    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)

    with tarfile.open(archive_path, "w:gz") as tar:
        for path in sorted(ROOT.rglob("*")):
            if not should_include(path):
                continue
            rel = path.relative_to(ROOT)
            tar.add(path, arcname=f"{prefix}/{rel}")

    print(archive_path)


if __name__ == "__main__":
    main()
