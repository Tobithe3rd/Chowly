"use client"

/**
 * useClaimOrderItem — React Query mutation wrapping
 * POST /orders/{order_id}/items/{menu_item_id}/claim.
 *
 * The hook is the chef/bartender counterpart to useClaimOrder:
 * narrow to the single verb the kitchen/bar role performs, with
 * no knowledge of which role called it (the backend enforces that
 * — a chef on a Drink line gets 400, a bartender on a Food line
 * gets the symmetric message). The caller passes orderId and
 * menuItemId; the hook returns the updated OrderItemClaimResponse.
 *
 * The backend already includes `item_type` and `menu_item_name`
 * on the response (they're joined from the eager-loaded MenuItem
 * relationship at claim time — see routers/orders.py:claim_order_item).
 * The frontend uses `item_type` to display the right "Food" or
 * "Drink" treatment without a second round-trip.
 *
 * Errors are typed as ApiError so the caller can read `err.detail`
 * (string for HTTPException, array for 422) and decide where to
 * render it. The chef/bartender dashboard renders errors inline in
 * the per-line claim dialog (same pattern as the cart Sheet and
 * the waiter page's claim dialog).
 *
 * Why not a generic "line mutation" hook: the only other line
 * verb that might appear is "unclaim" or "mark prepared," and
 * neither exists on the backend yet. Build the next hook when
 * the second consumer appears — same discipline as
 * useClaimOrder/usePlaceOrder.
 */

import { useMutation, type UseMutationResult } from "@tanstack/react-query"

import { ApiError } from "@/lib/api-error"
import { apiPost } from "@/lib/api-client"
import type { OrderItemClaimResponse } from "@/types"

export type ClaimOrderItemInput = {
  orderId: number
  menuItemId: number
}

export function useClaimOrderItem(): UseMutationResult<
  OrderItemClaimResponse,
  ApiError,
  ClaimOrderItemInput
> {
  return useMutation<OrderItemClaimResponse, ApiError, ClaimOrderItemInput>({
    mutationFn: ({ orderId, menuItemId }) =>
      apiPost<OrderItemClaimResponse>(
        `/orders/${orderId}/items/${menuItemId}/claim`,
      ),
  })
}
