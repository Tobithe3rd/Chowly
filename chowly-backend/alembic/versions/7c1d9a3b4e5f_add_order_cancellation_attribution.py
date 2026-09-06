"""add order cancellation attribution

Revision ID: 7c1d9a3b4e5f
Revises: f4e00be038e2
Create Date: 2026-09-05 12:00:00.000000

Adds two nullable columns to `orders` so the UI can answer
"who cancelled this order, and when?":

    cancelled_by_user_id  INT,  FK -> users.id,    nullable
    cancelled_at          TIMESTAMPTZ,             nullable

Both stay NULL while the order is in any non-cancelled state;
the PATCH /orders/{id} handler sets them in the same write that
flips status to CANCELLED. The relationship is one-way (no
backref on User) because we never query "every order user X
cancelled" today — the join only flows Order -> User for the
read path. ON DELETE SET NULL is the right policy: a deleted
user shouldn't cascade-wipe order history, and the cancelled
row keeps its cancelled_at timestamp so the read still tells
the operator when it happened.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "7c1d9a3b4e5f"
down_revision: Union[str, Sequence[str], None] = "f4e00be038e2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "orders",
        sa.Column(
            "cancelled_by_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "orders",
        sa.Column(
            "cancelled_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    # Index on cancelled_by_user_id so an audit query (rare but
    # plausible) like "orders cancelled by user X" doesn't full-
    # scan. The cancelled_at column is also a useful audit
    # ordering key, but the order_date index already covers
    # most date-range reads.
    op.create_index(
        "ix_orders_cancelled_by_user_id",
        "orders",
        ["cancelled_by_user_id"],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_orders_cancelled_by_user_id", table_name="orders")
    op.drop_column("orders", "cancelled_at")
    op.drop_column("orders", "cancelled_by_user_id")
