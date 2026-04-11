#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.api.main import create_app  # noqa: E402


def main() -> None:
    app = create_app()
    schema = app.openapi()

    output_path = ROOT / "docs" / "sysdesign" / "interfaces" / "api" / "openapi-baseline.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(schema, indent=2, sort_keys=True) + "\n")

    tag_counts = Counter()
    for operations in schema.get("paths", {}).values():
        for method, operation in operations.items():
            if method.startswith("x-"):
                continue
            for tag in operation.get("tags", ["untagged"]):
                tag_counts[tag] += 1

    print(f"Wrote {output_path}")
    print(f"OpenAPI version: {schema.get('openapi')}")
    print(f"Paths: {len(schema.get('paths', {}))}")
    print("Operations by tag:")
    for tag, count in sorted(tag_counts.items()):
        print(f"- {tag}: {count}")


if __name__ == "__main__":
    main()
