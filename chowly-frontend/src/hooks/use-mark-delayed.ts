"use client"

/**
 * useMarkDelayed — React Query mutation wrapping
 * PATCH /orders/{order_id} with body
 * `{ status: "Delayed" }` or `{ status: "In Preparation" }`.
 *
 * This is the waiter-side counterpart to useMarkServed (the
 * terminal action). The hook handles BOTH directions of the
 * Delayed ↔ In Preparation transition because the backend's
 * per-field role gate (see routers/orders.py:update_order)
 * accepts either target value with no extra pre-condition —
 * the terminal-state rule only fires for Served, not Delayed.
 * The gate allows:
 *
 *   - In Preparation → Delayed  ✅ (the "flag a long order" path)
 *   - Delayed → In Preparation  ✅ (the "kitchen caught up"
 *                                 reversal — the UI surfaces
 *                                 it via the same button, just
 *                                 relabeled)
 *
 * The body is parameterized rather than hard-coded because the
 * v1 scope explicitly includes the reversal (per the discovery
 * report's "smallest-scope UI" section + user approval). The
 * call site picks the target value based on the order's current
 * status; the hook itself is value-agnostic. This is one
 * deviation from useMarkServed (which hard-codes "Served" because
 * the transition set is locked to one value today); the
 * reasoning is that useMarkServed's body is "one value, no
 * future forking planned," whereas useMarkDelayed's body is
 * "two values, both legal today, both surfaces in the UI."
 *
 * The hook does NOT check the caller's role — the backend's
 * per-field role gate in routers/orders.py admits only `waiter`
 * and `admin` for the `status` field, so the customer/chef/
 * bartender surfaces that import this hook would be rejected
 * with 403. Today the only call site is the waiter page's
 * MarkDelayedButton (chef/bartender pages don't have order-
 * level actions; the customer never touches status).
 *
 * Known gaps the hook does NOT defend against (matching the
 * "Confirmed decisions, don't re-litigate" list):
 *   - Idempotent re-mark (Delayed → Delayed, In Preparation
 *     → In Preparation) is a silent no-op at the router; no
 *     409 is raised. The dialog doesn't pre-check the
 *     target value against the current status. Harmless in
 *     practice (the row already shows the new state, so the
 *     no-op PATCH doesn't surface to the user), but a backend
 *     follow-up could add a state-machine 409 for symmetry
 *     with the Served rule.
 *   - Cancelled has the same "gate permits it, no UI surfaces
 *     it" gap; out of scope here.
 *
 * On success the caller invalidates the orders query so the
 * next 10s poll (or an explicit refetch) shows the new status.
 * The mutation result is the full OrderRead; the hook returns
 * it but the caller doesn't need to use it (the cache is the
 * source of truth, same pattern as useClaimOrder and
 * useMarkServed).
 *
 * Errors are typed as ApiError so the caller can read
 * `err.detail` directly and render it via the shared
 * describeError helper. The waiter dialog renders the 409
 * message inline; the message is user-readable (e.g.
 * "Order 4 cannot be marked Served: not all lines are Ready."
 * — note the Served-specific message is a different gate; the
 * Delayed paths don't have a pre-condition error of their own
 * today, so the inline error slot is mostly defense-in-depth
 * for the 500 / network paths).
 */

import { useMutation, type UseMutationResult } from "@tanstack/react-query"

import { ApiError } from "@/lib/api-error"
import { apiPatch } from "@/lib/api-client"
import type { OrderRead } from "@/types"

export type MarkDelayedInput = {
  orderId: number
  /**
   * The target status. The call site picks this based on the
   * order's current status:
   *   - status === "In Preparation" → target = "Delayed"
   *     (the "flag a long order" action)
   *   - status === "Delayed"         → target = "In Preparation"
   *     (the reversal; UI label is "Mark in preparation")
   * Both are accepted by the backend. No other targets are
   * legal via this hook — Served has its own hook
   * (useMarkServed), Cancelled has no UI surface.
   */
  target: "Delayed" | "In Preparation"
}

export function useMarkDelayed(): UseMutationResult<
  OrderRead,
  ApiError,
  MarkDelayedInput
> {
  return useMutation<OrderRead, ApiError, MarkDelayedInput>({
    mutationFn: ({ orderId, target }) =>
      apiPatch<OrderRead>(`/orders/${orderId}`, { status: target }),
  })
}
