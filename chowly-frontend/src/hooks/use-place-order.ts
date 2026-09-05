"use client"

/**
 * usePlaceOrder — React Query mutation wrapping POST /orders.
 *
 * The hook is a pure API wrapper: it takes an OrderCreate, posts it,
 * and returns the created OrderRead. It does NOT know about the cart,
 * AuthProvider, navigation, or toasts — those concerns live with the
 * caller (currently CartButton's Sheet footer). Keeping this hook
 * cart-agnostic means it can be unit-tested in isolation, reused by
 * a future "re-order" flow, and swapped for a mock in storybook
 * without dragging cart state into the test setup.
 *
 * The server computes prices and subtotals from the database, so
 * the cart's client-side `unitPrice` snapshots are deliberately
 * never sent. The caller drops them when building the payload.
 *
 * Errors are typed as ApiError so the caller can read
 * `err.detail` (a string for HTTPException, an array for 422
 * validation) and decide where to render it.
 */

import { useMutation, type UseMutationResult } from "@tanstack/react-query"

import { ApiError } from "@/lib/api-error"
import { apiPost } from "@/lib/api-client"
import type { OrderCreate, OrderRead } from "@/types"

export function usePlaceOrder(): UseMutationResult<
  OrderRead,
  ApiError,
  OrderCreate
> {
  return useMutation<OrderRead, ApiError, OrderCreate>({
    mutationFn: (payload) => apiPost<OrderRead>("/orders", payload),
  })
}
