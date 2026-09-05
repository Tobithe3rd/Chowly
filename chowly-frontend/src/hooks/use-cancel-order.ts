"use client"

/**
 * useCancelOrder — React Query mutation wrapping
 * PATCH /orders/{id} with { status: "Cancelled" }.
 *
 * The customer-cancel path is intentionally narrow: the body is
 * hard-coded to `{ status: "Cancelled" }` because the backend
 * rejects any other value from a customer role (the per-field
 * gate admits only `status`, and the customer-cancel block
 * narrows the value to Cancelled only — see
 * routers/orders.py). The hook does NOT take a status argument;
 * callers that want to flip the order to anything else (e.g.
 * a future staff-cancel) would use a different hook, not
 * widen this one.
 *
 * On success, the caller invalidates two query keys:
 *   - ["order", orderId] so the customer order detail page
 *     re-fetches and the OrderView's Cancelled short-circuit
 *     takes over from the live branch (rendering the
 *     rose-tinted CancelledCard on the next render).
 *   - ["orders", "all"] so the customer's order list page
 *     sees the new status on the next visit.
 * The hook itself does NOT invalidate — invalidation lives at
 * the call site (the dialog's onSuccess), same pattern as
 * useResolveComplaint, so the caller can choose the keys.
 *
 * Errors are typed as ApiError so the dialog can read
 * `err.detail` directly. The backend returns distinct
 * messages for distinct failure modes:
 *   - 409 "the 10-minute window has passed" — timer expired.
 *   - 409 "Order N is already Cancelled." — double-click.
 *   - 403 "You can only cancel your own orders." — wrong
 *     customer (defensive; the Cancel button is only shown
 *     to the order's owning customer).
 *   - 403 "Field(s) ... are not allowed" — body shape
 *     mismatch (defensive; the dialog always sends
 *     { status: "Cancelled" }).
 * The dialog renders all of them verbatim via the shared
 * describeError helper.
 */

import { useMutation, type UseMutationResult } from "@tanstack/react-query"

import { ApiError } from "@/lib/api-error"
import { apiPatch } from "@/lib/api-client"
import type { OrderRead } from "@/types"

export type CancelOrderInput = {
  orderId: number
}

export function useCancelOrder(): UseMutationResult<
  OrderRead,
  ApiError,
  CancelOrderInput
> {
  return useMutation<OrderRead, ApiError, CancelOrderInput>({
    mutationFn: ({ orderId }) =>
      apiPatch<OrderRead>(`/orders/${orderId}`, {
        status: "Cancelled",
      }),
  })
}
