"""
SQLAlchemy ORM models for the Chowly digital dining platform.

Defines the schema for users, restaurants, staff, menus, orders, payments,
complaints, and ratings. All models share the declarative Base from
app.database.

Enums are defined as Python enums so the same definitions can be reused by
Pydantic schemas in the API layer.
"""

from datetime import datetime
from enum import Enum as PyEnum

from sqlalchemy import (
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.orm import relationship

from app.database import Base


# --- Enums ------------------------------------------------------------------


class Role(PyEnum):
    CUSTOMER = "customer"
    WAITER = "waiter"
    CHEF = "chef"
    BARTENDER = "bartender"
    ADMIN = "admin"


class ItemType(PyEnum):
    FOOD = "Food"
    DRINK = "Drink"


class OrderStatus(PyEnum):
    IN_PREPARATION = "In Preparation"
    DELAYED = "Delayed"
    SERVED = "Served"
    CANCELLED = "Cancelled"


class ComplaintStatus(PyEnum):
    OPEN = "Open"
    RESOLVED = "Resolved"


class OrderItemStatus(PyEnum):
    """OrderItem — per-line preparation state.

    PREPARING covers both the "unclaimed" and "claimed but not yet
    ready" states — the existing `chef_id` / `bartender_id` FKs
    already carry the claim signal, so a separate "Claimed" enum
    value would be redundant. READY is the terminal state for the
    line; the chef/bartender flips a line to READY via
    PATCH /orders/{order_id}/items/{menu_item_id}.

    PRODUCT.md line 35 defines the lifecycle as
    `unclaimed -> claimed -> prepared`; the "prepared" state is
    what this enum names READY. The two states map to a 2-value
    PostgreSQL enum; expanding to 3 values is a 1-line migration
    if a future step needs the full 3-state distinction (e.g.
    analytics on lines abandoned in PREPARING for >20 minutes).
    """

    PREPARING = "Preparing"
    READY = "Ready"


class PaymentStatus(PyEnum):
    PENDING = "Pending"
    COMPLETED = "Completed"
    FAILED = "Failed"


# --- Models -----------------------------------------------------------------


class User(Base):
    """User — authentication record for anyone who can log in to Chowly."""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    role = Column(
        Enum(Role, name="role_enum", values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    restaurant_id = Column(Integer, ForeignKey("restaurants.id"), nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    restaurant = relationship("Restaurant", back_populates="users")
    customer_profile = relationship(
        "Customer", back_populates="user", uselist=False
    )
    waiter_profile = relationship(
        "Waiter", back_populates="user", uselist=False
    )
    chef_profile = relationship(
        "Chef", back_populates="user", uselist=False
    )
    bartender_profile = relationship(
        "Bartender", back_populates="user", uselist=False
    )


class Restaurant(Base):
    """Restaurant — keeps records of restaurants using Chowly."""
    __tablename__ = "restaurants"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    address = Column(String, nullable=False)
    phone = Column(String, nullable=False)
    email = Column(String, nullable=False)

    users = relationship("User", back_populates="restaurant")
    customers = relationship("Customer", back_populates="restaurant")
    waiters = relationship("Waiter", back_populates="restaurant")
    chefs = relationship("Chef", back_populates="restaurant")
    bartenders = relationship("Bartender", back_populates="restaurant")
    menus = relationship("Menu", back_populates="restaurant")
    orders = relationship("Order", back_populates="restaurant")


class Customer(Base):
    """Customer — a diner who places orders at a restaurant."""
    __tablename__ = "customers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    phone = Column(String, nullable=False)
    email = Column(String, nullable=False)
    restaurant_id = Column(
        Integer, ForeignKey("restaurants.id"), nullable=False
    )
    user_id = Column(
        Integer, ForeignKey("users.id"), unique=True, nullable=True
    )

    restaurant = relationship("Restaurant", back_populates="customers")
    user = relationship("User", back_populates="customer_profile")
    orders = relationship("Order", back_populates="customer")
    ratings = relationship("Rating", back_populates="customer")
    complaints = relationship("Complaint", back_populates="customer")


class Waiter(Base):
    """Waiter — front-of-house staff who take and serve orders."""
    __tablename__ = "waiters"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    phone = Column(String, nullable=False)
    restaurant_id = Column(
        Integer, ForeignKey("restaurants.id"), nullable=False
    )
    user_id = Column(
        Integer, ForeignKey("users.id"), unique=True, nullable=True
    )

    restaurant = relationship("Restaurant", back_populates="waiters")
    user = relationship("User", back_populates="waiter_profile")
    orders = relationship("Order", back_populates="waiter")


class Chef(Base):
    """Chef — kitchen staff who prepare food items on orders."""
    __tablename__ = "chefs"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    phone = Column(String, nullable=False)
    restaurant_id = Column(
        Integer, ForeignKey("restaurants.id"), nullable=False
    )
    user_id = Column(
        Integer, ForeignKey("users.id"), unique=True, nullable=True
    )

    restaurant = relationship("Restaurant", back_populates="chefs")
    user = relationship("User", back_populates="chef_profile")
    order_items = relationship("OrderItem", back_populates="chef")


class Bartender(Base):
    """Bartender — bar staff who prepare drink items on orders."""
    __tablename__ = "bartenders"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    phone = Column(String, nullable=False)
    restaurant_id = Column(
        Integer, ForeignKey("restaurants.id"), nullable=False
    )
    user_id = Column(
        Integer, ForeignKey("users.id"), unique=True, nullable=True
    )

    restaurant = relationship("Restaurant", back_populates="bartenders")
    user = relationship("User", back_populates="bartender_profile")
    order_items = relationship("OrderItem", back_populates="bartender")


class Menu(Base):
    """Menu — a curated list of items a restaurant offers."""
    __tablename__ = "menus"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String, nullable=False)
    restaurant_id = Column(
        Integer, ForeignKey("restaurants.id"), nullable=False
    )

    restaurant = relationship("Restaurant", back_populates="menus")
    items = relationship(
        "MenuItem", back_populates="menu", cascade="all, delete-orphan"
    )


class MenuItem(Base):
    """MenuItem — a single dish or drink on a menu, priced and bookable."""
    __tablename__ = "menu_items"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    item_type = Column(
        Enum(ItemType, name="item_type_enum", values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    price = Column(Numeric(10, 2), nullable=False)
    availability_status = Column(String, nullable=False)
    menu_id = Column(Integer, ForeignKey("menus.id"), nullable=False)

    menu = relationship("Menu", back_populates="items")
    order_items = relationship("OrderItem", back_populates="menu_item")


class Order(Base):
    """Order — a customer's ticket for one or more menu items."""
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True, index=True)
    order_date = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    status = Column(
        Enum(OrderStatus, name="order_status_enum", values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    estimated_wait_time = Column(Integer, nullable=False)  # minutes
    total_amount = Column(Numeric(10, 2), nullable=False)
    customer_id = Column(
        Integer, ForeignKey("customers.id"), nullable=False
    )
    restaurant_id = Column(
        Integer, ForeignKey("restaurants.id"), nullable=False
    )
    waiter_id = Column(Integer, ForeignKey("waiters.id"), nullable=True)
    # Cancellation attribution. Both columns stay NULL while the
    # order is in any non-cancelled state; PATCH /orders/{id}
    # sets them in the same write that flips status to CANCELLED
    # (see routers/orders.py:update_order). The FK uses
    # ondelete=SET NULL so a deleted user doesn't cascade-wipe
    # order history — the row keeps its cancelled_at timestamp,
    # and a future backfill can resolve the actor from an audit
    # log. cancelled_at is timezone-aware to match order_date;
    # the router sources the timestamp from func.now() (the same
    # DB clock the cancel-window check uses) so the two are
    # apples-to-apples.
    cancelled_by_user_id = Column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    cancelled_at = Column(DateTime(timezone=True), nullable=True)

    customer = relationship("Customer", back_populates="orders")
    restaurant = relationship("Restaurant", back_populates="orders")
    waiter = relationship("Waiter", back_populates="orders")
    # One-way: User has no `cancelled_orders` backref because we
    # never query "every order user X cancelled" today. The join
    # only flows Order -> User for the read path (OrderRead.
    # cancelled_by_name, the admin complaint cross-reference,
    # and a future audit endpoint). Adding the backref would
    # be a no-op today and would only widen the User ORM
    # surface — keep it one-way until there's a use.
    cancelled_by_user = relationship("User")
    items = relationship(
        "OrderItem", back_populates="order", cascade="all, delete-orphan"
    )
    complaint = relationship(
        "Complaint", back_populates="order", uselist=False
    )
    rating = relationship(
        "Rating", back_populates="order", uselist=False
    )
    payment = relationship(
        "Payment", back_populates="order", uselist=False
    )


class OrderItem(Base):
    """OrderItem — a single line item on an order, routed to chef or bartender."""
    __tablename__ = "order_items"

    # Composite primary key: an order can contain each menu item at most
    # once (multiple units are represented by `quantity`).
    order_id = Column(
        Integer, ForeignKey("orders.id"), primary_key=True
    )
    menu_item_id = Column(
        Integer, ForeignKey("menu_items.id"), primary_key=True
    )
    quantity = Column(Integer, nullable=False)
    unit_price = Column(Numeric(10, 2), nullable=False)
    subtotal = Column(Numeric(10, 2), nullable=False)
    chef_id = Column(Integer, ForeignKey("chefs.id"), nullable=True)
    bartender_id = Column(
        Integer, ForeignKey("bartenders.id"), nullable=True
    )
    # Per-line preparation state. See OrderItemStatus for the
    # rationale behind the 2-value enum (PRODUCT.md lifecycle note).
    # The Alembic migration that introduced this column sets
    # server_default='Preparing' so existing rows backfill cleanly;
    # we don't repeat that here because the model layer doesn't
    # need a default — the DB enforces NOT NULL on read.
    status = Column(
        Enum(
            OrderItemStatus,
            name="order_item_status_enum",
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
    )

    order = relationship("Order", back_populates="items")
    menu_item = relationship("MenuItem", back_populates="order_items")
    chef = relationship("Chef", back_populates="order_items")
    bartender = relationship("Bartender", back_populates="order_items")


class Complaint(Base):
    """Complaint — a diner's issue raised against a specific order."""
    __tablename__ = "complaints"

    id = Column(Integer, primary_key=True, index=True)
    complaint_text = Column(Text, nullable=False)
    complaint_date = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    status = Column(
        Enum(ComplaintStatus, name="complaint_status_enum", values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    order_id = Column(
        Integer, ForeignKey("orders.id"), unique=True, nullable=False
    )
    customer_id = Column(
        Integer, ForeignKey("customers.id"), nullable=False
    )

    order = relationship("Order", back_populates="complaint")
    customer = relationship("Customer", back_populates="complaints")


class Rating(Base):
    """Rating — a diner's 1-5 star review of an order."""
    __tablename__ = "ratings"

    id = Column(Integer, primary_key=True, index=True)
    rating_value = Column(Integer, nullable=False)  # 1-5, validated at schema layer
    comment = Column(Text, nullable=True)
    rating_date = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    order_id = Column(
        Integer, ForeignKey("orders.id"), unique=True, nullable=False
    )
    customer_id = Column(
        Integer, ForeignKey("customers.id"), nullable=False
    )

    order = relationship("Order", back_populates="rating")
    customer = relationship("Customer", back_populates="ratings")


class Payment(Base):
    """Payment — the financial settlement for an order."""
    __tablename__ = "payments"

    id = Column(Integer, primary_key=True, index=True)
    amount = Column(Numeric(10, 2), nullable=False)
    payment_method = Column(String, nullable=False)
    payment_status = Column(
        Enum(PaymentStatus, name="payment_status_enum", values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    payment_date = Column(DateTime(timezone=True), nullable=True)
    transaction_reference = Column(String, unique=True, nullable=True)
    order_id = Column(
        Integer, ForeignKey("orders.id"), unique=True, nullable=False
    )

    order = relationship("Order", back_populates="payment")