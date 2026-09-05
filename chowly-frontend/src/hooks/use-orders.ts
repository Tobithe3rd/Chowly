"use client"

/**
 * useOrders — fetch the list of orders visible to the current user.
 *
 * GET /orders returns OrderRead[] scoped by the caller's role:
 *   - customer  → their own orders
 *   - staff     → orders at their restaurant (waiter/chef/bartender/
 *     admin all share the same tenant scope on the server)
 *   - admin     → tenant-scoped (same as staff)
 *
 * The optional `status` argument adds `?status=…` to filter to a
 * single OrderStatus value. It's exposed now for forward-compat
 * (the chef/bartender claim list and a future waiter filter UI),
 * not because the current waiter page has a filter — the page
 * calls this hook with no arg and renders everything.
 *
 * The optional `pollMs` argument controls the refetch cadence.
 * Default is 10_000ms (10s) — the operational cadence the
 * waiter/chef/bartender dashboards share. A non-operational
 * caller (e.g. the customer's order history page) passes
 * `pollMs: 0` to opt out of polling and rely on
 * `staleTime: 0` + the React Query default
 * `refetchOnWindowFocus: true` instead, which gives the
 * "give me now on revisit" feel without burning a background
 * timer while the user is reading.
 *
 * Cache strategy:
 *   - staleTime: 0 — every refocus is treated as wanting fresh
 *     data. The waiter dashboard is an operational view, not a
 *     browsing view; "I came back to the tab" means "give me now."
 *   - refetchInterval: pollMs ?? 10_000 — 10s by default, 0 to
 *     disable. Operational dashboards want the live cadence; the
 *     customer history page is "browse" and opts out.
 *   - refetchOnWindowFocus: true (React Query default) — the
 *     canonical "I'm back at my station" signal that complements
 *     the interval, and the *only* freshness signal the polling-
 *     disabled callers have.
 *
 * Query key is `["orders", status ?? "all"]` so different filter
 * values get independent cache entries. The unfiltered case lives
 * under the literal "all" key; introducing a filter later won't
 * bust the unfiltered cache. The `pollMs` knob is intentionally
 * NOT in the key — cache identity is about the resource (orders
 * at the restaurant / customer's own orders), not about the
 * polling cadence. Two pages using the same status filter share
 * the same cache entry; whichever one mounted second gets the
 * other's data until a refetch flips it.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query"

import { ApiError } from "@/lib/api-error"
import { apiGet } from "@/lib/api-client"
import type { OrderRead, OrderStatus } from "@/types"

const DEFAULT_POLL_MS = 10_000

export function useOrders(
  status?: OrderStatus,
  pollMs: number = DEFAULT_POLL_MS,
): UseQueryResult<OrderRead[], ApiError> {
  return useQuery<OrderRead[], ApiError>({
    queryKey: ["orders", status ?? "all"],
    queryFn: () => {
      const qs = status ? `?status=${encodeURIComponent(status)}` : ""
      return apiGet<OrderRead[]>(`/orders${qs}`)
    },
    staleTime: 0,
    refetchInterval: pollMs,
  })
}
