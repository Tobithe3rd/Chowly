"use client"

/**
 * useMarkServed — React Query mutation wrapping
 * PATCH /orders/{order_id} with body `{ status: "Served" }`.
 *
 * This is the waiter-side counterpart to useMarkLineReady
 * (per-line, chef/bartender) and useResolveComplaint
 * (per-complaint, admin). All three hooks share the same shape:
 * a hard-coded body, no client-side branching, and a 409-aware
 * caller that renders the backend's message verbatim.
 *
 * The body is hard-coded to `{ status: "Served" }` because the
 * transition set is locked by the scope of this step — the only
 * legal target value is Served, and a future "un-serve" would
 * be a separate hook (mirroring the reopen-complaint decision).
 * The backend enforces:
 *   - 409 if the order's all_lines_ready is false (waiter only;
 *     admin can override, but the hook is called from the waiter
 *     page and the override path is via a different surface).
 *   - 409 if the order is already Served (idempotency + terminal-
 *     state rule: Served is the end of the lifecycle, same as
 *     ComplaintStatus.Resolved and OrderItemStatus.Ready).
 *
 * The hook does NOT check the caller's role — the backend's
 * per-field role gate in `routers/orders.py:update_order` admits
 * only `waiter` and `admin` for the `status` field, so the
 * customer/chef/bartender surfaces that import this hook would
 * be rejected with 403. (Today the only call site is the waiter
 * page's `MarkServedButton`.)
 *
 * On success the caller invalidates the orders query so the
 * next 10s poll (or an explicit refetch) shows the new status.
 * The mutation result is the full OrderRead; the hook returns
 * it but the caller doesn't need to use it (the cache is the
 * source of truth, same pattern as useClaimOrder).
 *
 * Errors are typed as ApiError so the caller can read
 * `err.detail` directly and render it via the shared
 * describeError helper. The waiter dialog renders the 409
 * message inline; the message is user-readable (e.g.
 * "Order 4 cannot be marked Served: not all lines are Ready.")
 * and surfaces the operational pre-condition without a client-
 * side translation.
 */

import { useMutation, type UseMutationResult } from "@tanstack/react-query"

import { ApiError } from "@/lib/api-error"
import { apiPatch } from "@/lib/api-client"
import type { OrderRead } from "@/types"

export type MarkServedInput = {
  orderId: number
}

export function useMarkServed(): UseMutationResult<
  OrderRead,
  ApiError,
  MarkServedInput
> {
  return useMutation<OrderRead, ApiError, MarkServedInput>({
    mutationFn: ({ orderId }) =>
      apiPatch<OrderRead>(`/orders/${orderId}`, { status: "Served" }),
  })
}
