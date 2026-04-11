import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy.ext.asyncio import create_async_engine

from libs.config import settings
from libs.database import Base  # noqa: F401 — imports all models via side effects

# Import all models so Base.metadata is populated
import libs.auth.backend.models  # noqa: F401
import libs.audit.backend.models  # noqa: F401
import modules.admin.backend.invitations_models  # noqa: F401
import modules.admin.backend.workspaces_models  # noqa: F401
import modules.assets.backend.knowledge_models  # noqa: F401
import modules.communication.backend.channels_models  # noqa: F401
import modules.communication.backend.escalations_models  # noqa: F401
import modules.communication.backend.notifications_models  # noqa: F401
import modules.projects.backend.projects_models  # noqa: F401
import modules.workflows.backend.graphs_models  # noqa: F401
import modules.workflows.backend.public_workflows_models  # noqa: F401
import modules.workflows.backend.ratings_models  # noqa: F401
import modules.workflows.backend.runs_models  # noqa: F401
import modules.workflows.backend.tools_models  # noqa: F401

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
