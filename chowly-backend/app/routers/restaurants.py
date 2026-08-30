"""Public restaurant endpoints for the Chowly API.

The frontend needs to display a list of restaurants during registration,
so this router exposes one unauthenticated read-only route. Anything
that requires knowing staff, menus, or orders is gated behind auth in
the other routers.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Restaurant
from app.schemas import RestaurantPublic


router = APIRouter(prefix="/restaurants", tags=["restaurants"])


@router.get(
    "",
    response_model=list[RestaurantPublic],
    summary="List restaurants (public)",
    description=(
        "Returns every restaurant in the system, sorted by name. Used "
        "by the registration flow's restaurant picker. No authentication "
        "required; only id/name/address are exposed to anonymous callers."
    ),
)
def list_restaurants(
    db: Annotated[Session, Depends(get_db)],
) -> list[RestaurantPublic]:
    """Return all restaurants, sorted alphabetically by name."""
    stmt = select(Restaurant).order_by(Restaurant.name.asc())
    rows = db.execute(stmt).scalars().all()
    return [RestaurantPublic.model_validate(r) for r in rows]
