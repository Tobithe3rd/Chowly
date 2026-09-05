"""
Restaurant endpoints for the Chowly API.

Public:
    GET  /restaurants                              — list (id, name, address)
    GET  /restaurants/{restaurant_id}              — detail with active menus

Admin-only:
    POST /restaurants/{restaurant_id}/menu-items   — add a menu item
    PATCH /restaurants/{restaurant_id}/menu-items/{item_id}  — partial update

Staff/admin:
    GET  /restaurants/{restaurant_id}/complaints   — list complaints (?status=
                                                    Open|Resolved optional)

The admin authorization rule is strict: only an admin whose
`restaurant_id` matches the URL's `restaurant_id` may write. A global
admin (`restaurant_id IS NULL`) cannot manage items for any specific
restaurant via these endpoints — that path is intentionally not exposed
yet, and would belong in a separate super-admin surface.
"""

from __future__ import annotations

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.auth import get_current_user
from app.database import get_db
from app.models import (
    Complaint,
    ComplaintStatus,
    Menu,
    MenuItem,
    Order,
    Restaurant,
    Role,
    User,
)
from app.schemas import (
    ComplaintRead,
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


def _require_staff_for_restaurant(
    current_user: User, restaurant_id: int, *, admin_only: bool
) -> None:
    """Enforce: tenant-scoped staff/admin, with an optional role floor.

    The customer role is rejected outright (no profile, no
    restaurant_id to compare). Staff and admin must match the URL's
    restaurant_id — same shape as the menu-item PATCH so the two
    endpoints share a single access rule.

    With admin_only=True, only Role.ADMIN is accepted. This is the
    menu-item PATCH case: only the tenant manager may change items.

    With admin_only=False, any of waiter/chef/bartender/admin is
    accepted. This is the complaints-list case: floor staff can see
    complaints at their restaurant so the kitchen/bar can be aware
    of an active issue, but only admin can resolve them (see
    routers/feedback.py:update_complaint).
    """
    if current_user.role is Role.CUSTOMER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Customer accounts cannot list restaurant complaints.",
        )

    if admin_only and current_user.role is not Role.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin role required.",
        )

    if current_user.restaurant_id != restaurant_id:
        role_label = current_user.role.value.capitalize()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"{role_label} for restaurant "
                f"{current_user.restaurant_id} cannot list complaints "
                f"for restaurant {restaurant_id}."
            ),
        )


# Thin delegating wrapper kept for the menu-item callers so they
# don't have to change shape. The complaints-list endpoint uses the
# broader helper directly with admin_only=False.
def _require_admin_for_restaurant(
    current_user: User, restaurant_id: int
) -> None:
    _require_staff_for_restaurant(
        current_user, restaurant_id, admin_only=True
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


# --- Staff/admin read: complaints list -----------------------------------


@router.get(
    "/{restaurant_id}/complaints",
    response_model=list[ComplaintRead],
    summary="List complaints for a restaurant (staff/admin only)",
    description=(
        "Returns complaints at the given restaurant, ordered by "
        "complaint_date descending, capped at 200. Optional ?status= "
        "filter accepts 'Open' or 'Resolved'. Staff (waiter/chef/"
        "bartender) and admin at the same restaurant are admitted; "
        "customers are rejected. The response shape is the same "
        "ComplaintRead used on the per-order read; no customer-name "
        "join (mirrors the customer_id-as-placeholder gap flagged on "
        "the order read — fix in a later step)."
    ),
)
def list_restaurant_complaints(
    restaurant_id: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    status_filter: Annotated[
        Optional[ComplaintStatus], Query(alias="status")
    ] = None,
) -> list[ComplaintRead]:
    # Existence first so a missing-restaurant request returns 404
    # rather than 403 from the role check. Same ordering rule as
    # create_menu_item and update_menu_item.
    if db.get(Restaurant, restaurant_id) is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Restaurant with id {restaurant_id} does not exist.",
        )

    _require_staff_for_restaurant(
        current_user, restaurant_id, admin_only=False
    )

    # Tenant-scope filter: join through Order.restaurant_id. The
    # join is the load-bearing filter (a Complaint.order_id is always
    # set, but defense-in-depth — a future data migration could
    # orphan a row).
    stmt = (
        select(Complaint)
        .join(Order, Order.id == Complaint.order_id)
        .where(Order.restaurant_id == restaurant_id)
        .order_by(Complaint.complaint_date.desc())
        .limit(200)
    )
    if status_filter is not None:
        stmt = stmt.where(Complaint.status == status_filter)

    rows = db.execute(stmt).scalars().all()
    return [ComplaintRead.model_validate(r) for r in rows]
