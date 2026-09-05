"use client"

/**
 * useCart — read the current CartContext value.
 *
 * Throws if called outside a CartProvider so we get a clear error
 * at the call site rather than a silent undefined crash later. The
 * provider lives at the root of the (app) route group, so any
 * dashboard page that imports this hook is correctly scoped.
 */

import { useContext } from "react"

import { CartContext, type CartContextValue } from "@/providers/cart-provider"

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext)
  if (!ctx) {
    throw new Error(
      "useCart must be used inside a <CartProvider>. " +
        "Wrap your (app) tree in providers/cart-provider.tsx's CartProvider."
    )
  }
  return ctx
}
