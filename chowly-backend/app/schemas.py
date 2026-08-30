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
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models import (
    ComplaintStatus,
    ItemType,
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
    quantity: int
    unit_price: Decimal
    subtotal: Decimal
    chef_id: Optional[int]
    bartender_id: Optional[int]


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


# --- Complaint / rating / payment ------------------------------------------


class ComplaintRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    complaint_text: str
    complaint_date: datetime
    status: ComplaintStatus
    order_id: int
    customer_id: int


class RatingRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    rating_value: int
    comment: Optional[str]
    rating_date: datetime
    order_id: int
    customer_id: int


class PaymentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    amount: Decimal
    payment_method: str
    payment_status: PaymentStatus
    payment_date: Optional[datetime]
    transaction_reference: Optional[str]
    order_id: int
