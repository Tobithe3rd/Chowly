"use client"

/**
 * useRating — fetch the rating on a single order.
 *
 * GET /orders/{id}/rating returns RatingRead (value, comment, date).
 * Only the order's owning customer may read it — other customers and
 * staff get 403 from the backend; missing rating gets 404; missing
 * order also gets 404. The 404 lands as ApiError here rather than
 * being collapsed into an "absence" state at the hook layer: the
 * existing useOrder convention (see src/hooks/use-order.ts) is "404 is
 * a typed error, the caller decides what absence means." The
 * FeedbackCard uses err.status === 404 to render the "Rate this order"
 * CTA; anything else renders the shared error state.
 *
 * The `enabled` gate mirrors useOrder: a malformed URL like
 * /customer/orders/abc parses to NaN, the hook short-circuits, and
 * the page renders its static "invalid link" state without firing
 * a doomed request.
 *
 * Errors are typed as ApiError so the caller can read `err.detail`
 * (the 403/404 message) directly and render it inline.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query"

import { ApiError } from "@/lib/api-error"
import { apiGet } from "@/lib/api-client"
import type { RatingRead } from "@/types"

export function useRating(
  orderId: number | undefined
): UseQueryResult<RatingRead, ApiError> {
  return useQuery<RatingRead, ApiError>({
    queryKey: ["rating", orderId],
    queryFn: () => apiGet<RatingRead>(`/orders/${orderId}/rating`),
    enabled: typeof orderId === "number" && Number.isFinite(orderId),
  })
}
