"""
Seed script for the Chowly backend.

Inserts a representative sample of restaurants, staff, customers, menus,
orders, payments, complaints, and ratings so the API and schema can be
exercised end-to-end. No User rows are created here — those are added
in the auth step.

Safety model: this script CLEARS all application tables before inserting.
Re-running it always yields a known-fresh state. The alembic_version
row is preserved (migrations are not affected).

Run from the project root:
    python -m scripts.seed
"""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

# Make the app package importable when running this file directly.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text

from app.database import SessionLocal
from app.models import (
    Bartender,
    Chef,
    Complaint,
    ComplaintStatus,
    Customer,
    ItemType,
    Menu,
    MenuItem,
    Order,
    OrderItem,
    OrderStatus,
    Payment,
    PaymentStatus,
    Rating,
    Restaurant,
    Waiter,
)


# --- Helpers ---------------------------------------------------------------


def clear_tables(db) -> None:
    """Delete all rows in dependency order (children → parents).

    Order matters because of FK constraints. We disable constraint
    checks for the duration of the wipe as a belt-and-braces guard.
    """
    # TRUNCATE with CASCADE is faster and handles any FK ordering we miss.
    db.execute(
        text(
            "TRUNCATE TABLE "
            "ratings, payments, complaints, order_items, orders, "
            "menu_items, menus, "
            "waiters, bartenders, chefs, customers, "
            "restaurants "
            "RESTART IDENTITY CASCADE"
        )
    )
    db.commit()


# --- Seed data -------------------------------------------------------------


RESTAURANTS = [
    {
        "name": "Mama Put Kitchen",
        "address": "12 Allen Avenue, Ikeja, Lagos",
        "phone": "+234-801-111-1111",
        "email": "hello@mamaput.ng",
    },
    {
        "name": "Sushi & Stout",
        "address": "45 Oxford Street, London",
        "phone": "+44-20-7946-0000",
        "email": "reservations@sushiandstout.co.uk",
    },
]


MENUS = {
    # menu items keyed by restaurant name
    "Mama Put Kitchen": [
        ("Jollof Rice & Chicken", "Smoky party-style jollof with grilled chicken thigh", ItemType.FOOD, "12.50", "available"),
        ("Egusi Soup & Pounded Yam", "Melon-seed stew with assorted meat, swallow on the side", ItemType.FOOD, "14.00", "available"),
        ("Suya Skewers (4)", "Spicy peanut-rubbed beef skewers", ItemType.FOOD, "8.00", "available"),
        ("Chapman", "House cocktail: Angostura, Fanta, grenadine, citrus", ItemType.DRINK, "4.50", "available"),
        ("Zobo Lemonade", "Hibiscus and fresh lemon, lightly sweetened", ItemType.DRINK, "3.50", "available"),
    ],
    "Sushi & Stout": [
        ("Salmon Nigiri (6 pcs)", "Scottish salmon over seasoned sushi rice", ItemType.FOOD, "16.00", "available"),
        ("Spicy Tuna Roll", "Tuna, sriracha mayo, cucumber, sesame", ItemType.FOOD, "13.50", "available"),
        ("Edamame", "Steamed soybeans, sea salt", ItemType.FOOD, "5.00", "available"),
        ("Asahi Draft (pint)", "Japanese lager, cold", ItemType.DRINK, "7.00", "available"),
        ("Yuzu Sour", "Whisky, yuzu, egg white", ItemType.DRINK, "11.00", "available"),
    ],
}


# Customer / staff seed data is generated per-restaurant below so each
# restaurant has a self-contained slice of the demo dataset.


