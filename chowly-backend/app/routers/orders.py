"""
Order endpoints for the Chowly API.

POST   /orders                                                  — customer creates
GET    /orders/{order_id}                                       — customer reads own
PATCH  /orders/{order_id}                                      — waiter/admin updates
                                                               (incl. Served, which
                                                               is terminal and
                                                               gated on
                                                               all_lines_ready
                                                               for waiters)
POST   /orders/{order_id}/items/{menu_item_id}/claim            — chef/bartender claim a line
PATCH  /orders/{order_id}/items/{menu_item_id}                  — chef/bartender/admin
                                                               marks a line Ready
                                                               (Preparing -> Ready)

────────────────────────────────────────────────────────────────────────────────
PATCH /orders/{order_id} — DESIGN PLAN
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

from fastapi import APIRouter, Depends, HTTPException, Query, status
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
    OrderItemStatus,
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
    OrderItemUpdate,
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


def _compute_all_lines_ready(order: Order) -> bool:
    """True iff the order has at least one item AND every item is READY.

    Computed in Python from the already-eager-loaded items rather
    than as a separate aggregate query. The walk is O(N) over the
    order's items, which is bounded by the menu size in practice
    (a few lines, not thousands). An empty order returns False —
    OrderCreate requires min_length=1, so this is a defense-in-depth
    guard, not a normal-case branch.
    """
    items = order.items
    if not items:
        return False
    return all(oi.status is OrderItemStatus.READY for oi in items)


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
    # at creation. status starts at PREPARING — the chef/bartender
    # flips it to READY via PATCH /orders/{order_id}/items/{menu_item_id}.
    # The DB's server_default would also supply this, but writing it
    # explicitly here keeps the ORM path self-documenting and avoids
    # relying on the column default for new rows.
    for menu_item, quantity in line_items:
        oi = OrderItem(
            order_id=order.id,
            menu_item_id=menu_item.id,
            quantity=quantity,
            unit_price=menu_item.price,
            subtotal=menu_item.price * quantity,
            chef_id=None,
            bartender_id=None,
            status=OrderItemStatus.PREPARING,
        )
        db.add(oi)

    try:
        db.commit()
    except Exception:
        db.rollback()
        raise

    # Eager-load items for the response (commit() expires attributes).
    refreshed = _load_order_with_items(db, order.id)
    # New order — all_lines_ready is always False (every item is
    # PREPARING). Setting it explicitly keeps the OrderRead shape
    # consistent across read and write paths so the frontend
    # doesn't need to special-case newly-created orders.
    refreshed.all_lines_ready = _compute_all_lines_ready(refreshed)
    return OrderRead.model_validate(refreshed)


# --- GET /orders ----------------------------------------------------------


@router.get(
    "",
    response_model=list[OrderRead],
    summary="List orders visible to the caller",
    description=(
        "Customers see their own orders; staff/admin see orders at "
        "their restaurant. Optional ?status= filter accepts the exact "
        "OrderStatus values (e.g. 'In Preparation'). Results are "
        "ordered by order_date descending and capped at 200."
    ),
)
def list_orders(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    status_filter: Annotated[
        Optional[OrderStatus], Query(alias="status")
    ] = None,
) -> list[OrderRead]:
    # Build the role-scoped WHERE clause. Customer scope is by
    # customer_id; staff/admin scope is by tenant (restaurant_id).
    # A user with no profile (data inconsistency) yields an empty
    # list rather than a 500 — the alternative would be to 403,
    # but "you have no orders" is friendlier than "forbidden."
    conditions = []
    if current_user.role is Role.CUSTOMER:
        customer = current_user.customer_profile
        if customer is None:
            return []
        conditions.append(Order.customer_id == customer.id)
    else:
        # waiter / chef / bartender / admin — all tenant-scoped
        if current_user.restaurant_id is None:
            return []
        conditions.append(
            Order.restaurant_id == current_user.restaurant_id
        )

    stmt = (
        select(Order)
        .where(*conditions)
        .order_by(Order.order_date.desc())
        .limit(200)
        .options(
            selectinload(Order.items).selectinload(OrderItem.menu_item)
        )
    )
    if status_filter is not None:
        stmt = stmt.where(Order.status == status_filter)

    orders = db.execute(stmt).scalars().all()
    # Eager-load is in place, so the @model_validator on OrderItemRead
    # can walk line.menu_item.name at model_validate time without
    # triggering lazy loads. all_lines_ready is computed in Python
    # from the same eager-loaded items — no extra round-trip per
    # order, and no per-row N+1 fan-out to the items table.
    for o in orders:
        o.all_lines_ready = _compute_all_lines_ready(o)
    return [OrderRead.model_validate(o) for o in orders]


# --- GET /orders/{order_id} ------------------------------------------------


@router.get(
    "/{order_id}",
    response_model=OrderRead,
    summary="Get an order (owning customer, or staff at the order's restaurant)",
    description=(
        "Returns the order with all its line items. Customers may only "
        "view their own orders. Staff and admin may view any order at "
        "their restaurant — this is the read path for the kitchen, "
        "bar, and floor dashboards, and the deep-link target for the "
        "list endpoint."
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
        # Staff and admin are tenant-scoped: they can read any order
        # at their own restaurant. This mirrors the PATCH check so the
        # two endpoints share a single access rule.
        if current_user.restaurant_id != order.restaurant_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"{current_user.role.value.capitalize()} for "
                    f"restaurant {current_user.restaurant_id} cannot "
                    f"view orders for restaurant {order.restaurant_id}."
                ),
            )

    # Same all_lines_ready derivation as list_orders — the value is
    # computed from the already-eager-loaded items, not a stored
    # column. See _compute_all_lines_ready for the empty-order
    # guard.
    order.all_lines_ready = _compute_all_lines_ready(order)
    return OrderRead.model_validate(order)


# --- PATCH /orders/{order_id} ----------------------------------------------


# Per-field role gate. Each frozenset lists the fields a given role is
# allowed to write via PATCH. OrderUpdate's fields (status, waiter_id,
# estimated_wait_time) are all waiter/admin-only; chef/bartender act on
# lines via /claim, not on the order header.
#
# An empty frozenset means the role is allowed to call the endpoint
# only to fail validation cleanly — but in practice we 403 non-waiter/
# non-admin roles below because there's no field they can send.
_PATCH_ALLOWED_FIELDS: dict[Role, frozenset[str]] = {
    Role.CUSTOMER: frozenset(),
    Role.WAITER: frozenset({"status", "waiter_id", "estimated_wait_time"}),
    Role.CHEF: frozenset(),
    Role.BARTENDER: frozenset(),
    Role.ADMIN: frozenset({"status", "waiter_id", "estimated_wait_time"}),
}


@router.patch(
    "/{order_id}",
    response_model=OrderRead,
    summary="Update an order (waiter/admin only)",
    description=(
        "Per-field role gate: each field in the request body must be "
        "allowed for the caller's role. Customers are rejected "
        "outright. Waiters and admins can only act on orders at "
        "their own restaurant (tenant-scoped, mirroring the "
        "get_order rule). A waiter can set waiter_id only to their "
        "own waiter profile (so a waiter can't hijack another "
        "waiter's order); admin can set it to any valid waiter at "
        "the order's restaurant. Setting status to 'Served' is "
        "terminal (a Served order cannot be moved back to another "
        "status, mirroring the no-reopen rule on resolved "
        "complaints and ready lines); a waiter may only set Served "
        "when all_lines_ready is true, and admin can override the "
        "all_lines_ready gate. See the module docstring for the "
        "full design plan."
    ),
)
def update_order(
    order_id: int,
    payload: OrderUpdate,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> OrderRead:
    # Reject customers outright. The role gate below would also block
    # them, but a flat 403 is clearer than "you sent no allowed fields"
    # when every field is forbidden.
    if current_user.role is Role.CUSTOMER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Customers cannot update orders.",
        )
    if current_user.role is Role.CHEF or current_user.role is Role.BARTENDER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Chefs and bartenders act on order lines via "
                "POST /orders/{id}/items/{menu_item_id}/claim, "
                "not PATCH /orders/{id}."
            ),
        )

    order = _load_order_with_items(db, order_id)

    # Tenant scope: staff and admin can only touch orders at their
    # own restaurant. Customer/chef/bartender are already rejected
    # above (lines 486-499), so the only roles that reach this
    # point are WAITER and ADMIN — both must match. Mirrors the
    # get_order tenant check (see lines 415-427) so the read and
    # write paths share a single access rule; same status code,
    # same role-tagging detail shape.
    if current_user.restaurant_id != order.restaurant_id:
        role_label = current_user.role.value.capitalize()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"{role_label} for restaurant "
                f"{current_user.restaurant_id} cannot update orders "
                f"for restaurant {order.restaurant_id}."
            ),
        )

    # Find out which fields the client actually included. Pydantic v2
    # exposes this via `model_fields_set`; it's exactly the keys that
    # were present in the incoming JSON (so null counts as "set").
    sent_fields = payload.model_fields_set

    # Per-field role gate. Any field the caller included that isn't
    # allowed for their role → 403 with the offending field named.
    allowed = _PATCH_ALLOWED_FIELDS[current_user.role]
    forbidden = sent_fields - allowed
    if forbidden:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"Field(s) {sorted(forbidden)} are not allowed for "
                f"role '{current_user.role.value}'."
            ),
        )

    if not sent_fields:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one field must be provided.",
        )

    # waiter_id self-assignment: a waiter may only set waiter_id to
    # their own waiter profile. Without this, any waiter could attach
    # themselves (or anyone) to any order at their restaurant.
    if (
        "waiter_id" in sent_fields
        and current_user.role is Role.WAITER
    ):
        if current_user.waiter_profile is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Waiter profile not found for this user.",
            )
        if payload.waiter_id != current_user.waiter_profile.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "A waiter can only assign themselves; "
                    f"waiter_id must be {current_user.waiter_profile.id}."
                ),
            )

    # If admin is setting waiter_id, verify the waiter exists and
    # belongs to the order's restaurant. (A typo from a well-meaning
    # admin shouldn't silently attach a stranger.)
    if (
        "waiter_id" in sent_fields
        and current_user.role is Role.ADMIN
        and payload.waiter_id is not None
    ):
        waiter = db.get(Waiter, payload.waiter_id)
        if waiter is None or waiter.restaurant_id != order.restaurant_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Waiter {payload.waiter_id} does not exist or "
                    f"is not at restaurant {order.restaurant_id}."
                ),
            )

    # Served transition gate. Setting `status` to "Served" is a
    # one-way door — the kitchen/bar signal is the upstream
    # prerequisite (every line is Ready), and the indicator already
    # exposes that signal on the waiter dashboard. A waiter may
    # only flip an order to Served when all_lines_ready is true;
    # an admin can override the gate so a manager can recover a
    # stuck order (e.g. one line was mis-marked Ready in error
    # and the admin is the one who can unwind the operational
    # mistake through a separate path).
    #
    # The pre-condition is computed from the just-loaded items
    # (already eager-loaded above), so no extra round-trip.
    if (
        "status" in sent_fields
        and payload.status is OrderStatus.SERVED
    ):
        all_ready = _compute_all_lines_ready(order)
        if not all_ready and current_user.role is Role.WAITER:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"Order {order.id} cannot be marked Served: "
                    f"not all lines are Ready."
                ),
            )
        # Admin falls through with no extra check; they can
        # override. The all_lines_ready value is recomputed in
        # the response below so the override path is observable.

    # State machine: Served is a terminal status, matching the
    # pattern already used for ComplaintStatus.RESOLVED and
    # OrderItemStatus.READY. Any transition *out* of Served is
    # rejected with 409, as is a no-op re-mark. The check is
    # restricted to the `status` field because the only field
    # affected by the terminal-state rule is status itself; if
    # the caller is only updating waiter_id or ETA, the rule
    # does not apply.
    if "status" in sent_fields and order.status is OrderStatus.SERVED:
        if payload.status is OrderStatus.SERVED:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"Order {order.id} is already Served."
                ),
            )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Order {order.id} is Served; status is terminal "
                f"and cannot be changed back to "
                f"{payload.status.value}."
            ),
        )

    # Apply the partial update. exclude_unset ensures we only write
    # what the client sent, but we already validated the set above so
    # this is just defense-in-depth.
    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(order, field, value)

    try:
        db.commit()
    except Exception:
        db.rollback()
        raise

    # Eager-load items for the response (commit() expires attributes).
    # Re-derive all_lines_ready from the freshly-loaded items so the
    # response reflects any line-level changes that other concurrent
    # PATCHes (e.g. a chef marking a line ready between our read and
    # write) have made.
    refreshed = _load_order_with_items(db, order.id)
    refreshed.all_lines_ready = _compute_all_lines_ready(refreshed)
    return OrderRead.model_validate(refreshed)


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
    # db.refresh(line) expires the menu_item relationship; the new
    # OrderItemClaimResponse.menu_item_name field needs it loaded at
    # model_validate time. attribute_names=["menu_item"] refreshes
    # just the relationship in a single SELECT without re-querying
    # every scalar column. The relationship was already eager-loaded
    # by _load_order_with_items, so the refresh is a no-op for the
    # current values — but it repopulates the identity map for the
    # post-commit session.
    db.refresh(line)
    db.refresh(line, attribute_names=["menu_item"])
    return OrderItemClaimResponse.model_validate(line)


# --- PATCH /orders/{order_id}/items/{menu_item_id} ------------------------


# Per-field role gate for the line-level PATCH. The only legal
# value today is `status` (Preparing -> Ready), and the only roles
# admitted are chef (for their type of line), bartender (same),
# and admin. Customers, waiters, and the cross-type case (chef on
# a drink line, bartender on a food line) all fall outside.
#
# The per-line role check happens after the line is loaded — the
# gate below only narrows which fields the caller's role is
# allowed to write; the type/claim check is in the endpoint body.
_PATCH_ITEM_ALLOWED_FIELDS: dict[Role, frozenset[str]] = {
    Role.CUSTOMER: frozenset(),
    Role.WAITER: frozenset(),
    Role.CHEF: frozenset({"status"}),
    Role.BARTENDER: frozenset({"status"}),
    Role.ADMIN: frozenset({"status"}),
}


@router.patch(
    "/{order_id}/items/{menu_item_id}",
    response_model=OrderItemClaimResponse,
    summary="Update a single order line (chef/bartender/admin)",
    description=(
        "Currently supports only the Preparing -> Ready transition, "
        "which is the kitchen/bar signal that the line is done. The "
        "caller's role must match the line's item type (chef on a "
        "Food line, bartender on a Drink line) — and either the "
        "line must already be claimed by the caller, or it must "
        "still be unclaimed (so a chef can claim-by-marking-ready "
        "in one step). Admin can act on any line at their "
        "restaurant. The only field accepted is `status`; any "
        "other field is a 403 (per-field role gate, same shape "
        "as PATCH /orders/{id} and PATCH /orders/{id}/complaint). "
        "There is no reverse transition — a Ready line stays "
        "Ready; flipping it back to Preparing requires admin via "
        "direct DB access (out of scope)."
    ),
)
def update_order_item(
    order_id: int,
    menu_item_id: int,
    payload: OrderItemUpdate,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> OrderItemClaimResponse:
    # Reject customers, waiters, and any role with no allowed
    # fields up front. A flat 403 is clearer than the
    # "you sent no allowed fields" 400 when every field is
    # forbidden. (The per-field role gate below would also block
    # these, but the early reject is friendlier.)
    if current_user.role not in {Role.CHEF, Role.BARTENDER, Role.ADMIN}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Only chefs, bartenders, and admins can update order lines."
            ),
        )

    # Existence first (404 if missing) so a missing order doesn't
    # leak as a 403. Same ordering as update_complaint and
    # update_menu_item. The two-level selectinload is required so
    # the response's menu_item_name can be resolved by
    # OrderItemClaimResponse._resolve_menu_item_fields without
    # lazy loading after the commit.
    order = _load_order_with_items(db, order_id)

    # Tenant scope: staff can only act on orders at their own
    # restaurant. Admin bypasses.
    if (
        current_user.role is not Role.ADMIN
        and current_user.restaurant_id != order.restaurant_id
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"{current_user.role.value.capitalize()} for "
                f"restaurant {current_user.restaurant_id} cannot "
                f"update lines for restaurant {order.restaurant_id}."
            ),
        )

    # Locate the line.
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

    # Role-specific line-type + claim gate. The line's
    # menu_item relationship is already loaded by
    # _load_order_with_items, so item_type is a Python-side
    # read, not a round-trip.
    if current_user.role is Role.CHEF:
        if current_user.chef_profile is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Chef profile not found for this user.",
            )
        if line.menu_item.item_type is not ItemType.FOOD:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Line {menu_item_id} is a "
                    f"{line.menu_item.item_type.value}; only chefs can "
                    f"mark Food lines ready."
                ),
            )
        # The chef must own the claim, OR the line must still be
        # unclaimed (so the act of marking ready also implicitly
        # claims the line). This matches the same claim-eligibility
        # rule the claim endpoint enforces, just expressed as
        # "you can act on this line."
        if line.chef_id is not None and line.chef_id != current_user.chef_profile.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"Line {menu_item_id} is already claimed by chef "
                    f"{line.chef_id}; only that chef (or an admin) can "
                    f"mark it ready."
                ),
            )
    elif current_user.role is Role.BARTENDER:
        if current_user.bartender_profile is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Bartender profile not found for this user.",
            )
        if line.menu_item.item_type is not ItemType.DRINK:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Line {menu_item_id} is a "
                    f"{line.menu_item.item_type.value}; only bartenders "
                    f"can mark Drink lines ready."
                ),
            )
        if (
            line.bartender_id is not None
            and line.bartender_id != current_user.bartender_profile.id
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"Line {menu_item_id} is already claimed by "
                    f"bartender {line.bartender_id}; only that "
                    f"bartender (or an admin) can mark it ready."
                ),
            )
    # Admin path: no per-line claim check; admin can mark any
    # line at their restaurant ready.

    # Per-field role gate. The Pydantic v2 `model_fields_set`
    # exposes exactly which fields the caller sent. For chef /
    # bartender / admin, the only allowed field is `status`.
    # Sending any other field is a 403 (mirrors the
    # update_complaint and update_order gates).
    sent_fields = payload.model_fields_set
    allowed = _PATCH_ITEM_ALLOWED_FIELDS[current_user.role]
    forbidden = sent_fields - allowed
    if forbidden:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"Field(s) {sorted(forbidden)} are not allowed for "
                f"role '{current_user.role.value}'."
            ),
        )

    # State machine: Preparing -> Ready is the only valid
    # transition. Anything else (Ready -> Ready no-op, Ready ->
    # Preparing reversal, Preparing -> Preparing no-op) is
    # rejected with 409 so the caller knows the action was a
    # no-op or an invalid direction. The Pydantic enum would
    # already reject any other value with 422 at the body layer;
    # the router-level check is the backstop.
    if line.status == payload.status:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Line is already {payload.status.value}.",
        )
    if (
        line.status is OrderItemStatus.READY
        and payload.status is OrderItemStatus.PREPARING
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot unready a line that has been marked ready.",
        )
    if payload.status is not OrderItemStatus.READY:
        # Defensive: Pydantic's enum rejects any non-Preparing /
        # non-Ready value with 422, but the router-level check
        # keeps the error message specific to the state machine.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Invalid status transition: "
                f"{line.status.value} -> {payload.status.value}."
            ),
        )

    line.status = payload.status
    db.commit()
    # Refresh the line and the menu_item relationship so the
    # response shape (which walks menu_item.name) is satisfied
    # after the commit. Same pattern as claim_order_item: a full
    # db.refresh(line) re-loads every scalar column, and the
    # subsequent attribute_names=["menu_item"] refresh repopulates
    # the relationship in a single SELECT.
    db.refresh(line)
    db.refresh(line, attribute_names=["menu_item"])
    return OrderItemClaimResponse.model_validate(line)
