"use client"

/**
 * /waiter/orders/[orderId] — the waiter's order detail page.
 *
 * The single-action row on /waiter is a fast scan lane — one
 * button at a time, mutually exclusive by state. This page is
 * the *full-control* sibling: when a waiter wants to see the
 * whole order and apply the right action, they come here.
 *
 * Reuse vs the customer detail page: ~90% of the body is
 * shared. The shape (header + stepper + estimated-wait + items
 * + back link) is identical, with three role-driven changes:
 *
 *   1. RouteGuard: allowedRoles={["waiter"]} instead of
 *      {["customer"]}. Same one-line shape, no special-casing.
 *   2. Header retarget: H1 is "Order #N" (not "Your order"),
 *      the back link is "Back to all orders" pointing to
 *      /waiter (not /customer/orders), and the OrderStatusBadge
 *      is paired with OrderComplaintIndicator so a waiter
 *      scanning the header sees the same open-complaint signal
 *      they get on the list row.
 *   3. Action group instead of FeedbackCard: the Items card
 *      header grows a row of three buttons (Claim / Mark
 *      delayed / Mark served), each rendered with the
 *      canClaim/canDelay/canServe predicates from
 *      lib/order-utils. A button whose precondition isn't
 *      met renders disabled with a small muted-text
 *      explanation (e.g. "Mark served — 2 lines still
 *      preparing"). The FeedbackCard (rating + complaint
 *      filing) is dropped — waiters don't file these.
 *
 * Data flow: useOrder(orderId) → GET /orders/{id}, which the
 * backend already admits staff at the same restaurant
 * (routers/orders.py:408-427). Same hook, same shape as the
 * customer page; the page just reads more off the response
 * (waiter_id, all_lines_ready) to drive the action group.
 *
 * Sort/polling: useOrder polls every 25s with a terminal-pause,
 * so a live order's status flips within one tick. The list
 * page polls at 10s; the detail page doesn't need that cadence
 * because the action is a deliberate step, not a passive
 * observation. After a mutation, the same hook invalidates
 * ["order", id] and the 25s poll picks up the new state — or
 * an explicit refetch via the page's "Try again" if the user
 * is impatient.
 */

import { useMemo, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { Clock, Receipt } from "lucide-react"

import { ClaimButton } from "@/components/shared/claim-button"
import { ComplaintStatusBadge } from "@/components/shared/complaint-status-badge"
import { LineReadyBadge } from "@/components/shared/line-ready-badge"
import { MarkDelayedButton } from "@/components/shared/mark-delayed-button"
import { MarkServedButton } from "@/components/shared/mark-served-button"
import { OrderStatusBadge } from "@/components/shared/order-status-badge"
import {
  deriveStepperStates,
  OrderStepper,
  type OrderStepperNodeId,
} from "@/components/shared/order-stepper"
import { RouteGuard } from "@/components/shared/route-guard"
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
import { useComplaint } from "@/hooks/use-complaint"
import { useOrder } from "@/hooks/use-order"
import { canClaim, canDelay, isTerminal } from "@/lib/order-utils"
import { ApiError } from "@/lib/api-error"
import type { OrderItemRead, OrderRead } from "@/types"

const CURRENCY = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
})

function formatPrice(amount: number): string {
  return CURRENCY.format(amount)
}

function formatOrderDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d)
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
 * OrderLineRow — the waiter's per-line view.
 *
 * Identical to the customer detail's OrderLineRow except the
 * Claimed chip names the claiming role: "Claimed by chef" or
 * "Claimed by bartender" using chef_id / bartender_id. The id
 * itself is still rendered as `#N` (the staff-name join is a
 * flagged gap, deferred). When neither chef_id nor bartender_id
 * is set, falls through to a muted "Preparing" label.
 *
 * Why a copy rather than an import: the customer page's row
 * is intentionally customer-flavored (just "Claimed"); the
 * waiter's view needs the role hint, which would add a prop
 * to the shared version and complicate the customer page.
 * Two near-identical files is cheaper than a parameterized
 * one with a role-conditional branch.
 */
