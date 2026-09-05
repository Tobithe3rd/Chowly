"use client"

/**
 * /customer/orders — the customer's order history.
 *
 * The customer's home (`/customer`) is the *menu* — a way to
 * place a new order. This page is the missing complement: a way
 * to find an order already placed. After the customer places an
 * order, navigates away, and (later) signs back in, this is the
 * page that gets them back to the detail view with the new
 * progress stepper.
 *
 * Data flow: useOrders() hits GET /orders, which the backend
 * already customer-scopes (see app/routers/orders.py:350-354 —
 * the WHERE clause is `Order.customer_id == customer.id` for
 * the customer role). No client-side filtering, no separate
 * /customers/{id}/orders endpoint needed; this is the same
 * hook the waiter dashboard uses, with the same `OrderRead[]`
 * shape, just consumed by a different page.
 *
 * Why no polling: the customer order history is a *browsing*
 * surface, not an operational dashboard. A live In Preparation
 * order is on the detail page (which polls); the list page is
 * "what have I ordered recently?" — staleTime: 0 +
 * refetchOnWindowFocus: true gives the right "give me now"
 * behavior on revisit without burning a 10s timer while the
 * user is reading.
 *
 * Sort comes from the backend (`order_date DESC`); the page
 * does NOT re-sort client-side. Trust the server. Mirrors the
 * waiter's page docstring at (app)/waiter/page.tsx:18-19.
 *
 * Row click target: the entire row navigates to
 * /customer/orders/{id} — not just the id cell. Why row-level
 * instead of wrapping the cells in a single <a>: the shadcn
 * Table primitives render real HTML (<table><tbody><tr><td>),
 * and an <a> cannot wrap multiple <td> children of one <tr>
 * without breaking the table semantics. So instead the <tr>
 * itself is the click target, with three layered affordances:
 *   - onClick → router.push (mouse)
 *   - onKeyDown Enter/Space → router.push (keyboard)
 *   - role="link" + tabIndex + aria-label (a11y)
 * Every <td> in the row gets cursor-pointer so the cursor
 * signals clickability across the full width; hover:bg-muted/40
 * on the <tr> tints the whole row. This matches the standard
 * "clickable table row" pattern (Gmail, GitHub issues, Linear)
 * and is what the user means by "the row is clickable" — the
 * id cell alone is not enough affordance.
 */

import Link from "next/link"
import { useRouter } from "next/navigation"

import { RouteGuard } from "@/components/shared/route-guard"
import { OrderStatusBadge } from "@/components/shared/order-status-badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useOrders } from "@/hooks/use-orders"
import { ApiError } from "@/lib/api-error"
import type { OrderRead } from "@/types"

const CURRENCY = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
})

function formatPrice(amount: number): string {
  return CURRENCY.format(amount)
}

// Same shape as the order detail page's formatOrderDate (line 93)
// — Intl.DateTimeFormat with medium date + short time, no
// date-library dependency for a single call site. Duplicated
// here rather than extracted into lib/ because the formatter
// is 5 lines and the cross-file coupling (it would need a
// dedicated module just to host it) doesn't pay off until a
// third page needs the same shape.
function formatOrderDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d)
}

/**
 * summarizeItems — one-line "N lines · M items" copy under the
 * order id. Mirrors the waiter's per-row summary at
 * (app)/waiter/page.tsx:150-154 so the two dashboards read with
 * the same vocabulary when a customer and a waiter discuss an
 * order over the phone.
 */
function summarizeItems(order: OrderRead): string {
  const lines = order.items.length
  const units = order.items.reduce((n, l) => n + l.quantity, 0)
  return `${lines} line${lines === 1 ? "" : "s"} · ${units} item${units === 1 ? "" : "s"}`
}

function HeaderRule() {
  return (
    <div
      aria-hidden="true"
      className="mt-4 h-px w-full bg-amber-200/70 dark:bg-amber-400/30"
    />
  )
}

