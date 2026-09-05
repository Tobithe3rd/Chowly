"""
FastAPI application entry point for the Chowly backend.

Wires together routers, startup/shutdown hooks, and any cross-cutting
middleware. Routers are kept small and focused — this module exists
mostly for assembly.
"""

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import auth as auth_router
from app.routers import feedback as feedback_router
from app.routers import orders as orders_router
from app.routers import restaurants as restaurants_router


# Read CORS configuration from the environment. CORS_ALLOWED_ORIGINS is a
# comma-separated list of origins the frontend may be served from. In dev
# the Next.js app is typically reached via either http://localhost:3000
# (the most common case) or http://127.0.0.1:3000 (when the user pastes
# a hostfile-style URL). The default fallback covers both so the dev
# experience doesn't depend on which form of the URL the user types. In
# production set CORS_ALLOWED_ORIGINS to the deployed Vercel domain.
# The list is split here (rather than stored as JSON) because env files
# are friendlier with comma lists than nested quotes.
_cors_origins_raw = os.getenv("CORS_ALLOWED_ORIGINS")
if _cors_origins_raw:
    allow_origins = [o.strip() for o in _cors_origins_raw.split(",") if o.strip()]
else:
    allow_origins = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]


app = FastAPI(
    title="Chowly API",
    version="0.1.0",
    description="Backend for the Chowly digital dining platform.",
)

# Auth is a Bearer token in the Authorization header (not a cookie), so
# credentials=False is correct — allowing credentials would force us to
# enumerate origins explicitly and reject the wildcard, which we don't
# need. Methods and headers are wildcarded to keep the dev experience
# friction-free; tighten if you add a production frontend.
app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["health"])
def healthcheck() -> dict:
    """Liveness probe. No DB hit — used by load balancers and uptime checks."""
    return {"status": "ok"}


# Mount routers. The order here only affects URL routing, not execution.
app.include_router(auth_router.router)
app.include_router(restaurants_router.router)
app.include_router(orders_router.router)
app.include_router(feedback_router.router)
