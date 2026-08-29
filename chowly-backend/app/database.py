"""
Database configuration for Chowly backend.

Sets up the SQLAlchemy engine, session factory, declarative Base, and a
FastAPI dependency that yields a database session per request.

Neon-hosted PostgreSQL connections can go stale when idle, so the engine
uses pool_pre_ping=True to validate connections before use.
"""

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# Load environment variables from a .env file in the project root
load_dotenv()

import os

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL is not set. Copy .env.example to .env and provide "
        "your Neon PostgreSQL connection string."
    )

# pool_pre_ping=True issues a lightweight SELECT 1 before each query so
# stale Neon connections are transparently recycled instead of failing.
engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)

Base = declarative_base()


def get_db():
    """
    FastAPI dependency that yields a SQLAlchemy session and ensures it is
    closed after the request finishes, even if an exception is raised.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()