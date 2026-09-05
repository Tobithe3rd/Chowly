"use client"

/**
 * useFileRating — React Query mutation wrapping POST /orders/{id}/rating.
 *
 * The hook is a pure API wrapper: it takes an orderId + a RatingCreate,
 * posts it, and returns the created RatingRead. It does NOT know
 * about auth context, the FeedbackCard, dialogs, or cache invalidation —
 * those concerns live with the caller. Keeping this hook decoupled
 * means it can be unit-tested in isolation and reused by a future
 * "re-rate" flow (if/when a 409 PATCH is added).
 *
 * The hook does NOT special-case 409. The backend returns 409 ("Order
 * N already has a rating") on a second submission; the dialog inspects
 * `mutation.error.status === 409` at the call site to render a distinct
 * message ("You've already rated this order."). Same for 422 — the
 * inline error slot calls the shared describeError helper.
 *
 * On success the caller invalidates the `["rating", orderId]` query,
 * the same way the cart Sheet owns its own invalidation.
 *
 * Errors are typed as ApiError so the caller can read `err.detail`
 * (a string for HTTPException, an array for 422 validation) and
 * decide where to render it.
 */

import { useMutation, type UseMutationResult } from "@tanstack/react-query"

import { ApiError } from "@/lib/api-error"
import { apiPost } from "@/lib/api-client"
import type { RatingCreate, RatingRead } from "@/types"

export type FileRatingInput = {
  orderId: number
  body: RatingCreate
}

export function useFileRating(): UseMutationResult<
  RatingRead,
  ApiError,
  FileRatingInput
> {
  return useMutation<RatingRead, ApiError, FileRatingInput>({
    mutationFn: ({ orderId, body }) =>
      apiPost<RatingRead>(`/orders/${orderId}/rating`, body),
  })
}
