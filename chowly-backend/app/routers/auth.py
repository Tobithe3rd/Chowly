"""
Authentication endpoints for the Chowly API.

POST /auth/register — create a User row and the matching
    Customer/Waiter/Chef/Bartender profile row in a single transaction.
    Admin role creates only the User row (no profile table).

POST /auth/login — verify password, return a signed JWT with role and
    restaurant_id embedded as extra_claims so downstream endpoints can
    authorize without an extra DB round-trip.
"""

from __future__ import annotations

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import (
    create_access_token,
    hash_password,
    verify_password,
)
from app.database import get_db
from app.models import (
    Bartender,
    Chef,
    Customer,
    Restaurant,
    Role,
    User,
    Waiter,
)
from app.schemas import (
    LoginRequest,
    RegisterRequest,
    TokenResponse,
    UserRead,
)


router = APIRouter(prefix="/auth", tags=["auth"])


# --- Profile-table dispatch ------------------------------------------------

# Maps a self-registrable role to the ORM class that stores its profile.
# Admin is deliberately absent: admins have no profile table.
PROFILE_MODELS: dict[Role, type] = {
    Role.CUSTOMER: Customer,
    Role.WAITER: Waiter,
    Role.CHEF: Chef,
    Role.BARTENDER: Bartender,
}


def _require(value, *, field: str, role: Role) -> None:
    """Raise HTTP 400 if a required field is missing for the given role."""
    if value is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"`{field}` is required when role is '{role.value}'.",
        )


# --- Register --------------------------------------------------------------


@router.post(
    "/register",
    response_model=UserRead,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new user",
    description=(
        "Creates a User row and (for non-admin roles) the matching "
        "Customer/Waiter/Chef/Bartender profile row in a single "
        "transaction. If either insert fails, both are rolled back. "
        "Restaurant_id is required for all self-registrable roles and "
        "must be null for admin. The matching restaurant must already "
        "exist."
    ),
)
def register(
    payload: RegisterRequest,
    db: Annotated[Session, Depends(get_db)],
) -> UserRead:
    # Per-role validation of restaurant_id.
    # - For customer/waiter/chef/bartender: restaurant_id is required.
    # - For admin: restaurant_id is OPTIONAL. A null restaurant_id
    #   means a global super-admin; a non-null value creates a
    #   tenant-scoped admin who can only manage their own restaurant
    #   (see routers/restaurants.py).
    if payload.role is not Role.ADMIN:
        _require(payload.restaurant_id, field="restaurant_id", role=payload.role)

    if payload.restaurant_id is not None:
        # The restaurant must exist; otherwise the FK insert would fail
        # with an opaque IntegrityError. We check up front for a clean 400.
        exists = db.execute(
            select(Restaurant.id).where(Restaurant.id == payload.restaurant_id)
        ).scalar_one_or_none()
        if exists is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Restaurant with id {payload.restaurant_id} does not "
                    f"exist."
                ),
            )

    # Reject duplicate emails up front (the unique index would also catch
    # this, but a clean 400 is friendlier than a 500 from IntegrityError).
    email_taken = db.execute(
        select(User.id).where(User.email == payload.email)
    ).scalar_one_or_none()
    if email_taken is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A user with that email already exists.",
        )

    # Create the User row. Password is hashed before the INSERT.
    user = User(
        email=payload.email,
        password_hash=hash_password(payload.password),
        role=payload.role,
        restaurant_id=payload.restaurant_id,
    )
    db.add(user)
    # Flush so the User gets an id we can attach the profile to, without
    # committing yet — the transaction is finalized at the end.
    db.flush()

    # For non-admin roles, create the matching profile row in the same
    # transaction. Any failure below rolls back the User row too.
    if payload.role in PROFILE_MODELS:
        _require(payload.name, field="name", role=payload.role)
        _require(payload.phone, field="phone", role=payload.role)

        profile_kwargs: dict = {
            "name": payload.name,
            "phone": payload.phone,
            "restaurant_id": payload.restaurant_id,
            "user_id": user.id,
        }
        # Customer profile has its own email column (used for receipts/
        # marketing distinct from the login email). For other roles we
        # use User.email and skip this field.
        if payload.role is Role.CUSTOMER:
            profile_kwargs["email"] = (
                payload.email_profile or payload.email
            )

        profile = PROFILE_MODELS[payload.role](**profile_kwargs)
        db.add(profile)

    try:
        db.commit()
    except Exception:
        db.rollback()
        raise

    db.refresh(user)
    return UserRead.model_validate(user)


# --- Login -----------------------------------------------------------------


@router.post(
    "/login",
    response_model=TokenResponse,
    summary="Log in and receive a JWT",
    description=(
        "Verifies email + password and returns a signed bearer token. "
        "The token's payload includes the user's role and restaurant_id "
        "(if any) so downstream endpoints can authorize without an "
        "additional database lookup."
    ),
)
def login(
    payload: LoginRequest,
    db: Annotated[Session, Depends(get_db)],
) -> TokenResponse:
    user: Optional[User] = db.execute(
        select(User).where(User.email == payload.email)
    ).scalar_one_or_none()

    # Use a single generic message for "user not found" and "wrong
    # password" so we don't leak which emails are registered.
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    extra_claims = {
        "role": user.role.value,
        "email": user.email,
    }
    if user.restaurant_id is not None:
        extra_claims["rid"] = user.restaurant_id

    # Surface the role-specific profile id as `pid` so downstream
    # endpoints (e.g. PATCH /orders/{id} which requires waiter_id to
    # match the caller's own profile) can be called without a second
    # round-trip. The four profile relations on User are mutually
    # exclusive (uselist=False each) and the matching one is
    # determined by role; chained `or` reads top-down and returns the
    # first non-null. Admin has no profile row and intentionally
    # receives no `pid` claim.
    profile = (
        user.waiter_profile
        or user.chef_profile
        or user.bartender_profile
        or user.customer_profile
    )
    if profile is not None:
        extra_claims["pid"] = profile.id

    token = create_access_token(subject=str(user.id), extra_claims=extra_claims)
    return TokenResponse(access_token=token)
