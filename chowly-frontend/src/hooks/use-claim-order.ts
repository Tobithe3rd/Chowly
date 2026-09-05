"use client"

/**
 * useClaimOrder — React Query mutation wrapping PATCH /orders/{order_id}.
 *
 * The hook is a pure API wrapper for the waiter's "claim" action: it
 * takes the order id, the new status, an ETA in minutes, and the
 * caller's waiter profile id, and returns the updated OrderRead. It
 * does NOT know about the auth context, the table, or the dialog —
 * those concerns live with the caller (currently the waiter page's
 * per-row OrderRow). Keeping this hook decoupled means it can be
 * unit-tested in isolation and reused by a future "reassign" flow.
 *
 * The backend's PATCH handler (`app/routers/orders.py:update_order`)
 * enforces a per-field role gate and a self-assignment rule: a
 * waiter may only set `waiter_id` to their own waiter profile id,
 * and the frontend has no way to know that id without it being
 * shipped in the JWT (we add it as the optional `pid` claim — see
 * `lib/jwt.ts` and `routers/auth.py`). The page reads `user.pid`
 * and passes it in as `waiterId`; the hook then forwards it as
 * `waiter_id` on the wire.
 *
 * Why not a generic useUpdateOrder: the next PATCH consumers
 * (status changes, ETA adjustments, line claims) each have their
 * own narrowing rules. A generic hook would have to encode all of
 * them in one input type, which would just be a thin wrapper
 * around apiPatch. Build the next hook when the second consumer
 * actually appears.
 *
 * On the response: the backend returns the full OrderRead, which
 * still includes `menu_item_name` (the earlier `OrderItemRead`
 * join fix) — the table's items summary keeps rendering correctly
 * after a claim.
 *
 * Errors are typed as ApiError so the caller can read `err.detail`
 * (string for HTTPException, array for 422) and decide where to
 * render it. The waiter page renders errors inline in the claim
 * dialog (same pattern as the cart Sheet footer).
 */

import { useMutation, type UseMutationResult } from "@tanstack/react-query"

import { ApiError } from "@/lib/api-error"
import { apiPatch } from "@/lib/api-client"
import type { OrderRead, OrderStatus } from "@/types"

export type ClaimOrderInput = {
  orderId: number
  status: OrderStatus
  estimated_wait_time: number
  waiterId: number
}

export function useClaimOrder(): UseMutationResult<
  OrderRead,
  ApiError,
  ClaimOrderInput
> {
  return useMutation<OrderRead, ApiError, ClaimOrderInput>({
    mutationFn: ({ orderId, status, estimated_wait_time, waiterId }) =>
      apiPatch<OrderRead>(`/orders/${orderId}`, {
        status,
        waiter_id: waiterId,
        estimated_wait_time,
      }),
  })
}
