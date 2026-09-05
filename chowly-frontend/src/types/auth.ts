/**
 * Auth types — mirror chowly-backend/app/schemas.py auth section.
 *
 * Enum values come from app/models.py Role enum:
 *   customer, waiter, chef, bartender, admin
 */

/** Mirrors backend `Role` enum. */
export type Role = "customer" | "waiter" | "chef" | "bartender" | "admin"

/**
 * Request body for POST /auth/login.
 * Mirrors backend `LoginRequest` (EmailStr + password 1-128).
 */
export interface LoginRequest {
  email: string
  password: string
}

/**
 * Response body for POST /auth/login.
 * Mirrors backend `TokenResponse`:
 *   access_token: str
 *   token_type: Literal["bearer"] = "bearer"
 *
 * `token_type` is typed as the literal union (the default `"bearer"`
 * is enforced server-side, so the response always carries it).
 */
export interface TokenResponse {
  access_token: string
  token_type: "bearer"
}

/**
 * Request body for POST /auth/register.
 * Mirrors backend `RegisterRequest`.
 *
 * `restaurant_id` is required for customer/waiter/chef/bartender and
 * null for admin. Pydantic models it as Optional[int] = None because
 * the router does the per-role enforcement — so on the wire it can
 * be present-and-null, present-and-an-int, or absent.
 *
 * `name` / `phone` / `email_profile` are required for the
 * self-registrable roles; the router enforces that, so the schema
 * itself is permissive.
 */
export interface RegisterRequest {
  email: string
  password: string
  role: Role
  restaurant_id?: number | null
  name?: string | null
  phone?: string | null
  email_profile?: string | null
}

/**
 * Response body for POST /auth/register and any future "current user"
 * endpoint. Mirrors backend `UserRead`. `password_hash` is never
 * exposed.
 */
export interface UserRead {
  id: number
  email: string
  role: Role
  restaurant_id: number | null
  created_at: string // ISO 8601 datetime
}
