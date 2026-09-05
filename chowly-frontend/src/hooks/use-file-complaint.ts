"use client"

/**
 * useFileComplaint — React Query mutation wrapping POST /orders/{id}/complaint.
 *
 * The hook is a pure API wrapper: it takes an orderId + a ComplaintCreate,
 * posts it, and returns the created ComplaintRead. It does NOT know
 * about auth context, the FeedbackCard, dialogs, or cache invalidation —
 * those concerns live with the caller. Keeping this hook decoupled
 * means it can be unit-tested in isolation and reused by a future
 * "re-file" flow (if/when a 409 PATCH is added).
 *
 * The hook does NOT special-case 409. The backend returns 409 ("Order
 * N already has a complaint") on a second submission; the dialog
 * inspects `mutation.error.status === 409` at the call site to render
 * a distinct message ("You've already filed a complaint on this
 * order."). Same for 422 — the inline error slot calls the shared
 * describeError helper. This matches the per-action specificity of
 * useClaimOrder / usePlaceOrder (call-site error rendering, not
 * hook-level error translation).
 *
 * On success the caller invalidates the `["complaint", orderId]`
 * query, the same way the cart Sheet owns its own invalidation.
 *
 * Errors are typed as ApiError so the caller can read `err.detail`
 * (a string for HTTPException, an array for 422 validation) and
 * decide where to render it.
 */

import { useMutation, type UseMutationResult } from "@tanstack/react-query"

import { ApiError } from "@/lib/api-error"
import { apiPost } from "@/lib/api-client"
import type { ComplaintCreate, ComplaintRead } from "@/types"

export type FileComplaintInput = {
  orderId: number
  body: ComplaintCreate
}

export function useFileComplaint(): UseMutationResult<
  ComplaintRead,
  ApiError,
  FileComplaintInput
> {
  return useMutation<ComplaintRead, ApiError, FileComplaintInput>({
    mutationFn: ({ orderId, body }) =>
      apiPost<ComplaintRead>(`/orders/${orderId}/complaint`, body),
  })
}
