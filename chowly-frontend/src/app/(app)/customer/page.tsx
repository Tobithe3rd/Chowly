"use client"

/**
 * /customer — menu browsing view.
 *
 * Reads the customer's restaurant_id from the JWT (user.rid) and
 * fetches the full restaurant detail (name, address, active menus,
 * items). The list is grouped by menu, then by item_type within
 * each menu (Food, then Drink) when both exist. Items are listed
 * regardless of availability — unavailable items are dimmed and
 * tagged, not hidden, so the customer still sees what the kitchen
 * has stocked.
 *
 * This is read-only by design: no cart, no order placement, no
 * order history. Those land in the next step.
 */

import { useMemo } from "react"
import { Minus, Plus, ShoppingBag } from "lucide-react"

import { RouteGuard } from "@/components/shared/route-guard"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/hooks/use-auth"
import { useCart } from "@/hooks/use-cart"
import { useRestaurant } from "@/hooks/use-restaurant"
import { ApiError } from "@/lib/api-error"
import type { ItemType, MenuItemRead, MenuRead } from "@/types"

const ITEM_TYPE_ORDER: ItemType[] = ["Food", "Drink"]

const ITEM_TYPE_LABEL: Record<ItemType, string> = {
  Food: "Food",
  Drink: "Drinks",
}

// Currency display is hard-coded for the demo — the backend
// doesn't expose a per-restaurant currency yet, and the seeded
// restaurants span USD/EUR/GBP. Once `RestaurantDetail` carries
// a `currency` field, drop this and read it off the response.
const CURRENCY = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
})

function formatPrice(amount: string): string {
  // `amount` is a stringified Decimal from Pydantic (e.g. "12.50").
  // Coerce to number for display; for a demo we accept the float
  // precision loss rather than reimplementing Decimal formatting.
  const n = Number(amount)
  return Number.isFinite(n) ? CURRENCY.format(n) : amount
}

/** An item is "available" iff its server status equals "available".
 *  Anything else (the backend stores this as a free string up to 32
 *  chars; the only value we know about is "available" from the seed
 *  and from orders.py:237) is treated as not-orderable. */
function isAvailable(item: MenuItemRead): boolean {
  return item.availability_status === "available"
}

/** Group items within a menu by item_type, preserving a stable
 *  Food-then-Drinks order and skipping empty groups. */
function groupByType(items: MenuItemRead[]): { type: ItemType; items: MenuItemRead[] }[] {
  const out: { type: ItemType; items: MenuItemRead[] }[] = []
  for (const type of ITEM_TYPE_ORDER) {
    const grouped = items.filter((i) => i.item_type === type)
    if (grouped.length > 0) out.push({ type, items: grouped })
  }
  return out
}

// The page's signature motif: a 1px amber rule under each heading
// block. The H1 rule is the page's divider from the chrome; the
// section H2 rule is a quieter, thinner version. Color saturation
// stays in the 200/30 alpha range so the rule is decorative, not
// load-bearing for text.
function HeaderRule() {
  return (
    <div
      aria-hidden="true"
      className="mt-4 h-px w-full bg-brand/30 dark:bg-brand-soft"
    />
  )
}

function SectionRule() {
  return (
    <div
      aria-hidden="true"
      className="mt-3 h-px w-16 bg-brand dark:bg-brand-soft-foreground/60"
    />
  )
}

// Local "warning" chip. Same hue family as the role chips, stepped
// up to their 200/300 saturation so an unavailable item has the
// same visual weight as the "you are here" badge in the chrome.
const UNAVAILABLE_CHIP =
  "bg-rose-200 text-rose-900 ring-rose-300 dark:bg-rose-400/20 dark:text-rose-100 dark:ring-rose-400/40"

