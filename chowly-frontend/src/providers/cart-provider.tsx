"use client"

/**
 * Cart state for the Chowly customer dashboard.
 *
 * The cart is a client-side staging area for an order the customer
 * has not yet placed. It is NOT the order — the server is the source
 * of truth, and the actual `POST /orders` happens in a later step.
 *
 * Why we keep `name` and `unitPrice` as snapshots in the cart line:
 *   - `name` lets the topbar cart badge / sheet show items without
 *     a second fetch of the menu.
 *   - `unitPrice` lets the cart compute a subtotal without a second
 *     fetch. The snapshot is taken at add-time, so a customer who
 *     sits on the page for an hour could end up with prices that
 *     don't match the menu (the server's truth). Order placement
 *     will use the server's `unit_price` anyway, so the user never
 *     pays the stale price.
 *
 * Persistence: in-memory only. A page reload wipes the cart. This
 * is a judgment call documented in the step notes; for a demo with
 * 24h JWTs it's fine, and it sidesteps the stale-price problem
 * entirely. When the server-side cart lands, this provider becomes
 * a thin wrapper around it.
 *
 * Invariants the mutators preserve:
 *   - Every line has quantity >= 1 (we clamp on update, not 0/neg).
 *   - `addItem` is idempotent: re-adding an existing line bumps
 *     quantity, doesn't duplicate.
 *   - `updateQuantity(_, 0)` removes the line.
 *   - The derived `itemCount` and `subtotal` are computed each
 *     render, not stored.
 */

import {
  createContext,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from "react"

import type { MenuItemRead } from "@/types"

export type CartLine = {
  menuItemId: number
  name: string
  unitPrice: number
  quantity: number
}

export type CartContextValue = {
  items: CartLine[]
  itemCount: number
  subtotal: number
  addItem: (item: MenuItemRead, quantity?: number) => void
  removeItem: (menuItemId: number) => void
  updateQuantity: (menuItemId: number, quantity: number) => void
  clearCart: () => void
}

export const CartContext = createContext<CartContextValue | null>(null)

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartLine[]>([])

  const addItem = useCallback(
    (item: MenuItemRead, quantity: number = 1) => {
      // `unitPrice` is a stringified Decimal on the wire. Coerce
      // once at the boundary so the subtotal math is plain numbers.
      const unitPrice = Number(item.price)
      if (!Number.isFinite(unitPrice)) return // defensive: bad wire

      const addQty = Math.max(1, Math.floor(quantity))
      setItems((prev) => {
        const idx = prev.findIndex((l) => l.menuItemId === item.id)
        if (idx === -1) {
          return [
            ...prev,
            {
              menuItemId: item.id,
              name: item.name,
              unitPrice,
              quantity: addQty,
            },
          ]
        }
        const next = prev.slice()
        next[idx] = { ...next[idx], quantity: next[idx].quantity + addQty }
        return next
      })
    },
    []
  )

  const removeItem = useCallback((menuItemId: number) => {
    setItems((prev) => prev.filter((l) => l.menuItemId !== menuItemId))
  }, [])

  const updateQuantity = useCallback(
    (menuItemId: number, quantity: number) => {
      // Treat 0 / negative / non-finite as "remove the line."
      // This is the convention the +/- controls rely on: pressing
      // minus on a quantity-1 line removes it.
      if (!Number.isFinite(quantity) || quantity <= 0) {
        setItems((prev) => prev.filter((l) => l.menuItemId !== menuItemId))
        return
      }
      const q = Math.floor(quantity)
      setItems((prev) =>
        prev.map((l) => (l.menuItemId === menuItemId ? { ...l, quantity: q } : l))
      )
    },
    []
  )

  const clearCart = useCallback(() => {
    setItems([])
  }, [])

  const value = useMemo<CartContextValue>(() => {
    let count = 0
    let subtotal = 0
    for (const line of items) {
      count += line.quantity
      subtotal += line.unitPrice * line.quantity
    }
    return {
      items,
      itemCount: count,
      subtotal,
      addItem,
      removeItem,
      updateQuantity,
      clearCart,
    }
  }, [items, addItem, removeItem, updateQuantity, clearCart])

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}
