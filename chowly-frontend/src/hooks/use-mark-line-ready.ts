"use client"

/**
 * useMarkLineReady — React Query mutation wrapping
 * PATCH /orders/{order_id}/items/{menu_item_id}.
 *
 * The hook is the chef/bartender counterpart to useClaimOrderItem:
 * a single verb (mark Ready) performed on a single line. The body
 * is hard-coded to `{ status: "Ready" }` because the scope
 * intentionally locks the transition set; a future "unready" would
 * add a second hook rather than widening this one (mirrors the
 * use-resolve-complaint shape).
 *
 * The backend returns the updated OrderItemRead (via
 * OrderItemClaimResponse on the wire — same shape, separate name).
 * On success the caller invalidates the orders query so the next
 * 10s poll shows the new status and the all_lines_ready aggregate
 * is fresh.
 *
 * Errors are typed as ApiError so the caller can read `err.detail`
 * directly and render it via the shared describeError helper. The
 * chef/bartender dashboard renders errors inline in the per-line
 * mark-ready dialog (same pattern as the claim dialog).
 *
 * Role note: the hook does NOT check the caller's role — the
 * backend enforces chef/bartender/admin via the URL parameters and
 * the Pydantic schema. The 403/400/409 messages are user-readable
 * and are surfaced through the same describeError path as
 * useClaimOrderItem.
 */

import { useMutation, type UseMutationResult } from "@tanstack/react-query"

import { ApiError } from "@/lib/api-error"
import { apiPatch } from "@/lib/api-client"
import type { OrderItemClaimResponse } from "@/types"

export type MarkLineReadyInput = {
  orderId: number
  menuItemId: number
}

export function useMarkLineReady(): UseMutationResult<
  OrderItemClaimResponse,
  ApiError,
  MarkLineReadyInput
> {
  return useMutation<OrderItemClaimResponse, ApiError, MarkLineReadyInput>({
    mutationFn: ({ orderId, menuItemId }) =>
      apiPatch<OrderItemClaimResponse>(
        `/orders/${orderId}/items/${menuItemId}`,
        { status: "Ready" },
      ),
  })
}
