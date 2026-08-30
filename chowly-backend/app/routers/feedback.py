"""
Feedback endpoints for the Chowly API.

POST /orders/{order_id}/complaint   — customer files a complaint (once)
GET  /orders/{order_id}/complaint   — owning customer reads the complaint
POST /orders/{order_id}/rating     — customer rates the order (once)
GET  /orders/{order_id}/rating      — owning customer reads the rating

Rules (shared by all four):
    - The caller must be authenticated.
    - The order must exist (404 otherwise).
    - The caller must be the order's own customer (403 otherwise).
    - On POST: at most one complaint and one rating per order. The DB
      unique constraint on `complaints.order_id` / `ratings.order_id`
      would also enforce this, but the raw IntegrityError is a 500 — we
      pre-check and return 409 instead.
    - On GET: 404 if the feedback row doesn't exist (vs. 200 with null
      fields), matching REST norms.

Non-customers are blocked for now. When staff read paths are opened
up (alongside the order PATCH), this router can be relaxed.
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
    RatingCreate,
    RatingRead,
)


router = APIRouter(prefix="/orders", tags=["feedback"])


# --- Helpers ---------------------------------------------------------------


def _require_order_owning_customer(
    db: Session, order_id: int, current_user: User
) -> Order:
    """Fetch the order and verify the caller is its customer.

    Existence first (404 if the order is missing), then auth (403 if the
    caller isn't the order's customer, or isn't a customer at all).
    Existence-before-auth matches the rule used in
    routers/restaurants.py so we don't leak whether orders exist to
    other tenants.
    """
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Order with id {order_id} does not exist.",
        )

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
    _require_order_owning_customer(db, order_id, current_user)
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
    summary="Read the complaint on an order (owning customer only)",
    description=(
        "Returns the Complaint for the order. 404 if no complaint "
        "has been filed yet (rather than 200 with nulls). 403 if the "
        "caller isn't the order's customer."
    ),
)
def get_complaint(
    order_id: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ComplaintRead:
    _require_order_owning_customer(db, order_id, current_user)

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
    _require_order_owning_customer(db, order_id, current_user)
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
        "yet. 403 if the caller isn't the order's customer."
    ),
)
def get_rating(
    order_id: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> RatingRead:
    _require_order_owning_customer(db, order_id, current_user)

    rating = db.execute(
        select(Rating).where(Rating.order_id == order_id)
    ).scalar_one_or_none()
    if rating is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Order {order_id} has no rating on file.",
        )
    return RatingRead.model_validate(rating)
