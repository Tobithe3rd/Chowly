"""
Authentication helpers for the Chowly backend.

Password hashing/verification via passlib (bcrypt), JWT creation and
decoding via python-jose, and a get_current_user FastAPI dependency
that loads the User row from a bearer token.

The signing secret is read from JWT_SECRET_KEY in the environment (loaded
from .env by app.database). The same secret must be used for create and
decode — never commit the real secret, only the empty .env.example.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Annotated, Optional

from dotenv import load_dotenv
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

# Load .env so JWT_SECRET_KEY is available at import time.
load_dotenv()

from app.database import get_db  # noqa: E402
from app.models import User  # noqa: E402


# --- Configuration ---------------------------------------------------------


JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY")
if not JWT_SECRET_KEY:
    raise RuntimeError(
        "JWT_SECRET_KEY is not set. Copy .env.example to .env and provide "
        "a strong secret (e.g. `python -c 'import secrets; print(secrets."
        "token_hex(32))'`)."
    )

# HS256 is sufficient for first-party APIs; rotate to RS256 if/when
# multiple services need to verify tokens without sharing a secret.
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 1 day

# bcrypt with a sensible default cost. Passlib handles salt + iteration
# count automatically.
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# tokenUrl points at the login route we'll register in the router.
# FastAPI's OAuth2PasswordBearer uses this for the auto-generated
# Swagger "Authorize" flow.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


# --- Password hashing ------------------------------------------------------


def hash_password(plain: str) -> str:
    """Return a bcrypt hash for the given plaintext password."""
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    """Return True if `plain` matches the stored bcrypt `hashed` value."""
    return pwd_context.verify(plain, hashed)


# --- JWT creation / decoding ----------------------------------------------


def create_access_token(
    *,
    subject: str,
    extra_claims: Optional[dict] = None,
    expires_minutes: int = ACCESS_TOKEN_EXPIRE_MINUTES,
) -> str:
    """Issue a signed JWT for the given subject (typically the user id).

    `extra_claims` is merged into the payload — useful for role, email,
    or restaurant_id so endpoints can authorize without an extra DB hit.
    """
    now = datetime.now(tz=timezone.utc)
    payload = {
        "sub": str(subject),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=expires_minutes)).timestamp()),
    }
    if extra_claims:
        payload.update(extra_claims)
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> dict:
    """Decode and validate a JWT, raising HTTP 401 on any failure."""
    try:
        return jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired token: {exc}",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


# --- FastAPI dependency ----------------------------------------------------


def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    """Decode the bearer token from the Authorization header and load
    the corresponding User row. Raises 401 on missing/invalid token
    or on a token whose subject no longer maps to a user (e.g. account
    was deleted while the token was still in flight)."""
    payload = decode_access_token(token)
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing 'sub' claim.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        user_id = int(sub)
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token 'sub' claim is not a valid user id.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User no longer exists.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user
