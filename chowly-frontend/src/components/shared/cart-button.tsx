"use client"

/**
 * CartButton — topbar cart trigger and Sheet panel for the customer.
 *
 * The button shows a ShoppingCart icon. When the cart has any items
 * (itemCount > 0) an amber badge with the count is rendered on the
 * icon — same amber family as the role chip and the page's
 * signature hairline, so the cart's presence reads as part of the
 * brand language, not a separate widget.
 *
 * Clicking the trigger opens a Sheet from the right containing the
 * cart's lines, per-line +/-/remove controls, a subtotal, and a
 * "Place order" CTA. Clicking the CTA:
 *   1. Builds the OrderCreate payload from the current cart lines
 *      and the customer's restaurant_id (from the JWT).
 *   2. POSTs /orders via usePlaceOrder (the server computes prices
 *      and subtotals — the client never sends price data).
 *   3. On success: clears the cart, closes the Sheet, shows a
 *      success toast (with the order's estimated wait time if the
 *      server returned one), and navigates to the confirmation page.
 *   4. On error: shows the server's error inline above the button
 *      so the user can retry without losing the cart.
 *
 * Scoping: this component is rendered by (app)/layout.tsx only when
 * the current user is a customer. It does NOT do its own role
 * check; the layout is the source of truth for "should the cart
 * control be visible at all."
 */

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Minus, Plus, ShoppingCart, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { useAuth } from "@/hooks/use-auth"
import { useCart } from "@/hooks/use-cart"
import { usePlaceOrder } from "@/hooks/use-place-order"
import { describeError } from "@/lib/api-error"
import type { OrderItemCreate } from "@/types"

const CURRENCY = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
})

function formatPrice(amount: number): string {
  return CURRENCY.format(amount)
}