def seed():
    db = SessionLocal()
    try:
        print("Clearing existing rows...")
        clear_tables(db)

        # --- Restaurants -------------------------------------------------
        print("Inserting restaurants...")
        restaurants_by_name: dict[str, Restaurant] = {}
        for r in RESTAURANTS:
            obj = Restaurant(**r)
            db.add(obj)
            db.flush()
            restaurants_by_name[obj.name] = obj

        # --- Staff and customers per restaurant --------------------------
        # Built procedurally so each restaurant gets a small, consistent
        # set of people. Names are intentionally generic — these are demo
        # rows, not real users.
        staff_by_restaurant: dict[str, dict] = {}
        customers_by_restaurant: dict[str, list[Customer]] = {}

        for r_index, restaurant in enumerate(restaurants_by_name.values()):
            tag = r_index + 1  # 1-indexed suffix so names don't collide
            prefix = restaurant.name.split()[0].lower()

            # 3 customers
            customers = []
            for c_index in range(1, 4):
                c = Customer(
                    name=f"{restaurant.name.split()[0]} Customer {c_index}",
                    phone=f"+1000000{tag:01d}{c_index:02d}",
                    email=f"customer{c_index}@{prefix}.test",
                    restaurant_id=restaurant.id,
                )
                db.add(c)
                customers.append(c)
            db.flush()
            customers_by_restaurant[restaurant.name] = customers

            # 3 waiters, 2 chefs, 2 bartenders
            waiters = [
                Waiter(
                    name=f"{restaurant.name.split()[0]} Waiter {i}",
                    phone=f"+2000000{tag:01d}{i:02d}",
                    restaurant_id=restaurant.id,
                )
                for i in range(1, 4)
            ]
            chefs = [
                Chef(
                    name=f"{restaurant.name.split()[0]} Chef {i}",
                    phone=f"+3000000{tag:01d}{i:02d}",
                    restaurant_id=restaurant.id,
                )
                for i in range(1, 3)
            ]
            bartenders = [
                Bartender(
                    name=f"{restaurant.name.split()[0]} Bartender {i}",
                    phone=f"+4000000{tag:01d}{i:02d}",
                    restaurant_id=restaurant.id,
                )
                for i in range(1, 3)
            ]
            for obj in waiters + chefs + bartenders:
                db.add(obj)
            db.flush()

            staff_by_restaurant[restaurant.name] = {
                "waiters": waiters,
                "chefs": chefs,
                "bartenders": bartenders,
            }

        # --- Menus and menu items ---------------------------------------
        print("Inserting menus and menu items...")
        menu_items_by_restaurant: dict[str, list[MenuItem]] = {}
        for restaurant_name, restaurant in restaurants_by_name.items():
            menu = Menu(
                name=f"{restaurant_name} — Main Menu",
                description=f"House menu for {restaurant_name}.",
                status="active",
                restaurant_id=restaurant.id,
            )
            db.add(menu)
            db.flush()

            items = []
            for name, description, item_type, price, availability in MENUS[restaurant_name]:
                mi = MenuItem(
                    name=name,
                    description=description,
                    item_type=item_type,
                    price=Decimal(price),
                    availability_status=availability,
                    menu_id=menu.id,
                )
                db.add(mi)
                items.append(mi)
            db.flush()
            menu_items_by_restaurant[restaurant_name] = items

        # --- Orders ------------------------------------------------------
        # We construct 3 orders total: 2 at Mama Put, 1 at Sushi & Stout.
        # Each order mixes food and drink items so chef_id AND bartender_id
        # are populated on the same order — the case this schema is built
        # to support.
        print("Inserting orders with mixed food/drink line items...")

        def build_order(*, restaurant, customer, waiter, items_with_assignments, status, eta, total):
            """items_with_assignments: list of (menu_item, chef_id|None, bartender_id|None)."""
            order = Order(
                status=status,
                estimated_wait_time=eta,
                total_amount=Decimal(total),
                customer_id=customer.id,
                restaurant_id=restaurant.id,
                waiter_id=waiter.id,
            )
            db.add(order)
            db.flush()

            for menu_item, chef_id, bartender_id in items_with_assignments:
                qty = 1
                unit_price = menu_item.price
                subtotal = unit_price * qty
                oi = OrderItem(
                    order_id=order.id,
                    menu_item_id=menu_item.id,
                    quantity=qty,
                    unit_price=unit_price,
                    subtotal=subtotal,
                    chef_id=chef_id,
                    bartender_id=bartender_id,
                )
                db.add(oi)
            return order

        # --- Order 1: Mama Put, Served. Two food items + one drink. ------
        mp = restaurants_by_name["Mama Put Kitchen"]
        mp_items = menu_items_by_restaurant["Mama Put Kitchen"]
        mp_staff = staff_by_restaurant["Mama Put Kitchen"]
        mp_customers = customers_by_restaurant["Mama Put Kitchen"]

        # Food items go to a chef, drink items go to a bartender.
        order1_total = sum(
            (mi.price for mi in mp_items[:3]),  # 2 food + 1 drink
            Decimal("0"),
        )
        order1 = build_order(
            restaurant=mp,
            customer=mp_customers[0],
            waiter=mp_staff["waiters"][0],
            items_with_assignments=[
                (mp_items[0], mp_staff["chefs"][0].id, None),        # Jollof → chef
                (mp_items[1], mp_staff["chefs"][1].id, None),        # Egusi → other chef
                (mp_items[3], None, mp_staff["bartenders"][0].id),   # Chapman → bartender
            ],
            status=OrderStatus.SERVED,
            eta=25,
            total=str(order1_total),
        )

        # --- Order 2: Mama Put, Delayed. Three food + two drinks. -------
        # This is the order that gets the complaint and rating.
        order2_total = sum(
            (mi.price for mi in [mp_items[0], mp_items[1], mp_items[2], mp_items[3], mp_items[4]]),
            Decimal("0"),
        )
        order2 = build_order(
            restaurant=mp,
            customer=mp_customers[1],
            waiter=mp_staff["waiters"][1],
            items_with_assignments=[
                (mp_items[0], mp_staff["chefs"][0].id, None),        # Jollof
                (mp_items[1], mp_staff["chefs"][1].id, None),        # Egusi
                (mp_items[2], mp_staff["chefs"][0].id, None),        # Suya
                (mp_items[3], None, mp_staff["bartenders"][0].id),   # Chapman
                (mp_items[4], None, mp_staff["bartenders"][1].id),   # Zobo
            ],
            status=OrderStatus.DELAYED,
            eta=45,
            total=str(order2_total),
        )

        # --- Order 3: Sushi & Stout, In Preparation. Mix of food + drink.
        ss = restaurants_by_name["Sushi & Stout"]
        ss_items = menu_items_by_restaurant["Sushi & Stout"]
        ss_staff = staff_by_restaurant["Sushi & Stout"]
        ss_customers = customers_by_restaurant["Sushi & Stout"]

        order3_total = sum(
            (mi.price for mi in [ss_items[0], ss_items[1], ss_items[3]]),
            Decimal("0"),
        )
        order3 = build_order(
            restaurant=ss,
            customer=ss_customers[0],
            waiter=ss_staff["waiters"][0],
            items_with_assignments=[
                (ss_items[0], ss_staff["chefs"][0].id, None),        # Salmon nigiri
                (ss_items[1], ss_staff["chefs"][1].id, None),        # Spicy tuna
                (ss_items[3], None, ss_staff["bartenders"][0].id),   # Asahi
            ],
            status=OrderStatus.IN_PREPARATION,
            eta=20,
            total=str(order3_total),
        )

        # --- Complaint + rating on the Delayed order --------------------
        print("Inserting complaint and rating on the Delayed order...")
        db.add(
            Complaint(
                complaint_text=(
                    "Order took far longer than estimated and one of the "
                    "drinks arrived flat."
                ),
                order_id=order2.id,
                customer_id=order2.customer_id,
                status=ComplaintStatus.OPEN,
            )
        )
        db.add(
            Rating(
                rating_value=3,
                comment="Food was great but the wait hurt the experience.",
                order_id=order2.id,
                customer_id=order2.customer_id,
            )
        )

        # --- Payments: one per order ------------------------------------
        print("Inserting payments...")
        db.add(
            Payment(
                amount=order1.total_amount,
                payment_method="card",
                payment_status=PaymentStatus.COMPLETED,
                payment_date=None,  # let it be set by the API layer in real use
                transaction_reference="seed-txn-0001",
                order_id=order1.id,
            )
        )
        db.add(
            Payment(
                amount=order2.total_amount,
                payment_method="card",
                payment_status=PaymentStatus.PENDING,
                payment_date=None,
                transaction_reference="seed-txn-0002",
                order_id=order2.id,
            )
        )
        db.add(
            Payment(
                amount=order3.total_amount,
                payment_method="cash",
                payment_status=PaymentStatus.PENDING,
                payment_date=None,
                transaction_reference="seed-txn-0003",
                order_id=order3.id,
            )
        )

        db.commit()
        print("Seed complete.")

    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed()
