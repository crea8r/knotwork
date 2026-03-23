"""short run ids

Revision ID: 0006_short_run_ids
Revises: 0005_escalation_questions
Create Date: 2026-03-21
"""
from alembic import op
import sqlalchemy as sa

revision = '0006_short_run_ids'
down_revision = '0005_escalation_questions'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop all FK constraints that reference runs.id first.
    # Constraint names were confirmed from the live database.
    with op.batch_alter_table('run_node_states') as batch_op:
        batch_op.drop_constraint('run_node_states_run_id_fkey', type_='foreignkey')
    with op.batch_alter_table('run_worklog_entries') as batch_op:
        batch_op.drop_constraint('run_worklog_entries_run_id_fkey', type_='foreignkey')
    with op.batch_alter_table('run_handbook_proposals') as batch_op:
        batch_op.drop_constraint('run_handbook_proposals_run_id_fkey', type_='foreignkey')
    with op.batch_alter_table('openai_call_logs') as batch_op:
        batch_op.drop_constraint('openai_call_logs_run_id_fkey', type_='foreignkey')
    with op.batch_alter_table('escalations') as batch_op:
        batch_op.drop_constraint('escalations_run_id_fkey', type_='foreignkey')
    with op.batch_alter_table('ratings') as batch_op:
        batch_op.drop_constraint('ratings_run_id_fkey', type_='foreignkey')
    with op.batch_alter_table('channel_messages') as batch_op:
        batch_op.drop_constraint('channel_messages_run_id_fkey', type_='foreignkey')
    with op.batch_alter_table('decision_events') as batch_op:
        batch_op.drop_constraint('decision_events_run_id_fkey', type_='foreignkey')
    with op.batch_alter_table('openclaw_execution_tasks') as batch_op:
        batch_op.drop_constraint('openclaw_execution_tasks_run_id_fkey', type_='foreignkey')
    with op.batch_alter_table('public_run_shares') as batch_op:
        batch_op.drop_constraint('public_run_shares_run_id_fkey', type_='foreignkey')

    # Change the primary key column type on runs
    op.execute("ALTER TABLE runs ALTER COLUMN id TYPE VARCHAR(36) USING id::text")

    # Change all FK columns
    op.execute("ALTER TABLE run_node_states ALTER COLUMN run_id TYPE VARCHAR(36) USING run_id::text")
    op.execute("ALTER TABLE run_worklog_entries ALTER COLUMN run_id TYPE VARCHAR(36) USING run_id::text")
    op.execute("ALTER TABLE run_handbook_proposals ALTER COLUMN run_id TYPE VARCHAR(36) USING run_id::text")
    op.execute("ALTER TABLE openai_call_logs ALTER COLUMN run_id TYPE VARCHAR(36) USING run_id::text")
    op.execute("ALTER TABLE escalations ALTER COLUMN run_id TYPE VARCHAR(36) USING run_id::text")
    op.execute("ALTER TABLE ratings ALTER COLUMN run_id TYPE VARCHAR(36) USING run_id::text")
    op.execute("ALTER TABLE channel_messages ALTER COLUMN run_id TYPE VARCHAR(36) USING run_id::text")
    op.execute("ALTER TABLE decision_events ALTER COLUMN run_id TYPE VARCHAR(36) USING run_id::text")
    op.execute("ALTER TABLE openclaw_execution_tasks ALTER COLUMN run_id TYPE VARCHAR(36) USING run_id::text")
    op.execute("ALTER TABLE public_run_shares ALTER COLUMN run_id TYPE VARCHAR(36) USING run_id::text")

    # Recreate FK constraints
    op.create_foreign_key(
        'run_node_states_run_id_fkey', 'run_node_states', 'runs', ['run_id'], ['id'])
    op.create_foreign_key(
        'run_worklog_entries_run_id_fkey', 'run_worklog_entries', 'runs', ['run_id'], ['id'],
        ondelete='CASCADE')
    op.create_foreign_key(
        'run_handbook_proposals_run_id_fkey', 'run_handbook_proposals', 'runs', ['run_id'], ['id'],
        ondelete='CASCADE')
    op.create_foreign_key(
        'openai_call_logs_run_id_fkey', 'openai_call_logs', 'runs', ['run_id'], ['id'],
        ondelete='CASCADE')
    op.create_foreign_key(
        'escalations_run_id_fkey', 'escalations', 'runs', ['run_id'], ['id'])
    op.create_foreign_key(
        'ratings_run_id_fkey', 'ratings', 'runs', ['run_id'], ['id'])
    op.create_foreign_key(
        'channel_messages_run_id_fkey', 'channel_messages', 'runs', ['run_id'], ['id'])
    op.create_foreign_key(
        'decision_events_run_id_fkey', 'decision_events', 'runs', ['run_id'], ['id'])
    op.create_foreign_key(
        'openclaw_execution_tasks_run_id_fkey', 'openclaw_execution_tasks', 'runs', ['run_id'], ['id'],
        ondelete='CASCADE')
    op.create_foreign_key(
        'public_run_shares_run_id_fkey', 'public_run_shares', 'runs', ['run_id'], ['id'],
        ondelete='CASCADE')


