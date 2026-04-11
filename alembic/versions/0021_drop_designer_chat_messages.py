"""drop designer chat messages

Revision ID: 0021_drop_designer_chat_messages
Revises: 0020_project_desc_cleanup
Create Date: 2026-03-28
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "0021_drop_designer_chat_messages"
down_revision = "0020_project_desc_cleanup"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index("ix_designer_chat_messages_graph_id", table_name="designer_chat_messages")
    op.drop_table("designer_chat_messages")


def downgrade() -> None:
    op.execute(
        """
        CREATE TABLE designer_chat_messages (
            id UUID NOT NULL,
            graph_id UUID NOT NULL,
            role VARCHAR(20) NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL,
            PRIMARY KEY (id),
            FOREIGN KEY(graph_id) REFERENCES graphs (id) ON DELETE CASCADE
        )
        """
    )
    op.create_index("ix_designer_chat_messages_graph_id", "designer_chat_messages", ["graph_id"], unique=False)