export function CartButton() {
  const cart = useCart()
  const { user } = useAuth()
  const router = useRouter()
  const placeOrder = usePlaceOrder()
  const [open, setOpen] = useState(false)

  // The button is enabled only when we can build a complete
  // OrderCreate payload. Two failure modes the type system can't
  // catch but the UI must:
  //   - user.rid is undefined (e.g. the token is malformed or the
  //     customer has no restaurant). Without rid, the request would
  //     be missing restaurant_id; disable and explain rather than
  //     send a doomed request.
  //   - cart is empty. The backend requires min_length=1; the UI
  //     also doesn't need to ask the user to place an empty order.
  // mutation.isPending takes the slot when an in-flight request is
  // already covering for us.
  const canPlace =
    cart.items.length > 0 &&
    typeof user?.rid === "number" &&
    !placeOrder.isPending

  /**
   * Build the OrderCreate payload. The server does NOT trust
   * client-side prices — it looks up MenuItem.price and computes
   * the subtotal itself — so we drop `unitPrice` and `name` from
   * each CartLine. Only `menuItemId` and `quantity` cross the wire.
   */
  function buildPayload(restaurantId: number) {
    const items: OrderItemCreate[] = cart.items.map((l) => ({
      menu_item_id: l.menuItemId,
      quantity: l.quantity,
    }))
    return { restaurant_id: restaurantId, items }
  }

  /**
   * Map an ApiError to a single user-readable string. The shared
   * `describeError` helper in `lib/api-error.ts` handles both the
   * string detail (HTTPException) and the array-of-items (422)
   * shapes — we just pass an action-specific fallback so the user
   * knows which action failed.
   */
  const errorMessage = describeError(placeOrder.error, "Could not place your order.")

  function onPlaceOrder() {
    if (!canPlace || user?.rid === undefined) return
    placeOrder.mutate(buildPayload(user.rid), {
      onSuccess: (order) => {
        cart.clearCart()
        setOpen(false)
        const eta = order.estimated_wait_time
        toast.success(
          eta
            ? `Order placed. Estimated wait: ${eta} minute${eta === 1 ? "" : "s"}.`
            : "Order placed.",
        )
        router.push(`/customer/orders/${order.id}`)
      },
      // Error is rendered inline above the button — the Sheet stays
      // open so the user can retry without losing the cart. We do
      // NOT toast here; the inline slot is the canonical location
      // for this kind of "fix and retry" feedback, and a toast
      // would be redundant with the inline text.
    })
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={
            cart.itemCount > 0
              ? `Open cart, ${cart.itemCount} item${cart.itemCount === 1 ? "" : "s"}`
              : "Open cart"
          }
          className="relative"
        >
          <ShoppingCart aria-hidden="true" />
          {cart.itemCount > 0 ? (
            <span
              aria-hidden="true"
              className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold tabular-nums text-amber-950 ring-2 ring-background"
            >
              {cart.itemCount}
            </span>
          ) : null}
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="flex w-full flex-col p-0 sm:max-w-md"
      >
        <SheetHeader className="border-b border-border">
          <SheetTitle className="text-lg font-bold tracking-[-0.01em]">
            Your cart
          </SheetTitle>
          <SheetDescription>
            {cart.itemCount === 0
              ? "No items yet — add something from the menu."
              : `${cart.itemCount} item${cart.itemCount === 1 ? "" : "s"} ready to order.`}
          </SheetDescription>
        </SheetHeader>

        {cart.items.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-6 py-10 text-center">
            <div>
              <p className="text-sm font-medium text-foreground">
                Your cart is empty
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Pick something from the menu and it will land here.
              </p>
            </div>
          </div>
        ) : (
          <ul
            role="list"
            className="flex-1 divide-y divide-border overflow-y-auto px-4"
          >
            {cart.items.map((line) => (
              <li
                key={line.menuItemId}
                className="flex items-start gap-3 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">
                    {line.name}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                    {formatPrice(line.unitPrice)} each
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <div
                    className="inline-flex h-7 items-center rounded-md border border-border bg-background"
                    role="group"
                    aria-label={`Adjust quantity of ${line.name}`}
                  >
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Decrease quantity of ${line.name}`}
                      onClick={() =>
                        cart.updateQuantity(line.menuItemId, line.quantity - 1)
                      }
                    >
                      <Minus aria-hidden="true" />
                    </Button>
                    <span
                      aria-live="polite"
                      className="min-w-6 px-1 text-center text-sm font-semibold tabular-nums text-foreground"
                    >
                      {line.quantity}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Increase quantity of ${line.name}`}
                      onClick={() =>
                        cart.updateQuantity(line.menuItemId, line.quantity + 1)
                      }
                    >
                      <Plus aria-hidden="true" />
                    </Button>
                  </div>
                  <span className="text-sm font-bold tabular-nums text-foreground">
                    {formatPrice(line.unitPrice * line.quantity)}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remove ${line.name} from cart`}
                  onClick={() => cart.removeItem(line.menuItemId)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <SheetFooter className="border-t border-border bg-background">
          <div className="flex w-full items-center justify-between">
            <span className="text-sm text-muted-foreground">Subtotal</span>
            <span
              className="text-lg font-bold tabular-nums text-foreground"
              aria-live="polite"
            >
              {formatPrice(cart.subtotal)}
            </span>
          </div>
          {/*
            Inline error slot. Lives inside the footer so the
            message is right above the CTA — the user's eye is
            already on the button when they get the failure, and
            the most common fix is to press the button again.
            `role="alert"` so screen readers announce the change.
            The rose-tinted card gives the error a little presence
            without making it look like a separate surface — the
            footer is still the parent and the button is still
            the next step.
          */}
          {errorMessage ? (
            <div
              role="alert"
              className="w-full rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2"
            >
              <p className="text-sm text-destructive">{errorMessage}</p>
            </div>
          ) : null}
          {/*
            The button's disabled reason is layered:
              - empty cart  → "Add items before placing an order."
              - missing rid → token is malformed or the customer
                has no restaurant; either way, a "place order" click
                would send a doomed request.
              - in flight   → just disabled, no message needed
                (the spinner is the explanation).
            The title attribute is the hover/screen-reader fallback
            for the "why" — visible only when the button is the
            primary focus.
          */}
          <Button
            disabled={!canPlace}
            onClick={onPlaceOrder}
            aria-busy={placeOrder.isPending}
            title={
              cart.items.length === 0
                ? "Add items before placing an order."
                : typeof user?.rid !== "number"
                  ? "Your account is not linked to a restaurant."
                  : undefined
            }
            className="w-full bg-amber-500 text-amber-950 hover:bg-amber-400 dark:bg-amber-400 dark:text-amber-950 dark:hover:bg-amber-300"
          >
            {placeOrder.isPending ? (
              <>
                <Loader2 aria-hidden="true" className="animate-spin" />
                Placing order…
              </>
            ) : (
              "Place order"
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