def downgrade() -> None:
    # Drop FK constraints
    with op.batch_alter_table('run_node_states') as batch_op:
        batch_op.drop_constraint('run_node_states_run_id_fkey', type_='foreignkey')
    with op.batch_alter_table('run_worklog_entries') as batch_op:
        batch_op.drop_constraint('run_worklog_entries_run_id_fkey', type_='foreignkey')
    with op.batch_alter_table('run_handbook_proposals') as batch_op:
        batch_op.drop_constraint('run_handbook_proposals_run_id_fkey', type_='foreignkey')
    with op.batch_alter_table('openai_call_logs') as batch_op:
        batch_op.drop_constraint('openai_call_logs_run_id_fkey', type_='foreignkey')
    with op.batch_alter_table('escalations') as batch_op:
        batch_op.drop_constraint('escalations_run_id_fkey', type_='foreignkey')
    with op.batch_alter_table('ratings') as batch_op:
        batch_op.drop_constraint('ratings_run_id_fkey', type_='foreignkey')
    with op.batch_alter_table('channel_messages') as batch_op:
        batch_op.drop_constraint('channel_messages_run_id_fkey', type_='foreignkey')
    with op.batch_alter_table('decision_events') as batch_op:
        batch_op.drop_constraint('decision_events_run_id_fkey', type_='foreignkey')
    with op.batch_alter_table('openclaw_execution_tasks') as batch_op:
        batch_op.drop_constraint('openclaw_execution_tasks_run_id_fkey', type_='foreignkey')
    with op.batch_alter_table('public_run_shares') as batch_op:
        batch_op.drop_constraint('public_run_shares_run_id_fkey', type_='foreignkey')

    # Revert to UUID type
    op.execute("ALTER TABLE runs ALTER COLUMN id TYPE UUID USING id::uuid")
    op.execute("ALTER TABLE run_node_states ALTER COLUMN run_id TYPE UUID USING run_id::uuid")
    op.execute("ALTER TABLE run_worklog_entries ALTER COLUMN run_id TYPE UUID USING run_id::uuid")
    op.execute("ALTER TABLE run_handbook_proposals ALTER COLUMN run_id TYPE UUID USING run_id::uuid")
    op.execute("ALTER TABLE openai_call_logs ALTER COLUMN run_id TYPE UUID USING run_id::uuid")
    op.execute("ALTER TABLE escalations ALTER COLUMN run_id TYPE UUID USING run_id::uuid")
    op.execute("ALTER TABLE ratings ALTER COLUMN run_id TYPE UUID USING run_id::uuid")
    op.execute("ALTER TABLE channel_messages ALTER COLUMN run_id TYPE UUID USING run_id::uuid")
    op.execute("ALTER TABLE decision_events ALTER COLUMN run_id TYPE UUID USING run_id::uuid")
    op.execute("ALTER TABLE openclaw_execution_tasks ALTER COLUMN run_id TYPE UUID USING run_id::uuid")
    op.execute("ALTER TABLE public_run_shares ALTER COLUMN run_id TYPE UUID USING run_id::uuid")

    # Recreate FK constraints with UUID type
    op.create_foreign_key(
        'run_node_states_run_id_fkey', 'run_node_states', 'runs', ['run_id'], ['id'])
    op.create_foreign_key(
        'run_worklog_entries_run_id_fkey', 'run_worklog_entries', 'runs', ['run_id'], ['id'],
        ondelete='CASCADE')
    op.create_foreign_key(
        'run_handbook_proposals_run_id_fkey', 'run_handbook_proposals', 'runs', ['run_id'], ['id'],
        ondelete='CASCADE')
    op.create_foreign_key(
        'openai_call_logs_run_id_fkey', 'openai_call_logs', 'runs', ['run_id'], ['id'],
        ondelete='CASCADE')
    op.create_foreign_key(
        'escalations_run_id_fkey', 'escalations', 'runs', ['run_id'], ['id'])
    op.create_foreign_key(
        'ratings_run_id_fkey', 'ratings', 'runs', ['run_id'], ['id'])
    op.create_foreign_key(
        'channel_messages_run_id_fkey', 'channel_messages', 'runs', ['run_id'], ['id'])
    op.create_foreign_key(
        'decision_events_run_id_fkey', 'decision_events', 'runs', ['run_id'], ['id'])
    op.create_foreign_key(
        'openclaw_execution_tasks_run_id_fkey', 'openclaw_execution_tasks', 'runs', ['run_id'], ['id'],
        ondelete='CASCADE')
    op.create_foreign_key(
        'public_run_shares_run_id_fkey', 'public_run_shares', 'runs', ['run_id'], ['id'],
        ondelete='CASCADE')
