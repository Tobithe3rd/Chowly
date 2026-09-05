"use client"

/**
 * useSetMenuItemAvailability — React Query mutation wrapping
 * PATCH /restaurants/{restaurant_id}/menu-items/{item_id} with
 * only an availability_status field.
 *
 * This is the admin's "delete" action, by user decision. The
 * backend has no DELETE endpoint for menu items (verified via
 * /openapi.json and routers/restaurants.py), and the customer
 * surface already filters to `availability_status === "available"`
 * (customer/page.tsx) — the orders router also rejects placing
 * orders for unavailable items (orders.py:237). So flipping an
 * item to "unavailable" cleanly hides it from customers and
 * blocks new orders, without needing a new endpoint, a
 * destructive action, or any FK/cascade concerns.
 *
 * The hook is intentionally narrow: it only takes the new
 * availability value, not a partial MenuItemUpdate. The two
 * values currently mean anything in the system are "available"
 * and "unavailable" — see customer/page.tsx:isAvailable and
 * the seed at scripts/seed.py (all rows are "available").
 * If a future need appears for "out_of_stock" or similar, the
 * type widens and the customer's filter / orders router's check
 * widen with it.
 *
 * Errors are typed as ApiError so the caller can read `err.detail`
 * and render inline. The admin page renders them inline in the
 * remove-confirm dialog.
 */

import { useMutation, type UseMutationResult } from "@tanstack/react-query"

import { ApiError } from "@/lib/api-error"
import { apiPatch } from "@/lib/api-client"
import type { MenuItemRead } from "@/types"

/**
 * The two availability values the system actually understands.
 * Anywhere else a free-form string is accepted, the form offers
 * these two as fixed choices; if a real need appears for other
 * values, widen this type and the matching checks.
 */
export type MenuItemAvailability = "available" | "unavailable"

export type SetMenuItemAvailabilityInput = {
  restaurantId: number
  itemId: number
  availability: MenuItemAvailability
}

export function useSetMenuItemAvailability(): UseMutationResult<
  MenuItemRead,
  ApiError,
  SetMenuItemAvailabilityInput
> {
  return useMutation<MenuItemRead, ApiError, SetMenuItemAvailabilityInput>({
    mutationFn: ({ restaurantId, itemId, availability }) =>
      apiPatch<MenuItemRead>(
        `/restaurants/${restaurantId}/menu-items/${itemId}`,
        { availability_status: availability },
      ),
  })
}
