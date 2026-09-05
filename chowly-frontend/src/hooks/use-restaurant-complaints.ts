"use client"

/**
 * useRestaurantComplaints — fetch the list of complaints for one
 * restaurant, optionally filtered by status.
 *
 * GET /restaurants/{id}/complaints returns ComplaintRead[] scoped by
 * the backend to same-tenant staff/admin (customers are rejected).
 * The hook is the read side of the admin complaints table.
 *
 * The optional `statusFilter` adds `?status=Open|Resolved`. The
 * queryKey includes the filter so changing it in the admin UI
 * triggers a refetch under a new key — and the previous filter's
 * cache entry stays around in case the user toggles back, instead
 * of being aggressively GC'd.
 *
 * No refetchInterval: the admin complaints page is a CRUD screen,
 * not an operational dashboard (the same "no 10s polling" decision
 * as the menu-items page at admin/page.tsx). Refetching happens on
 * mount and on mutation success (resolve).
 *
 * Errors are typed as ApiError so the caller can read `err.detail`
 * directly and render it via the shared describeError helper.
 *
 * The `enabled` gate mirrors useOrders: a malformed URL like
 * /admin (with no rid) yields `restaurantId === undefined`, the
 * hook short-circuits, and the page renders its static "no
 * restaurant" state without firing a doomed request.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query"

import { ApiError } from "@/lib/api-error"
import { apiGet } from "@/lib/api-client"
import type { ComplaintRead, ComplaintStatus } from "@/types"

export function useRestaurantComplaints(
  restaurantId: number | undefined,
  statusFilter?: ComplaintStatus,
): UseQueryResult<ComplaintRead[], ApiError> {
  return useQuery<ComplaintRead[], ApiError>({
    queryKey: ["restaurant-complaints", restaurantId, statusFilter ?? null],
    queryFn: () => {
      const qs = statusFilter
        ? `?status=${encodeURIComponent(statusFilter)}`
        : ""
      return apiGet<ComplaintRead[]>(
        `/restaurants/${restaurantId}/complaints${qs}`,
      )
    },
    enabled: typeof restaurantId === "number" && Number.isFinite(restaurantId),
  })
}
