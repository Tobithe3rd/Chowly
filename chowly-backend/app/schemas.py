"""
Pydantic schemas for the Chowly API.

Defines request/response shapes for authentication and the user-facing
data model. Schema classes are intentionally separate from the SQLAlchemy
ORM models in app.models — schemas describe the *wire format* and
validation rules, models describe *persistence*.

Naming convention:
    <Entity>Create   — input for creating a row
    <Entity>Read     — output for reading a row
    <Entity>Update   — input for partial updates (omitted fields are kept)
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator

from app.models import (
    ComplaintStatus,
    ItemType,
    OrderItemStatus,
    OrderStatus,
    PaymentStatus,
    Role,
)


# --- Auth ------------------------------------------------------------------


# Roles that carry a Customer/Staff profile row in addition to the User row.
# Admin is intentionally excluded — admins have no profile table.
CUSTOMER_ROLE: Literal["customer"] = "customer"
STAFF_ROLES: tuple[Literal["waiter"], Literal["chef"], Literal["bartender"]] = (
    "waiter",
    "chef",
    "bartender",
)
ALL_SELF_REGISTRABLE_ROLES: tuple[Literal["customer"], Literal["waiter"], Literal["chef"], Literal["bartender"]] = (
    "customer",
    "waiter",
    "chef",
    "bartender",
)


class RegisterRequest(BaseModel):
    """Request body for POST /auth/register.

    All non-admin registrations must include restaurant_id; admins leave
    it null and do not create a profile row.

    role-specific extra fields (name, phone, email) are required for
    every self-registrable role. The router is responsible for picking
    the right profile table based on `role` and writing both rows in
    one transaction.
    """

    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    role: Role

    # restaurant_id is required for customer/waiter/chef/bartender;
    # nullable for admin. The router enforces which roles accept it.
    restaurant_id: Optional[int] = None

    # Profile fields. `email` is only relevant for customer (staff use
    # the User.email for contact). Routers should ignore `email` for
    # non-customer profiles to avoid accidental overwrite.
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    phone: Optional[str] = Field(default=None, min_length=1, max_length=32)
    email_profile: Optional[EmailStr] = Field(
        default=None,
        description=(
            "Profile-level email. Only used for customer registrations; "
            "ignored for staff/admin where User.email is the contact."
        ),
    )


class LoginRequest(BaseModel):
    """Request body for POST /auth/login."""

    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class TokenResponse(BaseModel):
    """Response body for successful login (and future refresh endpoints)."""

    access_token: str
    token_type: Literal["bearer"] = "bearer"


class UserRead(BaseModel):
    """Public-facing view of a User. Never includes password_hash."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    email: EmailStr
    role: Role
    restaurant_id: Optional[int]
    created_at: datetime


# --- Restaurant ------------------------------------------------------------


class RestaurantRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    address: str
    phone: str
    email: EmailStr


