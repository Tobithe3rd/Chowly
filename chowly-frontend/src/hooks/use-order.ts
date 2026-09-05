"use client"

/**
 * useOrder — fetch a single order by id.
 *
 * GET /orders/{id} returns OrderRead (status, ETA, total, items,
 * waiter_id, all_lines_ready, per-line chef_id/bartender_id/status).
 * Only the order's owning customer may view it — other customers and
 * staff currently get 403 from the backend. A 404 lands if the order
 * doesn't exist; 401 means the token is stale (the API client wipes
 * it; the page's RouteGuard will then bounce the user to /login).
 *
 * The `enabled` gate is the only reason the hook takes `orderId |
 * undefined`: the confirmation page reads the id off `useParams()`,
 * which is always defined in App Router but typed as a string-keyed
 * record. We parse it to a number, and if the URL is malformed
 * (e.g. someone hand-typed /customer/orders/abc) we pass NaN and
 * `enabled: false` short-circuits the request. The page can then
 * render a "this order doesn't exist" state without making a doomed
 * network call.
 *
 * Polling: this hook refetches every 25s while the order is in a
 * non-terminal state. The cadence is half the staff list cadence
 * (use-orders.ts uses 10s) because the customer is on a phone, not
 * a workstation — battery and bandwidth cost more on this side. The
 * 25s is also long enough that a fresh claim or line-ready flip
 * shows up within a small number of "tick" intervals.
 *
 * Polling pauses when the order reaches a terminal state (Served
 * or Cancelled). There's no signal to wait for: a Served order
 * can't transition further (the backend's `update_order` enforces a
 * 409 on any status change out of Served — see
 * routers/orders.py), and a Cancelled order is the same. The hook
 * uses React Query's `refetchInterval: (query) => …` callback so
 * the decision is made on every tick, not just on first mount —
 * the moment the order flips to Served, the next tick is the last.
 *
 * Errors are typed as ApiError so the page can render
 * `err.detail` (the 403 / 404 message) directly.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query"

import { ApiError } from "@/lib/api-error"
import { apiGet } from "@/lib/api-client"
import type { OrderRead } from "@/types"

const POLL_INTERVAL_MS = 25_000

function isTerminalOrder(order: OrderRead | undefined): boolean {
  if (!order) return false
  // A Served or Cancelled order can't transition further. Pause
  // polling on either. For Served, the backend's 409 on
  // status-out-of-Served means there's nothing new to surface;
  // for Cancelled, same — but a 409 in production could
  // theoretically come from a misbehaving PATCH client, not from
  // the order itself changing, so the 25s pause is a heuristic
  // for the well-behaved case rather than a strict gate.
  return order.status === "Served" || order.status === "Cancelled"
}

export function useOrder(
  orderId: number | undefined
): UseQueryResult<OrderRead, ApiError> {
  return useQuery<OrderRead, ApiError>({
    queryKey: ["order", orderId],
    queryFn: () => apiGet<OrderRead>(`/orders/${orderId}`),
    enabled: typeof orderId === "number" && Number.isFinite(orderId),
    // Callback form: React Query re-evaluates on every interval
    // tick, so when `query.state.data.status` flips to Served or
    // Cancelled, the very next tick returns `false` and polling
    // stops. While the order is still moving, the tick returns
    // 25_000 and we keep polling.
    refetchInterval: (query) =>
      isTerminalOrder(query.state.data) ? false : POLL_INTERVAL_MS,
  })
}
