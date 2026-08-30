"""
Seed script for demo User (auth) accounts.

The original scripts/seed.py deliberately skips creating User rows —
that's an auth-layer concern. This script fills that gap with a small,
memorable set of demo accounts that link to the existing profile rows
from seed.py, so each demo account already has real orders, complaints,
and ratings attached.

Accounts created (all with password "chowly123"):

    customer1@chowlydemo.com   -> Mama Customer 1 (owns the Served order)
    customer2@chowlydemo.com   -> Mama Customer 2 (owns the Delayed order
                                  with the seed complaint + rating)
    waiter1@chowlydemo.com     -> Mama Waiter 1
    chef1@chowlydemo.com       -> Mama Chef 1
    bartender1@chowlydemo.com  -> Mama Mama Bartender 1
    admin1@chowlydemo.com      -> restaurant-scoped admin for Mama Put

Emails use @chowlydemo.com (a real TLD) so Pydantic's EmailStr accepts
them and POST /auth/login works end-to-end. Reserved TLDs like .test
or .example would be rejected.

Re-run safety: by email. Existing demo users are detected and either
left alone (if the profile link is already correct) or have their
password reset and profile link re-asserted. No other User rows in the
database are touched. Profile rows that are already linked to a
*different* user are not overwritten — that's a manual-fix situation
and we just warn.

Run from the project root:
    python -m scripts.seed_users
"""

from __future__ import annotations

import sys
from pathlib import Path

# Make the app package importable when running this file directly.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select

from app.auth import hash_password
from app.database import SessionLocal
from app.models import (
    Bartender,
    Chef,
    Customer,
    Restaurant,
    Role,
    User,
    Waiter,
)


# --- Demo account definitions ----------------------------------------------


# All demo users share this password — it's only useful for local dev
# against a seeded database, never for anything resembling production.
DEMO_PASSWORD = "chowly123"

# Each entry maps an email to (role, restaurant_id, profile_kind, profile_id)
# where profile_kind is one of "customer" / "waiter" / "chef" / "bartender"
# and profile_id is the seed-data row to link to. `restaurant_id=None` for
# admin means a global super-admin; here we set it to 1 to make this a
# restaurant-scoped admin who can add/edit menu items at Mama Put.
DEMO_ACCOUNTS: list[dict] = [
    {
        "email": "customer1@chowlydemo.com",
        "role": Role.CUSTOMER,
        "restaurant_id": 1,
        "profile_kind": "customer",
        "profile_id": 1,  # Mama Customer 1 — owns the Served order
    },
    {
        "email": "customer2@chowlydemo.com",
        "role": Role.CUSTOMER,
        "restaurant_id": 1,
        "profile_kind": "customer",
        "profile_id": 2,  # Mama Customer 2 — owns the Delayed order
    },
    {
        "email": "waiter1@chowlydemo.com",
        "role": Role.WAITER,
        "restaurant_id": 1,
        "profile_kind": "waiter",
        "profile_id": 1,  # Mama Waiter 1
    },
    {
        "email": "chef1@chowlydemo.com",
        "role": Role.CHEF,
        "restaurant_id": 1,
        "profile_kind": "chef",
        "profile_id": 1,  # Mama Chef 1
    },
    {
        "email": "bartender1@chowlydemo.com",
        "role": Role.BARTENDER,
        "restaurant_id": 1,
        "profile_kind": "bartender",
        "profile_id": 1,  # Mama Bartender 1
    },
    {
        "email": "admin1@chowlydemo.com",
        "role": Role.ADMIN,
        "restaurant_id": 1,  # restaurant-scoped admin
        "profile_kind": None,  # admins have no profile row
        "profile_id": None,
    },
]


# Profile kind -> ORM class. Used to fetch the row to link to.
PROFILE_CLASSES = {
    "customer": Customer,
    "waiter": Waiter,
    "chef": Chef,
    "bartender": Bartender,
}


# --- Helpers ---------------------------------------------------------------


def _get_or_create_user(
    db, *, email: str, role: Role, restaurant_id: int | None
) -> tuple[User, bool]:
    """Find the demo user by email, or create one. Returns (user, created).

    On re-run, the existing user is found by email. We always reset the
    password to the demo password so the script also serves as a
    "reset demo credentials" tool. We do NOT touch the restaurant_id
    or role on a re-run — those reflect the original setup, and changing
    them silently would mask a configuration mistake.
    """
    user = db.execute(
        select(User).where(User.email == email)
    ).scalar_one_or_none()

    if user is None:
        user = User(
            email=email,
            password_hash=hash_password(DEMO_PASSWORD),
            role=role,
            restaurant_id=restaurant_id,
        )
        db.add(user)
        db.flush()  # assign id without committing
        return user, True

    # Existing row: refresh the password hash, but leave role/rid alone.
    user.password_hash = hash_password(DEMO_PASSWORD)
    return user, False


def _ensure_profile_link(
    db, *, user: User, profile_kind: str | None, profile_id: int | None
) -> str:
    """Wire `user_id` on the target profile row to `user.id`.

    Returns a short status string the caller can print. The three
    outcomes are:
        "linked"   — first run, or previous run with a NULL user_id;
                     we set it now.
        "ok"       — already linked to this user; nothing to do.
        "conflict" — already linked to a DIFFERENT user; we don't
                     touch it (manual fix needed).
    """
    if profile_kind is None:
        # Admin: no profile row to link.
        return "n/a"

    model = PROFILE_CLASSES[profile_kind]
    profile = db.get(model, profile_id)
    if profile is None:
        raise RuntimeError(
            f"Profile row {profile_kind} id={profile_id} not found. "
            f"Did you run scripts/seed.py first?"
        )

    if profile.user_id == user.id:
        return "ok"
    if profile.user_id is None:
        profile.user_id = user.id
        return "linked"
    return "conflict"


# --- Main ------------------------------------------------------------------


def seed_users() -> None:
    db = SessionLocal()
    try:
        # Quick sanity check: if the Mama Put profile rows aren't there,
        # the operator forgot to run scripts/seed.py. Fail loud.
        mama = db.get(Restaurant, 1)
        if mama is None:
            raise RuntimeError(
                "Restaurant id=1 (Mama Put Kitchen) not found. "
                "Run scripts/seed.py before scripts/seed_users.py."
            )

        print(f"Seeding {len(DEMO_ACCOUNTS)} demo accounts at '{mama.name}'...")
        print()

        rows: list[dict] = []
        for spec in DEMO_ACCOUNTS:
            user, created = _get_or_create_user(
                db,
                email=spec["email"],
                role=spec["role"],
                restaurant_id=spec["restaurant_id"],
            )
            link_status = _ensure_profile_link(
                db,
                user=user,
                profile_kind=spec["profile_kind"],
                profile_id=spec["profile_id"],
            )

            action = "created" if created else "updated"
            rows.append({
                "email": spec["email"],
                "password": DEMO_PASSWORD,
                "role": spec["role"].value,
                "action": action,
                "link": link_status,
            })

        try:
            db.commit()
        except Exception:
            db.rollback()
            raise

        # Print a clean table at the end. The "action" / "link" columns
        # are diagnostic; the frontend tester only needs email+password+role.
        print(f"{'email':<30} {'password':<12} {'role':<10} action   link")
        print("-" * 80)
        for r in rows:
            print(
                f"{r['email']:<30} {r['password']:<12} {r['role']:<10} "
                f"{r['action']:<8} {r['link']}"
            )
        print()
        print("Done. Use any row above to POST /auth/login.")

    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_users()