class RestaurantPublic(BaseModel):
    """Minimal restaurant shape for unauthenticated callers.

    Used by the public GET /restaurants endpoint that powers the
    restaurant picker during registration. Deliberately omits phone
    and email so a public endpoint doesn't leak contact info.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    address: str


# --- Customer / staff ------------------------------------------------------


class CustomerRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    phone: str
    email: EmailStr
    restaurant_id: int
    user_id: Optional[int]


class WaiterRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    phone: str
    restaurant_id: int
    user_id: Optional[int]


class ChefRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    phone: str
    restaurant_id: int
    user_id: Optional[int]


class BartenderRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    phone: str
    restaurant_id: int
    user_id: Optional[int]


# --- Menu ------------------------------------------------------------------


class MenuItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: Optional[str]
    item_type: ItemType
    price: Decimal
    availability_status: str
    menu_id: int


class MenuItemCreate(BaseModel):
    """Input for POST /restaurants/{restaurant_id}/menu-items.

    All fields except `description` are required. The router attaches
    `menu_id` based on the restaurant's single menu (one-menu-per-restaurant
    model — see routers/restaurants.py).
    """

    name: str = Field(min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=2000)
    item_type: ItemType
    price: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    availability_status: str = Field(default="available", max_length=32)


class MenuItemUpdate(BaseModel):
    """Input for PATCH /restaurants/{restaurant_id}/menu-items/{item_id}.

    All fields are optional — only those provided are updated. This is a
    partial update; absent fields are left untouched.
    """

    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=2000)
    item_type: Optional[ItemType] = None
    price: Optional[Decimal] = Field(
        default=None, gt=0, max_digits=10, decimal_places=2
    )
    availability_status: Optional[str] = Field(default=None, max_length=32)


class MenuRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: Optional[str]
    status: str
    restaurant_id: int
    items: list[MenuItemRead] = Field(default_factory=list)


class RestaurantDetail(BaseModel):
    """Public detail view of a restaurant with its active menus.

    Returned by GET /restaurants/{id}. Only menus with status='active'
    are included; items belong to each menu. Phone and email remain
    hidden for the same reason RestaurantPublic hides them.

    The router constructs this directly from keyword args rather than
    via `model_validate` on the ORM row, because the active-menu filter
    is applied in Python after the eager-load. Nested `MenuRead` and
    `MenuItemRead` still use `from_attributes` to walk the ORM objects.
    """

    id: int
    name: str
    address: str
    menus: list[MenuRead] = Field(default_factory=list)


# --- Order -----------------------------------------------------------------


class OrderItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    order_id: int
    menu_item_id: int
    # Joined from MenuItem.name. Routers eager-load OrderItem.menu_item
    # via the two-level selectinload in _load_order_with_items, so the
    # relationship is loaded at serialization time.
    #
    # Pydantic v2's from_attributes only walks single-level attributes
    # — it would look for `menu_item_name` on OrderItem and fail. The
    # @model_validator below walks the dotted path explicitly and
    # injects the value under the wire-format name. This is the same
    # convention used by MenuRead.items: a flat joined field rather
    # than a nested DTO.
    menu_item_name: str
    # Joined from MenuItem.item_type. Same eager-load as
    # `menu_item_name` — the relationship is already loaded, so
    # Pydantic reads it directly with no extra query. Surfacing
    # this on the wire lets the chef/bartender dashboards filter
    # per role (PRODUCT.md lines 15-16, 29: chef sees food;
    # bartender sees drinks) without a second round-trip.
    item_type: ItemType
    quantity: int
    unit_price: Decimal
    subtotal: Decimal
    chef_id: Optional[int]
    bartender_id: Optional[int]
    # Joined display names from the Chef / Bartender profile rows
    # pointed at by chef_id / bartender_id. The relationships
    # (`line.chef`, `line.bartender`) are eager-loaded by
    # _load_order_with_items alongside the existing menu_item
    # chain, so the @model_validator below walks them at
    # model_validate time without triggering a lazy load per
    # row. Surfacing the names on the wire lets the chef/
    # bartender dashboard render "Claimed by Alex Chen" instead
    # of the previous generic "Claimed" (the same gap was
    # flagged on the staff-dashboard component). Both are
    # nullable because an unclaimed line has no claimer row
    # to resolve.
    chef_name: Optional[str] = None
    bartender_name: Optional[str] = None
    # Per-line preparation state. Default is "Preparing" (set by
    # the migration's server_default and by create_order explicitly
    # on insert). Chefs/bartenders flip this to "Ready" via
    # PATCH /orders/{order_id}/items/{menu_item_id} — see
    # routers/orders.py:update_order_item.
    status: OrderItemStatus

    @model_validator(mode="before")
    @classmethod
    def _resolve_joined_fields(cls, values: Any) -> Any:
        # Dicts that already have menu_item_name (and item_type,
        # chef_name, bartender_name) pass through. This keeps
        # manual construction and tests ergonomic.
        if isinstance(values, dict):
            return values
        # ORM object: read the joined fields from the eager-
        # loaded relationships. Pydantic's from_attributes only
        # walks single-level attributes — it would look for
        # `menu_item_name`, `item_type`, `chef_name`, and
        # `bartender_name` on OrderItem and fail. Walking each
        # relationship by hand keeps the wire shape flat (no
        # nested DTO) and matches the convention already used
        # for `menu_item_name` / `item_type`.
        menu_item = getattr(values, "menu_item", None)
        menu_item_name = getattr(menu_item, "name", None)
        item_type = getattr(menu_item, "item_type", None)
        chef = getattr(values, "chef", None)
        chef_name = getattr(chef, "name", None)
        bartender = getattr(values, "bartender", None)
        bartender_name = getattr(bartender, "name", None)
        if hasattr(values, "__dict__"):
            merged = {
                **values.__dict__,
                "menu_item_name": menu_item_name,
                "chef_name": chef_name,
                "bartender_name": bartender_name,
            }
            if item_type is not None:
                merged["item_type"] = item_type
            return merged
        out: dict = {
            "menu_item_name": menu_item_name,
            "chef_name": chef_name,
            "bartender_name": bartender_name,
        }
        if item_type is not None:
            out["item_type"] = item_type
        return out


class OrderRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    order_date: datetime
    status: OrderStatus
    estimated_wait_time: int
    total_amount: Decimal
    customer_id: int
    restaurant_id: int
    waiter_id: Optional[int]
    items: list[OrderItemRead] = Field(default_factory=list)
    # Joined display names. `customer` is always present (the FK
    # is NOT NULL on Order), so customer_name is required.
    # `waiter` is null until a waiter claims the order via
    # PATCH /orders/{id}, so waiter_name is Optional and falls
    # back to null on unclaimed orders. Both relationships are
    # eager-loaded by _load_order_with_items via selectinload,
    # so the @model_validator below walks them at
    # model_validate time without a per-row lazy load. The
    # frontend uses these to drop the "Customer #N" /
    # "Claimed by waiter #N" placeholders from the list and
    # detail pages.
    customer_name: str
    waiter_name: Optional[str] = None
    # Cancellation attribution. All three stay null until the
    # order's status flips to CANCELLED; the same write that
    # sets the status (in routers/orders.py:update_order) sets
    # cancelled_by_user_id and cancelled_at, so the three are
    # populated together. cancelled_at is the DB's func.now()
    # at the moment of the write (same clock the 10-minute
    # cancel-window check uses, so the window math and the
    # attribution timestamp are on the same source of truth).
    # The cancelled_by_user relationship is one-way (see the
    # note on the Order model) and is eager-loaded by
    # _load_order_with_items; cancelled_by_name is null on
    # non-cancelled orders.
    cancelled_by_user_id: Optional[int] = None
    cancelled_at: Optional[datetime] = None
    cancelled_by_name: Optional[str] = None
    # Derived: true iff the order has at least one item AND every
    # item's status is "Ready". Computed by the router (see
    # _compute_all_lines_ready in routers/orders.py) so the value
    # is a single read-time aggregate, not a stored column.
    # An order with zero items returns false — shouldn't happen
    # since OrderCreate.min_length=1, but the guard keeps a future
    # code path from accidentally reading a vacuous "all ready"
    # for an empty order.
    all_lines_ready: bool = False

    @model_validator(mode="before")
    @classmethod
    def _resolve_joined_fields(cls, values: Any) -> Any:
        # Dicts that already have the joined names pass through
        # — keeps manual construction and tests ergonomic. Same
        # shape as OrderItemRead._resolve_joined_fields; the two
        # resolvers don't share a base class because the joined
        # relationship set is different (Customer/Waiter/User
        # here, MenuItem/Chef/Bartender there).
        if isinstance(values, dict):
            return values
        customer = getattr(values, "customer", None)
        customer_name = getattr(customer, "name", None)
        waiter = getattr(values, "waiter", None)
        waiter_name = getattr(waiter, "name", None)
        # The cancelling actor is a User (auth record), not a
        # profile row — the User model itself has no `name`
        # field. Walk from User -> the matching profile based
        # on role, since every role that can cancel (customer
        # or staff) has a corresponding profile table with a
        # `name` column. Admin is the only role without a
        # profile, so an admin-cancel falls back to the user's
        # email as the display string — honest (it's the only
        # identifier on the User row) and not a blank cell.
        cancelled_by_user = getattr(values, "cancelled_by_user", None)
        cancelled_by_name: Optional[str] = None
        if cancelled_by_user is not None:
            role = getattr(cancelled_by_user, "role", None)
            profile = (
                getattr(cancelled_by_user, "customer_profile", None)
                or getattr(cancelled_by_user, "waiter_profile", None)
                or getattr(cancelled_by_user, "chef_profile", None)
                or getattr(cancelled_by_user, "bartender_profile", None)
            )
            if profile is not None:
                cancelled_by_name = getattr(profile, "name", None)
            elif role is not None and str(role.value) == "admin":
                cancelled_by_name = getattr(cancelled_by_user, "email", None)
        # `cancelled_at` is a real column on Order, so
        # from_attributes reads it directly. The only reason
        # it's listed in the resolver is to keep all the
        # cancellation fields in one place for review.
        if hasattr(values, "__dict__"):
            merged = {
                **values.__dict__,
                "customer_name": customer_name,
                "waiter_name": waiter_name,
                "cancelled_by_name": cancelled_by_name,
            }
            return merged
        return {
            "customer_name": customer_name,
            "waiter_name": waiter_name,
            "cancelled_by_name": cancelled_by_name,
        }


class OrderItemCreate(BaseModel):
    """One line in POST /orders.

    Note: `unit_price` and `subtotal` are intentionally NOT accepted
    from the client. The router looks up MenuItem.price from the database
    and computes the subtotal server-side. This stops a tampered client
    from undercharging themselves.
    """

    menu_item_id: int
    quantity: int = Field(gt=0, le=99)


class OrderCreate(BaseModel):
    """Request body for POST /orders.

    The customer's `restaurant_id` (from their User row) must match
    `restaurant_id` here — the router enforces this so a customer
    belonging to one restaurant can't place an order at another.
    """

    restaurant_id: int
    items: list[OrderItemCreate] = Field(min_length=1)


class OrderUpdate(BaseModel):
    """Request body for PATCH /orders/{order_id} (waiter/admin only).

    All fields optional. Only the fields provided are updated.
    Per the per-field role gate (see routers/orders.py):
        - `status`, `waiter_id`, `estimated_wait_time` are waiter/admin only.
    Other fields will be added as separate routes (e.g. line-claim
    is a dedicated endpoint, not a PATCH on the order).
    """

    status: Optional[OrderStatus] = None
    waiter_id: Optional[int] = None
    estimated_wait_time: Optional[int] = Field(default=None, ge=0, le=480)


class OrderItemClaimResponse(BaseModel):
    """Response for POST /orders/{order_id}/items/{menu_item_id}/claim.

    Returns the updated line so the chef/bartender can confirm the
    claim took effect.
    """

    model_config = ConfigDict(from_attributes=True)

    order_id: int
    menu_item_id: int
    # Mirrors OrderItemRead.menu_item_name. The @model_validator walks
    # the menu_item relationship at serialization time; the claim
    # router ensures line.menu_item is loaded (see routers/orders.py
    # claim_order_item).
    menu_item_name: str
    # Mirrors OrderItemRead.item_type — joined from the already-loaded
    # menu_item relationship. Including it here keeps the claim
    # response shape consistent with OrderItemRead so the chef/
    # bartender dashboards don't need a second fetch to learn the
    # line's type.
    item_type: ItemType
    quantity: int
    unit_price: Decimal
    subtotal: Decimal
    chef_id: Optional[int]
    bartender_id: Optional[int]
    # Mirrors OrderItemRead.chef_name / bartender_name — same
    # rationale, same eager-load. The claim response is the
    # one mutation path that flips chef_id/bartender_id from
    # null to a real id, so the resolver walks the same
    # relationships that the read shape does. The chef/
    # bartender who just claimed the line sees their own name
    # back (the staff_dashboard "Claimed by you" branch
    # already keys off chef_id/bartender_id, so this is
    # belt-and-suspenders for the claim endpoint specifically).
    chef_name: Optional[str] = None
    bartender_name: Optional[str] = None
    # Mirrors OrderItemRead.status — included so the claim response
    # surface stays consistent with the read shape. A chef who
    # claims a line gets the current status back in the same
    # payload, with no extra fetch. Pydantic's from_attributes reads
    # this directly off the ORM line; no @model_validator work is
    # needed for this field (only the joined fields need the
    # resolver).
    status: OrderItemStatus

    @model_validator(mode="before")
    @classmethod
    def _resolve_joined_fields(cls, values: Any) -> Any:
        if isinstance(values, dict):
            return values
        menu_item = getattr(values, "menu_item", None)
        menu_item_name = getattr(menu_item, "name", None)
        item_type = getattr(menu_item, "item_type", None)
        chef = getattr(values, "chef", None)
        chef_name = getattr(chef, "name", None)
        bartender = getattr(values, "bartender", None)
        bartender_name = getattr(bartender, "name", None)
        if hasattr(values, "__dict__"):
            merged = {
                **values.__dict__,
                "menu_item_name": menu_item_name,
                "chef_name": chef_name,
                "bartender_name": bartender_name,
            }
            if item_type is not None:
                merged["item_type"] = item_type
            return merged
        out: dict = {
            "menu_item_name": menu_item_name,
            "chef_name": chef_name,
            "bartender_name": bartender_name,
        }
        if item_type is not None:
            out["item_type"] = item_type
        return out


class OrderItemUpdate(BaseModel):
    """Request body for PATCH /orders/{order_id}/items/{menu_item_id}.

    The only mutable field today is `status`, and the only legal
    transition is Preparing -> Ready. Other fields are immutable; the
    router enforces both the per-field role gate and the state
    machine, so this schema intentionally exposes a single required
    field. Mirrors ComplaintUpdate's shape.
    """

    status: OrderItemStatus


# --- Complaint / rating / payment ------------------------------------------


class ComplaintRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    complaint_text: str
    complaint_date: datetime
    status: ComplaintStatus
    order_id: int
    customer_id: int
    # Joined display name from the Customer profile row that
    # owns this complaint. The Customer FK is NOT NULL on
    # Complaint (every complaint is filed by the order's owning
    # customer), so customer_name is required. The relationship
    # is eager-loaded by both `get_complaint` (feedback.py) and
    # `list_restaurant_complaints` (restaurants.py); the
    # @model_validator below walks `complaint.customer.name` at
    # model_validate time. Pydantic's from_attributes would
    # otherwise look for a real `customer_name` attribute on the
    # Complaint ORM row and raise a validation error — same
    # joined-field pattern as OrderRead.customer_name.
    customer_name: str

    @model_validator(mode="before")
    @classmethod
    def _resolve_customer_name(cls, values: Any) -> Any:
        if isinstance(values, dict):
            return values
        customer = getattr(values, "customer", None)
        customer_name = getattr(customer, "name", None)
        if hasattr(values, "__dict__"):
            return {**values.__dict__, "customer_name": customer_name}
        return {"customer_name": customer_name}


class ComplaintCreate(BaseModel):
    """Request body for POST /orders/{order_id}/complaint.

    The complaint starts in `Open` status; resolution is a separate flow
    (not exposed yet). The router enforces one-per-order at the
    application layer so we can return a clean 409 instead of letting
    the unique constraint raise IntegrityError.
    """

    complaint_text: str = Field(min_length=1, max_length=2000)


class ComplaintUpdate(BaseModel):
    """Request body for PATCH /orders/{order_id}/complaint.

    The only mutable field today is `status`, and the only legal
    transition is Open -> Resolved (admin-only). Other fields are
    immutable; the router enforces both the field gate and the
    transition rule, so this schema intentionally exposes a single
    required field.
    """

    status: ComplaintStatus


class RatingRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    rating_value: int
    comment: Optional[str]
    rating_date: datetime
    order_id: int
    customer_id: int


class RatingCreate(BaseModel):
    """Request body for POST /orders/{order_id}/rating.

    `rating_value` is constrained to 1-5 at the schema layer. Same
    one-per-order rule as Complaint — enforced by the router, not the DB
    unique constraint, so the conflict is a clean 409.
    """

    rating_value: int = Field(ge=1, le=5)
    comment: Optional[str] = Field(default=None, max_length=2000)


class PaymentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    amount: Decimal
    payment_method: str
    payment_status: PaymentStatus
    payment_date: Optional[datetime]
    transaction_reference: Optional[str]
    order_id: int