function OrderLineRow({ line }: { line: OrderItemRead }) {
  const claimedByChef = line.chef_id !== null
  const claimedByBartender = line.bartender_id !== null
  const claimed = claimedByChef || claimedByBartender
  const isReady = line.status === "Ready"
  // Chef and bartender never both claim the same line (an
  // OrderItem is one or the other based on item_type), so the
  // exclusive if/else is the right shape, not a stacked list.
  const claimedLabel = claimedByChef
    ? `Claimed by chef #${line.chef_id}`
    : claimedByBartender
      ? `Claimed by bartender #${line.bartender_id}`
      : "Claimed"
  return (
    <div className="flex items-start justify-between gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-foreground">
            {line.menu_item_name}
          </p>
          {isReady ? (
            <LineReadyBadge />
          ) : claimed ? (
            <span className="inline-flex items-center rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:text-sky-300">
              {claimedLabel}
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground">
              Preparing
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
          {formatPrice(line.unit_price)} each × {line.quantity}
        </p>
      </div>
      <span className="shrink-0 text-sm font-bold tabular-nums text-foreground">
        {formatPrice(line.subtotal)}
      </span>
    </div>
  )
}

function LinesProgressSummary({ order }: { order: OrderRead }) {
  const total = order.items.length
  const ready = order.items.filter((l) => l.status === "Ready").length
  if (ready <= 0 || ready >= total) return null
  return (
    <p className="text-xs font-medium text-muted-foreground">
      {ready} of {total} line{total === 1 ? "" : "s"} ready
    </p>
  )
}

function CancelledCard({ order }: { order: OrderRead }) {
  return (
    <Card size="sm" className="mt-6 border-rose-300 bg-rose-50 dark:border-rose-500/40 dark:bg-rose-950/30">
      <CardHeader>
        <div className="flex items-start gap-2">
          <OrderStatusBadge status={order.status} />
          <div>
            <CardTitle className="text-rose-900 dark:text-rose-100">
              Order #{order.id} was cancelled
            </CardTitle>
            <CardDescription>
              Placed {formatOrderDate(order.order_date)}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
    </Card>
  )
}

function OrderSkeleton() {
  return (
    <div className="mt-10 space-y-6" aria-hidden="true">
      <div>
        <Skeleton className="h-7 w-48" />
        <Skeleton className="mt-2 h-4 w-72" />
        <Skeleton className="mt-4 h-px w-full" />
      </div>
      <Card size="sm">
        <CardHeader>
          <Skeleton className="h-5 w-32" />
          <Skeleton className="mt-2 h-4 w-48" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center justify-between">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
            <Skeleton className="h-px w-full" />
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-5 w-24" />
            </div>
          </div>
        </CardContent>
      </Card>
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
      : "Could not load this order."
    : error.message || "Could not load this order."
  const hint =
    isApi && error.status === 404
      ? "This order may have been removed, or the link is wrong."
      : isApi
        ? "Try again in a moment."
        : "Check your connection and try again."
  return (
    <div
      role="alert"
      className="mt-8 rounded-lg border border-destructive/30 bg-destructive/5 p-4"
    >
      <p className="text-sm font-medium text-destructive">{message}</p>
      <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
      <div className="mt-3">
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </div>
  )
}

function InvalidIdState() {
  return (
    <div className="mt-10 rounded-lg border border-border bg-card p-6">
      <h1 className="text-2xl font-bold tracking-[-0.02em] text-foreground sm:text-3xl">
        That order link is invalid
      </h1>
      <HeaderRule />
      <p className="mt-4 text-sm text-muted-foreground">
        The link you followed doesn’t look like a valid order number.
      </p>
      <div className="mt-4">
        <Button variant="outline" size="sm" asChild>
          <a href="/waiter">Back to all orders</a>
        </Button>
      </div>
    </div>
  )
}

/**
 * OrderComplaintBadge — small "Open" pill in the header.
 *
 * Same shape as the list row's OrderComplaintIndicator (which
 * is local to /waiter); a 404 lands as absence, any other
 * error renders nothing. The detail page already has the
 * complaint-fetching hook in flight via useComplaint, so this
 * is a tiny presentational component that just reads its
 * result and renders (or doesn't). Kept local to this file
 * rather than promoted to shared/ because the list row uses
 * a slightly different shape (the list wraps it in a flex
 * gap) — the shared version would need a wrapper, and
 * duplicating 6 lines is cheaper.
 */
function OrderComplaintBadge({ orderId }: { orderId: number }) {
  const query = useComplaint(orderId)
  if (query.isError) return null
  if (query.isPending) return null
  if (query.data?.status !== "Open") return null
  return <ComplaintStatusBadge status="Open" />
}

/**
 * ActionGroup — the three waiter actions rendered as a group.
 *
 * Each button is rendered unconditionally; the predicate from
 * lib/order-utils decides enabled vs disabled, and the
 * `disabledReason` prop on the shared buttons surfaces the
 * why-not as muted text directly under the label.
 *
 * Why all three render even when disabled (rather than
 * filtering the unavailable ones out): the list page picks
 * one-of-three by priority; this page is the *full-control*
 * surface, so the waiter benefits from seeing every action
 * with its current blocker. A "Mark served — 2 lines still
 * preparing" hint is more legible than a missing button, and
 * it costs one short line of text per unavailable action.
 *
 * The actions share the existing canClaim / canDelay / isTerminal
 * predicates from lib/order-utils (same predicates the list
 * page uses). canServe is computed inline because it has no
 * library export yet — the predicate is "claimed by me +
 * all_lines_ready + non-terminal", which mirrors
 * MarkServedButton's enable rules (see components/shared/
 * mark-served-button.tsx header).
 */
function ActionGroup({
  order,
  userPid,
  queryClient,
}: {
  order: OrderRead
  userPid: number | undefined
  queryClient: ReturnType<typeof useQueryClient>
}) {
  const claimable = canClaim(order)
  const delayable = canDelay(order, userPid)
  const serveable =
    !isTerminal(order.status) &&
    order.all_lines_ready &&
    typeof order.waiter_id === "number" &&
    order.waiter_id === userPid

  // Per-action disabled reasons. These are pre-computed so
  // the JSX stays flat — each <ClaimButton> / etc. gets either
  // an active state or a disabled-with-reason state.
  const claimDisabledReason = !claimable
    ? order.waiter_id !== null
      ? `Claimed by #${order.waiter_id}`
      : isTerminal(order.status)
        ? "Order is already closed."
        : "Not claimable."
    : undefined
  const delayDisabledReason = !delayable
    ? isTerminal(order.status)
      ? "Order is already closed."
      : order.waiter_id !== null && order.waiter_id !== userPid
        ? `Claimed by #${order.waiter_id}`
        : "Not your order to manage."
    : undefined
  const serveDisabledReason = !serveable
    ? isTerminal(order.status)
      ? "Order is already closed."
      : !order.all_lines_ready
        ? "Not all lines are ready."
        : order.waiter_id !== userPid
          ? "Not your order to mark served."
          : "Not eligible to mark served."
    : undefined

  return (
    <div className="flex flex-wrap items-start gap-2">
      <ClaimButton
        order={order}
        queryClient={queryClient}
        userPid={userPid}
        disabled={!claimable}
        disabledReason={claimDisabledReason}
      />
      <MarkDelayedButton
        order={order}
        queryClient={queryClient}
        disabled={!delayable}
        disabledReason={delayDisabledReason}
      />
      <MarkServedButton
        order={order}
        queryClient={queryClient}
        disabled={!serveable}
        disabledReason={serveDisabledReason}
      />
    </div>
  )
}

function OrderView({ order }: { order: OrderRead }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const userPid = user?.pid
  const itemCount = useMemo(
    () => order.items.reduce((n, l) => n + l.quantity, 0),
    [order.items],
  )
  const stepperStates: Record<OrderStepperNodeId, "done" | "current" | "pending"> =
    useMemo(
      () =>
        deriveStepperStates(
          order.waiter_id !== null,
          order.all_lines_ready,
          order.status === "Served",
        ),
      [order.waiter_id, order.all_lines_ready, order.status],
    )

  // Cancelled short-circuit — same shape as the customer page.
  // No action group (the order is over); the items card and
  // back link render as they do on the live branch.
  if (order.status === "Cancelled") {
    return (
      <>
        <CancelledCard order={order} />
        <Card size="sm" className="mt-3">
          <CardHeader>
            <CardTitle>Items</CardTitle>
            <CardDescription>
              {itemCount} item{itemCount === 1 ? "" : "s"} across{" "}
              {order.items.length} line{order.items.length === 1 ? "" : "s"}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-border">
              {order.items.map((line) => (
                <OrderLineRow
                  key={`${line.order_id}-${line.menu_item_id}`}
                  line={line}
                />
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
              <span className="text-sm font-semibold text-foreground">
                Total
              </span>
              <span className="text-lg font-bold tabular-nums text-foreground">
                {formatPrice(order.total_amount)}
              </span>
            </div>
          </CardContent>
        </Card>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <Button variant="outline" size="sm" asChild>
            <a href="/waiter">Back to all orders</a>
          </Button>
        </div>
      </>
    )
  }

  return (
    <>
      <header aria-live="polite">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-[-0.02em] text-foreground sm:text-3xl">
            Order #{order.id}
          </h1>
          <OrderStatusBadge status={order.status} />
          <OrderComplaintBadge orderId={order.id} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {order.waiter_id === userPid
            ? "You are managing this order."
            : order.waiter_id !== null
              ? `Managed by waiter #${order.waiter_id}.`
              : "Unclaimed — claim it below to take ownership."}
        </p>
        <HeaderRule />
      </header>

      <Card size="sm" className="mt-6">
        <CardHeader>
          <CardTitle>Progress</CardTitle>
        </CardHeader>
        <CardContent>
          <OrderStepper
            states={stepperStates}
            isDelayed={order.status === "Delayed"}
          />
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Card size="sm">
          <CardHeader>
            <div className="flex items-start gap-2">
              <Clock
                aria-hidden="true"
                className="mt-0.5 size-4 text-amber-700 dark:text-amber-300"
              />
              <div>
                <CardTitle>Estimated wait</CardTitle>
                <CardDescription>
                  {order.estimated_wait_time} minute
                  {order.estimated_wait_time === 1 ? "" : "s"}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <div className="flex items-start gap-2">
              <Receipt
                aria-hidden="true"
                className="mt-0.5 size-4 text-amber-700 dark:text-amber-300"
              />
              <div>
                <CardTitle>Placed</CardTitle>
                <CardDescription>
                  {formatOrderDate(order.order_date)}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
        </Card>
      </div>

      {/*
        Items card with the action group in the header. The
        action group sits in the top-right so the card's body
        (line list + total) reads as the data, and the actions
        are the chrome — the opposite of the customer page,
        where the card body is the only thing.
      */}
      <Card size="sm" className="mt-3">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <CardTitle>Items</CardTitle>
              <CardDescription>
                {itemCount} item{itemCount === 1 ? "" : "s"} across{" "}
                {order.items.length} line{order.items.length === 1 ? "" : "s"}.
              </CardDescription>
              <div className="pt-1">
                <LinesProgressSummary order={order} />
              </div>
            </div>
            <ActionGroup
              order={order}
              userPid={userPid}
              queryClient={queryClient}
            />
          </div>
        </CardHeader>
        <CardContent>
          <div className="divide-y divide-border">
            {order.items.map((line) => (
              <OrderLineRow
                key={`${line.order_id}-${line.menu_item_id}`}
                line={line}
              />
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
            <span className="text-sm font-semibold text-foreground">
              Total
            </span>
            <span
              className="text-lg font-bold tabular-nums text-foreground"
              aria-live="polite"
            >
              {formatPrice(order.total_amount)}
            </span>
          </div>
        </CardContent>
      </Card>

      {/*
        Back link to /waiter. The list page is the natural
        sibling — waiters navigate back to the operational
        dashboard after handling a single order, not to a
        separate "my orders" history (the list IS the
        history; the page title there is "Orders").
      */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/waiter"
          className="text-sm font-medium text-amber-700 outline-none hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm dark:text-amber-300"
        >
          ← Back to all orders
        </Link>
        <p className="text-xs text-muted-foreground">
          {order.customer_id
            ? `Customer #${order.customer_id}`
            : "Customer id unavailable"}
        </p>
      </div>
    </>
  )
}

function OrderDashboard() {
  const params = useParams<{ orderId: string }>()
  const orderIdParam = params?.orderId
  const orderId = useMemo(() => {
    if (typeof orderIdParam !== "string") return undefined
    const n = Number(orderIdParam)
    return Number.isFinite(n) ? n : undefined
  }, [orderIdParam])
  const query = useOrder(orderId)

  if (orderId === undefined) {
    return <InvalidIdState />
  }

  if (query.isPending) {
    return <OrderSkeleton />
  }

  if (query.isError) {
    return (
      <>
        <h1 className="text-2xl font-bold tracking-[-0.02em] text-foreground sm:text-3xl">
          Order
        </h1>
        <HeaderRule />
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      </>
    )
  }

  if (!query.data) {
    return <OrderSkeleton />
  }

  return <OrderView order={query.data} />
}

export default function WaiterOrderPage() {
  return (
    <RouteGuard allowedRoles={["waiter"]}>
      <OrderDashboard />
    </RouteGuard>
  )
}
