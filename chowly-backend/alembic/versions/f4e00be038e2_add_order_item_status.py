"""add order item status

Revision ID: f4e00be038e2
Revises: 450dd9fdaedb
Create Date: 2026-09-04 16:44:00.044798

Adds the `order_item_status_enum` PostgreSQL type with values
'Preparing' and 'Ready' and a `status` column on `order_items`
that defaults to 'Preparing' for backfill. The default exists at
the DB layer (server_default) so the column can be NOT NULL on
existing rows without an explicit UPDATE pass.

Mirrors the established enum pattern from
450dd9fdaedb_create_initial_schema.py (order_status_enum,
complaint_status_enum, payment_status_enum): a PostgreSQL enum
type created alongside the column, and values_callable on the
SQLAlchemy Enum so the Python enum names map 1:1 to the wire
values.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f4e00be038e2'
down_revision: Union[str, Sequence[str], None] = '450dd9fdaedb'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Explicit enum creation so the upgrade is self-describing and
# the downgrade can drop the type cleanly. PostgreSQL would
# auto-create the type on the add_column call below, but writing
# it out matches the pattern in 450dd9fdaedb and makes the
# migration reviewable in isolation.
order_item_status_enum = sa.Enum(
    "Preparing", "Ready", name="order_item_status_enum"
)


def upgrade() -> None:
    """Upgrade schema."""
    order_item_status_enum.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "order_items",
        sa.Column(
            "status",
            order_item_status_enum,
            nullable=False,
            # server_default backfills existing rows to 'Preparing'.
            # The default lives at the DB layer rather than on the
            # SQLAlchemy Column so a future INSERT that forgets the
            # field still gets a sane value (defense in depth — the
            # ORM path always sets it explicitly via create_order).
            server_default="Preparing",
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("order_items", "status")
    order_item_status_enum.drop(op.get_bind(), checkfirst=True)