function CartControls({ item }: { item: MenuItemRead }) {
  const cart = useCart()
  const line = cart.items.find((l) => l.menuItemId === item.id)

  if (line) {
    return (
      <div
        className="inline-flex h-7 items-center rounded-md border border-brand bg-background dark:border-brand-soft-foreground/40"
        role="group"
        aria-label={`Adjust quantity of ${item.name}`}
      >
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Decrease quantity of ${item.name}`}
          onClick={() => cart.updateQuantity(item.id, line.quantity - 1)}
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
          aria-label={`Increase quantity of ${item.name}`}
          onClick={() => cart.updateQuantity(item.id, line.quantity + 1)}
        >
          <Plus aria-hidden="true" />
        </Button>
      </div>
    )
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => cart.addItem(item, 1)}
      aria-label={`Add ${item.name} to cart`}
      className="border-brand text-brand-soft-foreground hover:bg-brand-soft hover:text-brand dark:border-brand-soft-foreground/40 dark:text-brand-soft-foreground dark:hover:bg-brand-soft/40"
    >
      <ShoppingBag aria-hidden="true" />
      Add
    </Button>
  )
}

function MenuItemRow({ item }: { item: MenuItemRead }) {
  const available = isAvailable(item)
  return (
    <Card
      size="sm"
      data-testid="menu-item"
      data-available={available}
      aria-label={
        available ? item.name : `${item.name} (currently unavailable)`
      }
      className={
        // Available cards: hover lifts the ring to amber and adds a
        // soft shadow + 0.5px translation. The amber ring is the
        // affordance for "this is selectable." Unavailable cards do
        // not lift: they're informational, not interactive.
        "transition-all duration-150 ease-out " +
        (available
          ? "hover:-translate-y-0.5 hover:ring-2 hover:ring-brand hover:shadow-md dark:hover:ring-brand-soft-foreground/60"
          : "opacity-90")
      }
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          {/* min-w-0 so a long name wraps before pushing the price
              off the row; flex-1 lets the title take the rest. */}
          <CardTitle
            className={
              "min-w-0 flex-1 " +
              (available ? "" : "text-muted-foreground line-through decoration-1")
            }
          >
            {item.name}
          </CardTitle>
          <span
            className={
              "shrink-0 text-sm font-bold tabular-nums " +
              (available ? "text-foreground" : "text-muted-foreground")
            }
          >
            {formatPrice(item.price)}
          </span>
        </div>
        {item.description ? (
          <CardDescription>{item.description}</CardDescription>
        ) : null}
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={
                available
                  ? "ring-1 ring-inset ring-brand/40 text-brand-soft-foreground dark:text-brand-soft-foreground dark:ring-brand-soft-foreground/40"
                  : undefined
              }
            >
              {ITEM_TYPE_LABEL[item.item_type]}
            </Badge>
            {!available ? (
              <Badge
                className={`ring-1 ring-inset ${UNAVAILABLE_CHIP}`}
                variant="secondary"
              >
                Unavailable
              </Badge>
            ) : null}
          </div>
          {available ? <CartControls item={item} /> : null}
        </div>
      </CardContent>
    </Card>
  )
}

function MenuSection({ menu }: { menu: MenuRead }) {
  const groups = useMemo(() => groupByType(menu.items), [menu.items])

  if (menu.items.length === 0) {
    return (
      <section className="mt-10">
        <h2 className="text-lg font-bold tracking-[-0.01em] text-foreground">
          {menu.name}
        </h2>
        <SectionRule />
        <p className="mt-4 text-sm text-muted-foreground">
          No items in this menu yet.
        </p>
      </section>
    )
  }

  return (
    <section className="mt-10">
      <h2 className="text-lg font-bold tracking-[-0.01em] text-foreground">
        {menu.name}
      </h2>
      {menu.description ? (
        <p className="mt-1 text-sm text-muted-foreground">{menu.description}</p>
      ) : null}
      <SectionRule />
      {/* The card-level Badge already labels every item with its
          type; an "eyebrow" heading above the grid would duplicate
          that and add visual weight to a section that is already
          structured by spacing. */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {menu.items.map((item) => (
          <MenuItemRow key={item.id} item={item} />
        ))}
      </div>
    </section>
  )
}

function MenuSkeleton() {
  return (
    <div className="mt-10 space-y-8" aria-hidden="true">
      {[0, 1].map((group) => (
        <div key={group}>
          <Skeleton className="h-5 w-32" />
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Card key={i} size="sm">
                <CardHeader>
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="mt-2 h-3 w-full" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-5 w-16" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function ErrorState({
  error,
  onRetry,
}: {
  // React Query's error type is `Error` at runtime, even when the
  // hook is typed with `ApiError`. Network failures before the
  // response is built throw a plain `TypeError`; we accept both.
  error: ApiError | Error
  onRetry: () => void
}) {
  const isApi = error instanceof ApiError
  const message = isApi
    ? typeof error.detail === "string"
      ? error.detail
      : "Could not load this restaurant."
    : error.message || "Could not load this restaurant."
  return (
    <div
      role="alert"
      className="mt-8 rounded-lg border border-destructive/30 bg-destructive/5 p-4"
    >
      <p className="text-sm font-medium text-destructive">{message}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {isApi && error.status === 404
          ? "This restaurant may have been removed."
          : isApi
            ? "Try again in a moment."
            : "Check your connection and try again."}
      </p>
      <div className="mt-3">
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </div>
  )
}

function CustomerDashboard() {
  const { user } = useAuth()
  const restaurantId = user?.rid
  const query = useRestaurant(restaurantId)

  if (restaurantId === undefined) {
    return (
      <div className="mt-10 rounded-lg border border-border bg-card p-6">
        <h1 className="text-3xl font-extrabold tracking-[-0.03em] text-foreground sm:text-4xl">
          Your account isn’t linked to a restaurant yet
        </h1>
        <HeaderRule />
        <p className="mt-4 text-sm text-muted-foreground">
          We couldn’t find a restaurant associated with your account. Try
          logging out and back in — if the problem persists, contact the
          restaurant that registered you.
        </p>
      </div>
    )
  }

  return (
    <div>
      {query.isPending ? (
        <>
          <Skeleton className="h-8 w-72" />
          <Skeleton className="mt-3 h-4 w-80" />
          <Skeleton className="mt-4 h-px w-full" />
          <MenuSkeleton />
        </>
      ) : query.isError ? (
        <>
          <h1 className="text-3xl font-extrabold tracking-[-0.03em] text-foreground sm:text-4xl">
            Menu
          </h1>
          <HeaderRule />
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        </>
      ) : query.data ? (
        <>
          <header>
            <h1 className="text-3xl font-extrabold tracking-[-0.03em] text-foreground sm:text-4xl">
              {query.data.name}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {query.data.address}
            </p>
            <HeaderRule />
          </header>
          {query.data.menus.length === 0 ? (
            <p className="mt-10 text-sm text-muted-foreground">
              This restaurant has no active menus right now.
            </p>
          ) : (
            query.data.menus.map((menu) => (
              <MenuSection key={menu.id} menu={menu} />
            ))
          )}
        </>
      ) : null}
    </div>
  )
}

export default function CustomerPage() {
  return (
    <RouteGuard allowedRoles={["customer"]}>
      <CustomerDashboard />
    </RouteGuard>
  )
}
