"use client"

/**
 * useResolveComplaint — React Query mutation wrapping
 * PATCH /orders/{id}/complaint.
 *
 * The hook is a pure API wrapper: it takes an orderId and posts
 * the only legal transition today — Open -> Resolved. The body
 * is hard-coded to { status: "Resolved" } because the scope
 * intentionally locks the transition set; a future "reopen" would
 * add a second hook rather than widening this one.
 *
 * The hook does NOT special-case 409. The backend returns 409 on
 * (a) idempotency ("already Resolved"), (b) reopen attempts
 * ("Cannot reopen a resolved complaint."), or (c) any other
 * value. The admin dialog renders all three via the shared
 * describeError helper — same per-action specificity as
 * useClaimOrder / useFileComplaint. The 409 messages from the
 * backend are user-readable, so no client-side translation is
 * needed.
 *
 * On success the caller invalidates the
 * `["restaurant-complaints", restaurantId, ...]` query, the same
 * way the menu-items dialog owns its own invalidation.
 *
 * Errors are typed as ApiError so the caller can read `err.detail`
 * and decide where to render it.
 */

import { useMutation, type UseMutationResult } from "@tanstack/react-query"

import { ApiError } from "@/lib/api-error"
import { apiPatch } from "@/lib/api-client"
import type { ComplaintRead } from "@/types"

export type ResolveComplaintInput = {
  orderId: number
}

export function useResolveComplaint(): UseMutationResult<
  ComplaintRead,
  ApiError,
  ResolveComplaintInput
> {
  return useMutation<ComplaintRead, ApiError, ResolveComplaintInput>({
    mutationFn: ({ orderId }) =>
      apiPatch<ComplaintRead>(`/orders/${orderId}/complaint`, {
        status: "Resolved",
      }),
  })
}
