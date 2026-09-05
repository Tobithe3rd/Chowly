"use client"

/**
 * useCreateMenuItem — React Query mutation wrapping
 * POST /restaurants/{restaurant_id}/menu-items.
 *
 * The hook is the admin counterpart to useClaimOrder/usePlaceOrder:
 * narrow to the single verb the admin UI performs (add a menu item
 * to the restaurant's only menu), with no knowledge of which admin
 * called it (the backend enforces that — a chef/waiter/customer
 * gets 403, a different-tenant admin gets 403). The caller passes
 * the admin's restaurantId (read from `user.rid` in the JWT) and
 * the new item's fields; the hook returns the created MenuItemRead.
 *
 * Why a dedicated hook (vs. a generic useCreateOnPath): the payload
 * shape (MenuItemCreate) is fixed and the path segment is the same
 * for every admin. A generic helper would have to take the path as
 * an argument, which is the same code in a different file. Keep
 * the narrow contract here.
 *
 * Errors are typed as ApiError so the caller can read `err.detail`
 * (string for HTTPException, array for 422) and decide where to
 * render it. The admin page renders errors inline in the create
 * dialog (same pattern as the cart Sheet and the claim dialogs).
 */

import { useMutation, type UseMutationResult } from "@tanstack/react-query"

import { ApiError } from "@/lib/api-error"
import { apiPost } from "@/lib/api-client"
import type { MenuItemCreate, MenuItemRead } from "@/types"

export type CreateMenuItemInput = {
  restaurantId: number
  body: MenuItemCreate
}

export function useCreateMenuItem(): UseMutationResult<
  MenuItemRead,
  ApiError,
  CreateMenuItemInput
> {
  return useMutation<MenuItemRead, ApiError, CreateMenuItemInput>({
    mutationFn: ({ restaurantId, body }) =>
      apiPost<MenuItemRead>(`/restaurants/${restaurantId}/menu-items`, body),
  })
}
