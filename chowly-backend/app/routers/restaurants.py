"""
Restaurant endpoints for the Chowly API.

Public:
    GET  /restaurants                              — list (id, name, address)
    GET  /restaurants/{restaurant_id}              — detail with active menus

Admin-only:
    POST /restaurants/{restaurant_id}/menu-items   — add a menu item
    PATCH /restaurants/{restaurant_id}/menu-items/{item_id}  — partial update

The admin authorization rule is strict: only an admin whose
`restaurant_id` matches the URL's `restaurant_id` may write. A global
admin (`restaurant_id IS NULL`) cannot manage items for any specific
restaurant via these endpoints — that path is intentionally not exposed
yet, and would belong in a separate super-admin surface.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.auth import get_current_user
from app.database import get_db
from app.models import Menu, MenuItem, Restaurant, Role, User
from app.schemas import (
    MenuItemCreate,
    MenuItemRead,
    MenuItemUpdate,
    RestaurantDetail,
    RestaurantPublic,
)


router = APIRouter(prefix="/restaurants", tags=["restaurants"])


# --- Public reads ----------------------------------------------------------


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


@router.get(
    "/{restaurant_id}",
    response_model=RestaurantDetail,
    summary="Get a restaurant with its active menus (public)",
    description=(
        "Returns a single restaurant along with every menu whose "
        "status is 'active' and all items in those menus. Draft/archived "
        "menus are excluded. No authentication required."
    ),
)
def get_restaurant(
    restaurant_id: int,
    db: Annotated[Session, Depends(get_db)],
) -> RestaurantDetail:
    """Return the restaurant plus its active menus and their items.

    Uses selectinload to fetch the menu tree in a single round-trip
    rather than triggering N+1 queries on the relationships.
    """
    stmt = (
        select(Restaurant)
        .where(Restaurant.id == restaurant_id)
        .options(
            selectinload(Restaurant.menus).selectinload(Menu.items),
        )
    )
    restaurant = db.execute(stmt).scalar_one_or_none()
    if restaurant is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Restaurant with id {restaurant_id} does not exist.",
        )

    # Filter to active menus in Python rather than in SQL so that the
    # selectinload still pulls all menus in one query (the filter is
    # cheap; the join is the expensive part).
    active_menus = [m for m in restaurant.menus if m.status == "active"]

    # Pydantic v2 with from_attributes walks the ORM object and reads
    # `menus` from it. Build a small plain object that exposes the same
    # attributes RestaurantDetail needs but with only the active menus.
    return RestaurantDetail(
        id=restaurant.id,
        name=restaurant.name,
        address=restaurant.address,
        menus=active_menus,
    )


# --- Admin write paths -----------------------------------------------------


def _require_admin_for_restaurant(
    current_user: User, restaurant_id: int
) -> None:
    """Enforce: admin role AND admin.restaurant_id == restaurant_id.

    A global admin (restaurant_id IS NULL) is rejected: the strict rule
    requires a tenant-scoped admin. Mismatched tenants are also rejected.
    """
    if current_user.role is not Role.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin role required.",
        )
    if current_user.restaurant_id != restaurant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"Admin for restaurant {current_user.restaurant_id} "
                f"cannot modify items for restaurant {restaurant_id}."
            ),
        )


def _get_single_menu_for_restaurant(
    db: Session, restaurant_id: int
) -> Menu:
    """Return the restaurant's only menu, or raise 404 if none exists.

    Implements the one-menu-per-restaurant model. If a restaurant ever
    has multiple menus, this would need a `menu_id` in the request
    body to disambiguate.
    """
    stmt = (
        select(Menu)
        .where(Menu.restaurant_id == restaurant_id)
        .order_by(Menu.id.asc())
    )
    menus = db.execute(stmt).scalars().all()
    if not menus:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"Restaurant {restaurant_id} has no menu. Create one "
                f"before adding items."
            ),
        )
    if len(menus) > 1:
        # Defensive: a future schema change might allow multiple menus.
        # Surface this clearly rather than silently picking the first.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Restaurant {restaurant_id} has {len(menus)} menus; "
                f"this endpoint assumes one menu per restaurant."
            ),
        )
    return menus[0]


@router.post(
    "/{restaurant_id}/menu-items",
    response_model=MenuItemRead,
    status_code=status.HTTP_201_CREATED,
    summary="Add a menu item (admin only)",
    description=(
        "Creates a new MenuItem under the restaurant's single menu. "
        "Requires an admin whose restaurant_id matches the URL. "
        "Returns 403 if the caller is not an admin for this restaurant, "
        "404 if the restaurant or its menu does not exist."
    ),
)
def create_menu_item(
    restaurant_id: int,
    payload: MenuItemCreate,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> MenuItemRead:
    # Ensure the restaurant exists first so a missing-restaurant request
    # returns 404 (not 403 from the admin check). Order matters: the
    # existence check has no information leak; the admin check would
    # otherwise tell the caller "this restaurant is not yours" even
    # when the restaurant doesn't exist for anyone.
    restaurant = db.get(Restaurant, restaurant_id)
    if restaurant is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Restaurant with id {restaurant_id} does not exist.",
        )

    _require_admin_for_restaurant(current_user, restaurant_id)

    menu = _get_single_menu_for_restaurant(db, restaurant_id)

    item = MenuItem(
        name=payload.name,
        description=payload.description,
        item_type=payload.item_type,
        price=payload.price,
        availability_status=payload.availability_status,
        menu_id=menu.id,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return MenuItemRead.model_validate(item)


@router.patch(
    "/{restaurant_id}/menu-items/{item_id}",
    response_model=MenuItemRead,
    summary="Update a menu item (admin only)",
    description=(
        "Partial update of a MenuItem. Only the fields provided in the "
        "request body are changed; absent fields are left as-is. "
        "Requires an admin whose restaurant_id matches the URL. "
        "Returns 404 if the item does not exist or is not part of this "
        "restaurant's menu."
    ),
)
def update_menu_item(
    restaurant_id: int,
    item_id: int,
    payload: MenuItemUpdate,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> MenuItemRead:
    # Same ordering rationale as POST: existence first, then auth.
    restaurant = db.get(Restaurant, restaurant_id)
    if restaurant is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Restaurant with id {restaurant_id} does not exist.",
        )

    _require_admin_for_restaurant(current_user, restaurant_id)

    # Fetch the item and confirm it belongs to this restaurant's menu.
    # Joining MenuItem -> Menu -> Restaurant lets us check both at once.
    stmt = (
        select(MenuItem)
        .join(Menu, MenuItem.menu_id == Menu.id)
        .where(
            MenuItem.id == item_id,
            Menu.restaurant_id == restaurant_id,
        )
    )
    item = db.execute(stmt).scalar_one_or_none()
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"Menu item {item_id} not found in restaurant "
                f"{restaurant_id}'s menu."
            ),
        )

    # Apply only the fields the caller actually sent. `exclude_unset`
    # is the Pydantic v2 idiom for partial updates: it returns only the
    # keys that were present in the incoming JSON, ignoring defaults.
    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(item, field, value)

    db.commit()
    db.refresh(item)
    return MenuItemRead.model_validate(item)
