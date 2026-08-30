"""
Order endpoints for the Chowly API.

POST /orders                                                  — customer creates
GET  /orders/{order_id}                                       — customer reads own
PATCH /orders/{order_id}                                      — STUB (plan below)
POST /orders/{order_id}/items/{menu_item_id}/claim            — chef/bartender claim a line

────────────────────────────────────────────────────────────────────────────────
PATCH /orders/{order_id} — DESIGN PLAN (not yet implemented)
────────────────────────────────────────────────────────────────────────────────

This single endpoint serves three roles with non-overlapping permissions.
The chosen model is **per-field role gates**: each field the caller sends
must be allowed for their role. Other fields are ignored (or, if the caller
sends a forbidden field, the request is rejected with 403).

Allowed fields per role:

  | Field                  | customer | waiter | chef | bartender | admin |
  | ---------------------- | -------- | ------ | ---- | --------- | ----- |
  | status                 |    no    |  yes   |  no  |    no     |  yes  |
  | waiter_id              |    no    |  yes   |  no  |    no     |  yes  |
  | estimated_wait_time    |    no    |  yes   |  no  |    no     |  yes  |
  | items[].chef_id        |    no    |   no   | yes  |    no     |  yes  |   <-- via /claim, not PATCH
  | items[].bartender_id   |    no    |   no   |  no  |    yes    |  yes  |   <-- via /claim, not PATCH

Implementation rules when this PATCH is built:

  1. Reject if `current_user.role` is `customer` (customers don't PATCH
     their own orders — they place a new one if they need to change it,
     or call /complaints for problems. If you actually want customers
     to cancel, add an explicit `OrderCancel` endpoint with a narrower
     contract rather than reusing PATCH.)
  2. Build a per-field role gate: each field in the request body must
     belong to the caller's role. If a customer calls this and sends
     `{"status": "Cancelled"}`, return 403 with the offending field name.
  3. The PATCH body is the `OrderUpdate` schema (status, waiter_id,
     estimated_wait_time — all optional). Don't try to support line-level
     fields here; the `/claim` endpoint handles those.
  4. Authorization on the order itself: a waiter/chef can only PATCH
     orders at their own `restaurant_id`. Admin can PATCH any order.
  5. Optimistic concurrency: include `version` on Order and require
     callers to send the version they last saw; reject with 409 on
     mismatch. Skipped for now (not requested), but flag here so the
     stub isn't shipped to production without it.
  6. After the change, publish a domain event (order.status_changed,
     line.claimed) for any in-process subscribers. Out of scope here.

For the line-claim flow, see `claim_order_item` below — that endpoint
is fully implemented and demonstrates the same role-permission pattern.
────────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

from decimal import Decimal
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.auth import get_current_user
from app.database import get_db
from app.models import (
    Customer,
    ItemType,
    Menu,
    MenuItem,
    Order,
    OrderItem,
    OrderStatus,
    Restaurant,
    Role,
    User,
    Waiter,
)
from app.schemas import (
    OrderCreate,
    OrderItemClaimResponse,
    OrderItemRead,
    OrderRead,
    OrderUpdate,
)


router = APIRouter(prefix="/orders", tags=["orders"])


# --- Defaults --------------------------------------------------------------

# Flat default ETA. A real implementation would compute this from
# kitchen load, item prep time, etc. — out of scope here.
DEFAULT_ESTIMATED_WAIT_MINUTES = 20


# --- Helpers ---------------------------------------------------------------


def _require_customer(current_user: User) -> Customer:
    """Verify the caller is a customer and return the matching Customer row.

    A customer has both a User row (with role='customer') and a Customer
    profile row (linked via Customer.user_id). If the user has no
    matching Customer profile, something is inconsistent in the data —
    surface as 403 rather than 500.
    """
    if current_user.role is not Role.CUSTOMER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only customers can perform this action.",
        )
    customer = current_user.customer_profile
    if customer is None:
        # Should be impossible if registration created both rows in
        # one transaction. Treat as 403 (auth, not server error).
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Customer profile not found for this user.",
        )
    return customer


def _load_order_with_items(db: Session, order_id: int) -> Order:
    """Fetch the order with its items and each item's menu_item eagerly loaded.

    Two-level selectinload: first the Order.items collection, then each
    OrderItem's menu_item. The second level is what `claim_order_item`
    needs to read `item_type` without falling back to lazy loading (which
    would emit a separate SELECT per line after the order was already
    loaded). The chained selectinload pulls all menu_items in one extra
    IN-query rather than N queries.
    """
    stmt = (
        select(Order)
        .where(Order.id == order_id)
        .options(
            selectinload(Order.items).selectinload(OrderItem.menu_item)
        )
    )
    order = db.execute(stmt).scalar_one_or_none()
    if order is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Order with id {order_id} does not exist.",
        )
    return order


# --- POST /orders ----------------------------------------------------------


@router.post(
    "",
    response_model=OrderRead,
    status_code=status.HTTP_201_CREATED,
    summary="Place an order (customer only)",
    description=(
        "Creates an Order and its OrderItem rows in a single transaction. "
        "Prices are looked up from the database — never trusted from the "
        "request body. Each menu item is verified to belong to the "
        "specified restaurant and to be available."
    ),
)
def create_order(
    payload: OrderCreate,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> OrderRead:
    customer = _require_customer(current_user)

    # The customer can only order from their own restaurant.
    if customer.restaurant_id != payload.restaurant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"Customer belongs to restaurant {customer.restaurant_id} "
                f"and cannot place orders at restaurant "
                f"{payload.restaurant_id}."
            ),
        )

    # The restaurant must exist (FK would catch this, but the FK error
    # is opaque; a 400 is friendlier).
    if db.get(Restaurant, payload.restaurant_id) is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Restaurant with id {payload.restaurant_id} does not exist.",
        )

    # Look up every menu item, verify it belongs to the restaurant, and
    # verify availability. We collect (MenuItem, quantity) pairs and
    # the running total in a single pass.
    line_items: list[tuple[MenuItem, int]] = []
    total = Decimal("0")
    seen_item_ids: set[int] = set()

    for entry in payload.items:
        # Reject duplicate (menu_item_id) entries — the composite PK
        # would also catch this, but the resulting IntegrityError is
        # a 500. A clean 400 is friendlier.
        if entry.menu_item_id in seen_item_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Duplicate menu_item_id {entry.menu_item_id} in the "
                    f"order. Combine quantities into a single line."
                ),
            )
        seen_item_ids.add(entry.menu_item_id)

        # Look up the menu item. Verify it exists, belongs to the
        # requested restaurant, and is available.
        stmt = (
            select(MenuItem)
            .join(Menu, MenuItem.menu_id == Menu.id)
            .where(MenuItem.id == entry.menu_item_id)
        )
        menu_item = db.execute(stmt).scalar_one_or_none()
        if menu_item is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Menu item {entry.menu_item_id} does not exist "
                    f"or is not available."
                ),
            )
        if menu_item.menu.restaurant_id != payload.restaurant_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Menu item {entry.menu_item_id} does not belong to "
                    f"restaurant {payload.restaurant_id}."
                ),
            )
        if menu_item.availability_status != "available":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Menu item {entry.menu_item_id} is not available "
                    f"(status: {menu_item.availability_status})."
                ),
            )

        line_items.append((menu_item, entry.quantity))
        total += menu_item.price * entry.quantity

    # Create the Order first; flush so it gets an id we can attach items to.
    order = Order(
        status=OrderStatus.IN_PREPARATION,
        estimated_wait_time=DEFAULT_ESTIMATED_WAIT_MINUTES,
        total_amount=total,
        customer_id=customer.id,
        restaurant_id=payload.restaurant_id,
        # waiter_id is null at creation — a waiter picks it up via PATCH.
    )
    db.add(order)
    db.flush()

    # Create the OrderItem rows. unit_price and subtotal come from the
    # database, never the request body. chef_id/bartender_id are null
    # at creation.
    for menu_item, quantity in line_items:
        oi = OrderItem(
            order_id=order.id,
            menu_item_id=menu_item.id,
            quantity=quantity,
            unit_price=menu_item.price,
            subtotal=menu_item.price * quantity,
            chef_id=None,
            bartender_id=None,
        )
        db.add(oi)

    try:
        db.commit()
    except Exception:
        db.rollback()
        raise

    # Eager-load items for the response (commit() expires attributes).
    return OrderRead.model_validate(
        _load_order_with_items(db, order.id)
    )


# --- GET /orders/{order_id} ------------------------------------------------


@router.get(
    "/{order_id}",
    response_model=OrderRead,
    summary="Get an order (owning customer only)",
    description=(
        "Returns the order with all its line items. Only the customer "
        "who placed the order may view it — other customers (and "
        "anonymous users) get 403. Staff and admin access is not yet "
        "wired up; that will come with the PATCH endpoint."
    ),
)
def get_order(
    order_id: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> OrderRead:
    order = _load_order_with_items(db, order_id)

    if current_user.role is Role.CUSTOMER:
        # Only the order's owning customer may view it.
        if order.customer_id != current_user.customer_profile.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You may only view your own orders.",
            )
    else:
        # Staff and admin are blocked from this endpoint for now.
        # We'll open it up as we wire PATCH and other staff endpoints.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Staff access to orders is not yet wired up; use the "
                "PATCH endpoint when it's available."
            ),
        )

    return OrderRead.model_validate(order)


# --- PATCH /orders/{order_id} (STUB) --------------------------------------


@router.patch(
    "/{order_id}",
    response_model=OrderRead,
    status_code=status.HTTP_501_NOT_IMPLEMENTED,
    summary="Update an order (STUB — see plan above)",
    description=(
        "Stub endpoint. The full implementation will follow the "
        "per-field role gate described in the module docstring. "
        "Currently returns 501."
    ),
)
def update_order_stub(
    order_id: int,
    payload: OrderUpdate,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> OrderRead:
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail=(
            "PATCH /orders/{id} is not yet implemented. See the module "
            "docstring in routers/orders.py for the design plan."
        ),
    )


# --- POST /orders/{order_id}/items/{menu_item_id}/claim --------------------


@router.post(
    "/{order_id}/items/{menu_item_id}/claim",
    response_model=OrderItemClaimResponse,
    summary="Claim an order line for preparation (chef/bartender)",
    description=(
        "A chef claims a Food line by setting `chef_id` on it; a "
        "bartender claims a Drink line by setting `bartender_id`. The "
        "URL identifies the specific line; the caller's role is what "
        "decides which column gets set. Returns the updated line."
    ),
)
def claim_order_item(
    order_id: int,
    menu_item_id: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> OrderItemClaimResponse:
    # Fetch the order to confirm it exists and to scope the staff check.
    order = _load_order_with_items(db, order_id)

    # Locate the specific line.
    line = next(
        (oi for oi in order.items if oi.menu_item_id == menu_item_id),
        None,
    )
    if line is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"Order {order_id} has no line for menu item "
                f"{menu_item_id}."
            ),
        )

    # Role check + column assignment.
    if current_user.role is Role.CHEF:
        if current_user.chef_profile is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Chef profile not found for this user.",
            )
        if current_user.restaurant_id != order.restaurant_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"Chef for restaurant {current_user.restaurant_id} "
                    f"cannot claim lines for restaurant "
                    f"{order.restaurant_id}."
                ),
            )
        # Chefs may only claim Food lines. The line's menu_item relationship
        # is loaded transitively from the order's selectinload, so this is
        # a Python-side read, not an extra round-trip.
        if line.menu_item.item_type is not ItemType.FOOD:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Line {menu_item_id} is a {line.menu_item.item_type.value}; "
                    f"only chefs can claim Food lines."
                ),
            )
        # Reject if another chef has already claimed this line. We don't
        # silently overwrite — a claimed line is a handoff that's been
        # accepted, and reassignment should go through a different flow.
        if line.chef_id is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"Line {menu_item_id} is already claimed by chef "
                    f"{line.chef_id}."
                ),
            )
        line.chef_id = current_user.chef_profile.id
    elif current_user.role is Role.BARTENDER:
        if current_user.bartender_profile is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Bartender profile not found for this user.",
            )
        if current_user.restaurant_id != order.restaurant_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"Bartender for restaurant {current_user.restaurant_id} "
                    f"cannot claim lines for restaurant "
                    f"{order.restaurant_id}."
                ),
            )
        if line.menu_item.item_type is not ItemType.DRINK:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Line {menu_item_id} is a {line.menu_item.item_type.value}; "
                    f"only bartenders can claim Drink lines."
                ),
            )
        if line.bartender_id is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"Line {menu_item_id} is already claimed by bartender "
                    f"{line.bartender_id}."
                ),
            )
        line.bartender_id = current_user.bartender_profile.id
    else:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only chefs and bartenders can claim order lines.",
        )

    db.commit()
    db.refresh(line)
    return OrderItemClaimResponse.model_validate(line)
