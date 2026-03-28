import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy.ext.asyncio import create_async_engine

from knotwork.config import settings
from knotwork.database import Base  # noqa: F401 — imports all models via side effects

# Import all models so Base.metadata is populated
import knotwork.auth.models       # noqa: F401
import knotwork.workspaces.models  # noqa: F401
import knotwork.workspaces.invitations.models  # noqa: F401
import knotwork.graphs.models      # noqa: F401
import knotwork.runs.models        # noqa: F401
import knotwork.knowledge.models   # noqa: F401
import knotwork.tools.models       # noqa: F401
import knotwork.escalations.models # noqa: F401
import knotwork.ratings.models     # noqa: F401
import knotwork.audit.models       # noqa: F401
import knotwork.notifications.models  # noqa: F401
import knotwork.channels.models    # noqa: F401
import knotwork.public_workflows.models  # noqa: F401
import knotwork.registered_agents.models  # noqa: F401
import knotwork.openclaw_integrations.models  # noqa: F401

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=settings.database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(sync_conn) -> None:
    context.configure(connection=sync_conn, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    engine = create_async_engine(settings.database_url)
    async with engine.connect() as conn:
        await conn.run_sync(do_run_migrations)
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
