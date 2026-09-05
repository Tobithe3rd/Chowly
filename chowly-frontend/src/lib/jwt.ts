/**
 * JWT decoding for the Chowly frontend.
 *
 * We only decode — never verify. Verification would require the
 * signing secret, which the client cannot hold safely. Anything
 * security-sensitive (role, restaurant scope) is re-checked by the
 * server on every protected request; the client-side payload is
 * purely a UI hint to avoid an extra round-trip.
 *
 * A malformed or expired token returns null rather than throwing:
 * the API client will surface 401s through React Query, so by the
 * time we get here a bad token means "logged out", not "crash".
 */

import { jwtDecode } from "jwt-decode"

import type { Role } from "@/types"

/**
 * The payload we care about. The backend's `create_access_token`
 * always includes `sub`, `iat`, `exp`, and the extra claims
 * `role` and `email`. `rid` is present only when the user has a
 * `restaurant_id` (i.e. all roles except global admin). `pid` is
 * the role-specific profile id (Customer.id / Waiter.id / Chef.id
 * / Bartender.id) and is present for every role except admin
 * (admins have no profile row). It's the value the frontend sends
 * as `waiter_id` when a waiter claims an order — without it the
 * PATCH handler would have no way to know which waiter profile
 * corresponds to the caller's user id.
 *
 * `exp` is a Unix timestamp in seconds, per RFC 7519.
 */
export type DecodedTokenPayload = {
  sub: string
  role: Role
  email: string
  rid?: number
  pid?: number
  iat: number
  exp: number
}

/**
 * Decode a JWT and return its payload as `DecodedTokenPayload`, or
 * null if the token is malformed, the wrong shape, or already
 * expired.
 *
 * Failure modes that return null:
 *   - base64 decode fails
 *   - JSON parse fails
 *   - any required claim (sub / role / email / iat / exp) is missing
 *   - exp is in the past
 *
 * Anything else is a programmer error and we don't guard against
 * it — if the backend changes its claim shape, the type system
 * will complain at the first call site.
 */
export function decodeToken(token: string): DecodedTokenPayload | null {
  let payload: unknown
  try {
    payload = jwtDecode<unknown>(token)
  } catch {
    return null
  }

  if (!payload || typeof payload !== "object") return null
  const p = payload as Record<string, unknown>

  // Required claims. Treat missing or wrong-type as a bad token so
  // we don't pretend we're authenticated against a token that the
  // server will reject.
  if (typeof p.sub !== "string") return null
  if (typeof p.email !== "string") return null
  if (typeof p.iat !== "number") return null
  if (typeof p.exp !== "number") return null
  if (typeof p.role !== "string") return null

  // exp is Unix seconds. Date.now() is ms.
  if (p.exp <= Math.floor(Date.now() / 1000)) return null

  const out: DecodedTokenPayload = {
    sub: p.sub,
    role: p.role as Role,
    email: p.email,
    iat: p.iat,
    exp: p.exp,
  }
  if (typeof p.rid === "number") {
    out.rid = p.rid
  }
  if (typeof p.pid === "number") {
    out.pid = p.pid
  }
  return out
}
