"use client"

/**
 * useUpdateMenuItem — React Query mutation wrapping
 * PATCH /restaurants/{restaurant_id}/menu-items/{item_id}.
 *
 * The hook is the admin's "edit any field on a menu item" verb.
 * The backend implements partial updates via `exclude_unset`, so
 * only the fields the caller puts in `body` are changed. The
 * caller passes restaurantId (from user.rid), itemId, and the
 * partial MenuItemUpdate payload.
 *
 * Why not a generic usePatchOnPath: same reason as use-create-
 * menu-item — the payload is typed (MenuItemUpdate) and the path
 * shape is fixed. A generic helper would just move the typing
 * out of the file the user already has open.
 *
 * "Delete" is NOT this hook — it's the narrower useSetMenuItem-
 * Availability, which only PATCHes the availability_status field.
 * Keeping the verbs separate means a future audit log can
 * distinguish "edited" from "removed" without parsing the diff.
 *
 * Errors are typed as ApiError so the caller can read `err.detail`
 * and render inline. The admin page renders them inline in the
 * edit dialog (same pattern as the create dialog and the claim
 * dialogs).
 */

import { useMutation, type UseMutationResult } from "@tanstack/react-query"

import { ApiError } from "@/lib/api-error"
import { apiPatch } from "@/lib/api-client"
import type { MenuItemRead, MenuItemUpdate } from "@/types"

export type UpdateMenuItemInput = {
  restaurantId: number
  itemId: number
  body: MenuItemUpdate
}

export function useUpdateMenuItem(): UseMutationResult<
  MenuItemRead,
  ApiError,
  UpdateMenuItemInput
> {
  return useMutation<MenuItemRead, ApiError, UpdateMenuItemInput>({
    mutationFn: ({ restaurantId, itemId, body }) =>
      apiPatch<MenuItemRead>(
        `/restaurants/${restaurantId}/menu-items/${itemId}`,
        body,
      ),
  })
}
