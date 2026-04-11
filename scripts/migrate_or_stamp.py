#!/usr/bin/env python3
"""Run Alembic migrations, or stamp legacy dev databases to the new baseline.

This project intentionally reset Alembic history to a single clean baseline.
Fresh installs should always run `alembic upgrade head`.
Older local/dev databases may still point at removed revision ids; in that case,
if the schema already has application tables, we stamp the DB to the new head.
"""

from __future__ import annotations

import asyncio
import subprocess
import sys
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from libs.config import settings


LEGACY_REVISION_ERROR = "Can't locate revision identified by"
ALEMBIC_INI = ROOT / "alembic.ini"


async def _has_existing_schema() -> bool:
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    try:
        async with engine.connect() as conn:
            result = await conn.execute(
                text(
                    """
                    select count(*)
                    from pg_tables
                    where schemaname = 'public'
                      and tablename not in ('alembic_version')
                    """
                )
            )
            return int(result.scalar_one()) > 0
    finally:
        await engine.dispose()


async def _stamp_revision_direct(revision: str) -> None:
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    try:
        async with engine.begin() as conn:
            await conn.execute(text("create table if not exists alembic_version (version_num varchar(32) not null)"))
            result = await conn.execute(text("select count(*) from alembic_version"))
            row_count = int(result.scalar_one())
            if row_count == 0:
                await conn.execute(
                    text("insert into alembic_version (version_num) values (:revision)"),
                    {"revision": revision},
                )
            else:
                await conn.execute(
                    text("update alembic_version set version_num = :revision"),
                    {"revision": revision},
                )
    finally:
        await engine.dispose()


def _run(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ("alembic", "-c", str(ALEMBIC_INI), *args[1:]) if args and args[0] == "alembic" else args,
        text=True,
        capture_output=True,
    )


async def main() -> int:
    upgrade = _run("alembic", "upgrade", "head")
    if upgrade.returncode == 0:
        sys.stdout.write(upgrade.stdout)
        sys.stderr.write(upgrade.stderr)
        return 0

    combined = f"{upgrade.stdout}\n{upgrade.stderr}"
    if LEGACY_REVISION_ERROR not in combined:
        sys.stdout.write(upgrade.stdout)
        sys.stderr.write(upgrade.stderr)
        return upgrade.returncode

    if not await _has_existing_schema():
        sys.stdout.write(upgrade.stdout)
        sys.stderr.write(upgrade.stderr)
        return upgrade.returncode

    sys.stderr.write(
        "Legacy Alembic revision detected on an existing schema. "
        "Stamping database to the new clean baseline.\n"
    )
    await _stamp_revision_direct("0001_initial_clean")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
