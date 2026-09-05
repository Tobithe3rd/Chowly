"use client"

/**
 * useRestaurant — fetch a single restaurant with its active menus.
 *
 * GET /restaurants/{id} returns RestaurantDetail: id, name, address,
 * and the list of menus (already filtered to status='active' on the
 * server). Each menu has its own items array.
 *
 * `enabled: restaurantId !== undefined` is the gate that prevents the
 * query from firing before we know which restaurant to fetch. The
 * customer's restaurant_id comes from the JWT (user.rid), so the hook
 * is only ever called with a number for a logged-in customer. The
 * undefined branch exists for the type-safety edge case the page
 * handles separately.
 *
 * Errors are typed as ApiError so the consumer can render the
 * `detail` string (or the 404 body) without re-deriving the shape.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query"

import { ApiError } from "@/lib/api-error"
import { apiGet } from "@/lib/api-client"
import type { RestaurantDetail } from "@/types"

export function useRestaurant(
  restaurantId: number | undefined
): UseQueryResult<RestaurantDetail, ApiError> {
  return useQuery<RestaurantDetail, ApiError>({
    queryKey: ["restaurant", restaurantId],
    queryFn: () => apiGet<RestaurantDetail>(`/restaurants/${restaurantId}`),
    enabled: restaurantId !== undefined,
  })
}