/**
 * TableSkeleton — eight rows of placeholder cells. Same density
 * as the waiter/admin skeletons, but the columns match this
 * page's row shape (id + placed + status + total + items) so
 * the layout doesn't shift when the data lands. The 8-row
 * density is "enough to fill the viewport at typical heights"
 * — same reasoning the waiter skeleton documents.
 */
function TableSkeleton() {
  return (
    <div
      className="overflow-hidden rounded-lg border border-border bg-card"
      aria-hidden="true"
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-20">Order</TableHead>
            <TableHead className="w-40">Placed</TableHead>
            <TableHead className="w-32">Status</TableHead>
            <TableHead>Items</TableHead>
            <TableHead className="w-24 text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 8 }).map((_, i) => (
            <TableRow key={i}>
              <TableCell>
                <Skeleton className="h-4 w-14" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-28" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-5 w-24 rounded-full" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-32" />
              </TableCell>
              <TableCell>
                <Skeleton className="ml-auto h-4 w-16" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function ErrorState({
  error,
  onRetry,
}: {
  error: ApiError | Error
  onRetry: () => void
}) {
  const isApi = error instanceof ApiError
  const message = isApi
    ? typeof error.detail === "string"
      ? error.detail
      : "Could not load your orders."
    : error.message || "Could not load your orders."
  return (
    <div
      role="alert"
      className="mt-8 rounded-lg border border-destructive/30 bg-destructive/5 p-4"
    >
      <p className="text-sm font-medium text-destructive">{message}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {isApi
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

/**
 * EmptyState — "You haven't placed any orders yet."
 *
 * Reads as a "browse" invitation, not an error: a customer with
 * zero orders is at the start of the funnel, not in a broken
 * state. The CTA back to the menu page is the only sensible next
 * action; placing a new order is what the customer came here to
 * do (or didn't realize they could do).
 */
function EmptyState() {
  return (
    <div className="rounded-lg border border-border bg-card p-10 text-center">
      <p className="text-sm font-medium text-foreground">
        You haven&apos;t placed any orders yet
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        Browse the menu to start your first order.
      </p>
      <div className="mt-4">
        <Button variant="outline" size="sm" asChild>
          <a href="/customer">Browse the menu</a>
        </Button>
      </div>
    </div>
  )
}

function CustomerOrdersDashboard() {
  // pollMs: 0 disables the 10s operational polling — this page
  // is a browsing surface, not an operational one. The list still
  // re-fetches on focus (staleTime: 0 + the React Query default
  // refetchOnWindowFocus) and on a manual refetch, which is the
  // "give me now on revisit" feel the page wants.
  const query = useOrders(undefined, 0)
  const router = useRouter()

  if (query.isPending) {
    return (
      <div>
        {/*
          Same header row shape as the success branch, sans
          subtitle. The Back-to-menu button stays visible during
          the brief load window so the customer has somewhere to
          go if they don't want to wait for the data.
        */}
        <header className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-[-0.02em] text-foreground sm:text-3xl">
            My orders
          </h1>
          <Button variant="outline" size="sm" asChild>
            <a href="/customer">Back to the menu</a>
          </Button>
        </header>
        <HeaderRule />
        <div className="mt-6">
          <TableSkeleton />
        </div>
      </div>
    )
  }

  if (query.isError) {
    return (
      <div>
        {/*
          Same header row shape as the other branches. The
          "Try again" button in ErrorState handles the
          error-recovery path; the Back-to-menu button is
          the alternate exit if the customer doesn't want to
          retry.
        */}
        <header className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-[-0.02em] text-foreground sm:text-3xl">
            My orders
          </h1>
          <Button variant="outline" size="sm" asChild>
            <a href="/customer">Back to the menu</a>
          </Button>
        </header>
        <HeaderRule />
        <ErrorState
          error={query.error}
          onRetry={() => query.refetch()}
        />
      </div>
    )
  }

  const orders = query.data ?? []
  const subtitle = `${orders.length} order${orders.length === 1 ? "" : "s"}`

  return (
    <div>
      {/*
        Header row: H1 + subtitle on the left, "Back to the
        menu" button on the right. Reuses the exact pattern
        from the order detail page (see customer/orders/[orderId]/
        page.tsx:404-413) — same Button variant="outline" size="sm"
        with an <a href="/customer"> child, same copy. The detail
        page pairs the button with a "View all my orders" link; on
        the list page the button sits alone in the header, which
        is the natural complement (the topbar already carries
        "My orders" as a persistent affordance, so the list page
        doesn't need a sibling text-link). On small screens the
        flex-wrap lets the button drop below the title instead
        of squishing it.
      */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-[-0.02em] text-foreground sm:text-3xl">
            My orders
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <a href="/customer">Back to the menu</a>
        </Button>
      </header>
      <HeaderRule />

      <div className="mt-6">
        {orders.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Order</TableHead>
                  <TableHead className="w-40">Placed</TableHead>
                  <TableHead className="w-32">Status</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead className="w-24 text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => {
                  /*
                   * Whole-row click target — see file docstring.
                   * One navigation per row regardless of which
                   * cell the user clicks; onKeyDown handles
                   * Enter/Space, role="link" + tabIndex handles
                   * keyboard focus and screen-reader
                   * announcement. The aria-label lives on the
                   * <tr> so the row is a single semantic link,
                   * not five (one per cell).
                   */
                  const navigate = () =>
                    router.push(`/customer/orders/${order.id}`)
                  return (
                    <TableRow
                      key={order.id}
                      role="link"
                      tabIndex={0}
                      aria-label={`View order #${order.id}`}
                      className="cursor-pointer hover:bg-muted/40 focus-visible:bg-amber-50 focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-inset focus-visible:outline-none dark:focus-visible:bg-amber-400/10 dark:focus-visible:ring-amber-400/40"
                      onClick={navigate}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault()
                          navigate()
                        }
                      }}
                    >
                      <TableCell className="cursor-pointer p-0">
                        {/*
                          Keep the <Link> on the id cell for the
                          affordances only an <a> gives us: Next.js
                          auto-prefetch on hover (the detail page
                          is small; prefetch is a free speedup),
                          right-click "Open in new tab", middle-
                          click open in new tab, and a real anchor
                          for screen-reader users who navigate by
                          link list. The row's onClick is the
                          mouse-click-anywhere handler — when the
                          user clicks the id cell, both fire
                          (Link's default navigation + row's
                          onClick → router.push to the same URL);
                          double-call is harmless because
                          router.push to the page you're already
                          navigating to is a no-op. focus-visible
                          lives on the <tr> so the row is the
                          focus stop, not the link.
                        */}
                        <Link
                          href={`/customer/orders/${order.id}`}
                          className="block px-4 py-2 outline-none"
                        >
                          <span className="font-semibold tabular-nums text-foreground">
                            #{order.id}
                          </span>
                        </Link>
                      </TableCell>
                      <TableCell
                        className="cursor-pointer text-sm tabular-nums text-foreground"
                        title={formatOrderDate(order.order_date)}
                      >
                        {formatOrderDate(order.order_date)}
                      </TableCell>
                      <TableCell className="cursor-pointer">
                        <OrderStatusBadge status={order.status} size="sm" />
                      </TableCell>
                      <TableCell className="cursor-pointer text-sm text-foreground">
                        {summarizeItems(order)}
                      </TableCell>
                      <TableCell className="cursor-pointer text-right text-sm font-semibold tabular-nums text-foreground">
                        {formatPrice(order.total_amount)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  )
}

export default function CustomerOrdersPage() {
  return (
    <RouteGuard allowedRoles={["customer"]}>
      <CustomerOrdersDashboard />
    </RouteGuard>
  )
}
