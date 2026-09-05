"""
Feedback endpoints for the Chowly API.

POST  /orders/{order_id}/complaint   — customer files a complaint (once)
GET   /orders/{order_id}/complaint   — owning customer OR staff/admin
PATCH /orders/{order_id}/complaint   — admin only; Open -> Resolved
POST  /orders/{order_id}/rating      — customer rates the order (once)
GET   /orders/{order_id}/rating      — owning customer ONLY (rating is
                                        private to the customer)

Rules (shared by all five):
    - The caller must be authenticated.
    - The order must exist (404 otherwise).
    - The caller must pass the per-endpoint access rule (see
      _require_order_access below).
    - On POST: at most one complaint and one rating per order. The DB
      unique constraint on `complaints.order_id` / `ratings.order_id`
      would also enforce this, but the raw IntegrityError is a 500 — we
      pre-check and return 409 instead.
    - On GET: 404 if the feedback row doesn't exist (vs. 200 with null
      fields), matching REST norms.

The staff/admin read access on GET /complaint is the relaxation added
when the order PATCH (and the staff order-detail page) opened up.
Ratings stay customer-only — a 1-5 star score is the customer's private
feedback and there's no operational reason for staff to see it.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import (
    Complaint,
    ComplaintStatus,
    Customer,
    Order,
    Rating,
    Role,
    User,
)
from app.schemas import (
    ComplaintCreate,
    ComplaintRead,
    ComplaintUpdate,
    RatingCreate,
    RatingRead,
)


router = APIRouter(prefix="/orders", tags=["feedback"])


# --- Helpers ---------------------------------------------------------------


def _require_order_access(
    db: Session,
    order_id: int,
    current_user: User,
    *,
    require_owning_customer: bool,
) -> Order:
    """Fetch the order and enforce the role-aware access rule.

    Existence first (404 if the order is missing), then auth. Existence-
    before-auth matches the rule used in routers/restaurants.py so we
    don't leak whether orders exist to other tenants.

    require_owning_customer=True is the strict rule: only the order's
    owning customer may proceed. Used for POSTs (file_complaint,
    file_rating) and for GET /rating where a 1-5 star score is private
    to the customer.

    require_owning_customer=False is the relaxed read rule: the owning
    customer OR any staff/admin at the same restaurant may proceed.
    Used for GET /complaint where staff visibility is operationally
    useful ("this customer already flagged an issue"). Customers still
    must be the order's owner; other customers get 403.
    """
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Order with id {order_id} does not exist.",
        )

    if require_owning_customer:
        if current_user.role is not Role.CUSTOMER:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only customers can file or view feedback.",
            )
        if current_user.customer_profile is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Customer profile not found for this user.",
            )
        if order.customer_id != current_user.customer_profile.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only file or view feedback on your own orders.",
            )
        return order

    # Relaxed: customer must own the order; staff/admin must be at the
    # same restaurant. Mirrors the get_order branch at orders.py:369-388
    # so a staff user can read an order AND its complaint with the
    # same rule.
    if current_user.role is Role.CUSTOMER:
        if current_user.customer_profile is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Customer profile not found for this user.",
            )
        if order.customer_id != current_user.customer_profile.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only view feedback on your own orders.",
            )
        return order

    # Staff / admin — tenant-scoped to the order's restaurant.
    if current_user.restaurant_id != order.restaurant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"{current_user.role.value.capitalize()} for "
                f"restaurant {current_user.restaurant_id} cannot "
                f"view feedback for restaurant {order.restaurant_id}."
            ),
        )
    return order


# --- Complaint -------------------------------------------------------------


@router.post(
    "/{order_id}/complaint",
    response_model=ComplaintRead,
    status_code=status.HTTP_201_CREATED,
    summary="File a complaint on an order (owning customer only)",
    description=(
        "Creates a Complaint row tied to the order. At most one "
        "complaint per order — a second attempt returns 409. The "
        "complaint starts in 'Open' status."
    ),
)
def file_complaint(
    order_id: int,
    payload: ComplaintCreate,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ComplaintRead:
    _require_order_access(db, order_id, current_user, require_owning_customer=True)
    customer = current_user.customer_profile

    # Pre-check the unique constraint so the failure is a clean 409
    # rather than a 500 from IntegrityError on the insert.
    existing = db.execute(
        select(Complaint.id).where(Complaint.order_id == order_id)
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Order {order_id} already has a complaint "
                f"(id {existing})."
            ),
        )

    complaint = Complaint(
        complaint_text=payload.complaint_text,
        status=ComplaintStatus.OPEN,
        order_id=order_id,
        customer_id=customer.id,
    )
    db.add(complaint)
    try:
        db.commit()
    except IntegrityError as exc:
        # Race-condition fallback: two requests at once can both pass
        # the pre-check and only one INSERT will succeed. The session
        # is poisoned after IntegrityError — we must rollback before
        # raising. We also check the constraint name so that an
        # unrelated IntegrityError (e.g. a future FK violation) is
        # not misreported as a duplicate-complaint conflict.
        db.rollback()
        if "complaints_order_id_key" in str(exc.orig):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Order {order_id} already has a complaint.",
            )
        raise
    db.refresh(complaint)
    return ComplaintRead.model_validate(complaint)


@router.get(
    "/{order_id}/complaint",
    response_model=ComplaintRead,
    summary="Read the complaint on an order (owning customer, or staff at the order's restaurant)",
    description=(
        "Returns the Complaint for the order. The owning customer or "
        "any staff/admin at the same restaurant may read. 404 if no "
        "complaint has been filed yet (rather than 200 with nulls). "
        "403 for customers who don't own the order, or for staff/admin "
        "at a different restaurant."
    ),
)
def get_complaint(
    order_id: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ComplaintRead:
    _require_order_access(db, order_id, current_user, require_owning_customer=False)

    complaint = db.execute(
        select(Complaint).where(Complaint.order_id == order_id)
    ).scalar_one_or_none()
    if complaint is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Order {order_id} has no complaint on file.",
        )
    return ComplaintRead.model_validate(complaint)


# --- Rating ----------------------------------------------------------------


@router.post(
    "/{order_id}/rating",
    response_model=RatingRead,
    status_code=status.HTTP_201_CREATED,
    summary="Rate an order (owning customer only)",
    description=(
        "Creates a Rating row tied to the order. rating_value is 1-5. "
        "At most one rating per order — a second attempt returns 409."
    ),
)
def file_rating(
    order_id: int,
    payload: RatingCreate,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> RatingRead:
    _require_order_access(db, order_id, current_user, require_owning_customer=True)
    customer = current_user.customer_profile

    existing = db.execute(
        select(Rating.id).where(Rating.order_id == order_id)
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Order {order_id} already has a rating (id {existing})."
            ),
        )

    rating = Rating(
        rating_value=payload.rating_value,
        comment=payload.comment,
        order_id=order_id,
        customer_id=customer.id,
    )
    db.add(rating)
    try:
        db.commit()
    except IntegrityError as exc:
        # Same race-condition handling as file_complaint. Match on
        # the constraint name so a different IntegrityError (e.g. a
        # future FK) is not misreported as a duplicate-rating 409.
        db.rollback()
        if "ratings_order_id_key" in str(exc.orig):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Order {order_id} already has a rating.",
            )
        raise
    db.refresh(rating)
    return RatingRead.model_validate(rating)


@router.get(
    "/{order_id}/rating",
    response_model=RatingRead,
    summary="Read the rating on an order (owning customer only)",
    description=(
        "Returns the Rating for the order. 404 if no rating exists "
        "yet. 403 if the caller isn't the order's customer. Rating "
        "stays customer-only — a 1-5 star score is the customer's "
        "private feedback and there's no operational reason for staff "
        "to see it."
    ),
)
def get_rating(
    order_id: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> RatingRead:
    _require_order_access(db, order_id, current_user, require_owning_customer=True)

    rating = db.execute(
        select(Rating).where(Rating.order_id == order_id)
    ).scalar_one_or_none()
    if rating is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Order {order_id} has no rating on file.",
        )
    return RatingRead.model_validate(rating)


# --- Complaint PATCH (admin only) -----------------------------------------


@router.patch(
    "/{order_id}/complaint",
    response_model=ComplaintRead,
    summary="Update a complaint's status (admin only)",
    description=(
        "Currently supports only the Open -> Resolved transition. "
        "Admin role required, scoped to the order's restaurant. "
        "Returns 403 for non-admin roles, 409 for any other status "
        "value or for an attempt to move Resolved back to Open. The "
        "only field the admin may send is `status`; any other field "
        "is rejected with 403 (per-field role gate, same shape as "
        "PATCH /orders/{id})."
    ),
)
def update_complaint(
    order_id: int,
    payload: ComplaintUpdate,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ComplaintRead:
    # Existence first (404 if missing) — same ordering rule as
    # update_menu_item so a missing-order request doesn't leak as
    # a 403 "you can't resolve this."
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Order with id {order_id} does not exist.",
        )

    # Reject customers outright. The per-field role gate below would
    # also block them (no allowed fields for the customer role), but a
    # flat 403 is clearer than "you sent no allowed fields" when every
    # field is forbidden.
    if current_user.role is Role.CUSTOMER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Customers cannot resolve complaints.",
        )

    # Admin-only. Floor staff (waiter/chef/bartender) can read but
    # not resolve — resolution authority is the tenant manager,
    # mirroring the admin-only PATCH on menu items
    # (routers/restaurants.py:223).
    if current_user.role is not Role.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin role required to resolve complaints.",
        )

    # Tenant scope: admins can only resolve complaints at their own
    # restaurant.
    if current_user.restaurant_id != order.restaurant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"Admin for restaurant {current_user.restaurant_id} "
                f"cannot resolve complaints for restaurant "
                f"{order.restaurant_id}."
            ),
        )

    complaint = db.execute(
        select(Complaint).where(Complaint.order_id == order_id)
    ).scalar_one_or_none()
    if complaint is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Order {order_id} has no complaint on file.",
        )

    # Per-field role gate. The Pydantic v2 `model_fields_set`
    # exposes exactly which fields the caller sent. For admin, the
    # only allowed field is `status`. Sending any other field is
    # a 403 (mirrors orders.py:478-485).
    sent_fields = payload.model_fields_set
    allowed = frozenset({"status"})
    forbidden = sent_fields - allowed
    if forbidden:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"Field(s) {sorted(forbidden)} are not allowed for "
                f"role '{current_user.role.value}'."
            ),
        )

    # State machine: Open -> Resolved is the only valid transition.
    # Anything else (Resolved -> Resolved no-op, Resolved -> Open,
    # Open -> Open no-op, or any other value) is rejected with 409 so
    # the caller knows the action was a no-op or invalid direction.
    if complaint.status == payload.status:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Complaint is already {payload.status.value}.",
        )
    if (
        complaint.status is ComplaintStatus.RESOLVED
        and payload.status is ComplaintStatus.OPEN
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot reopen a resolved complaint.",
        )
    if payload.status is not ComplaintStatus.RESOLVED:
        # Defensive: Pydantic's enum would already reject any
        # non-Open/non-Resolved value with 422 at the body layer,
        # but the router-level check keeps the error message
        # specific to the state machine.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Invalid status transition: "
                f"{complaint.status.value} -> {payload.status.value}."
            ),
        )

    complaint.status = payload.status
    db.commit()
    db.refresh(complaint)
    return ComplaintRead.model_validate(complaint)
