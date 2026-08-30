"""
FastAPI application entry point for the Chowly backend.

Wires together routers, startup/shutdown hooks, and any cross-cutting
middleware. Routers are kept small and focused — this module exists
mostly for assembly.
"""

from fastapi import FastAPI

from app.routers import auth as auth_router
from app.routers import feedback as feedback_router
from app.routers import orders as orders_router
from app.routers import restaurants as restaurants_router


app = FastAPI(
    title="Chowly API",
    version="0.1.0",
    description="Backend for the Chowly digital dining platform.",
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
