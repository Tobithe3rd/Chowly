"use client"

/**
 * /waiter/orders/[orderId] — the waiter's order detail page.
 *
 * The single-action row on /waiter is a fast scan lane — one
 * button at a time, mutually exclusive by state. This page is
 * the *full-control* sibling: when a waiter wants to see the
 * whole order and apply the right action, they come here.
 *
 * Reuse vs the admin detail page: ~90% of the body is
 * shared. The shape (header + stepper + estimated-wait + items
 * + back link) is identical, with three role-driven changes:
 *
 *   1. RouteGuard: allowedRoles={["waiter"]} instead of
 *      {["admin"]}. Same one-line shape, no special-casing.
 *   2. Header retarget: H1 is "Order #N" (not "Order #N —
 *      managed by admin"), the back link is "Back to all
 *      orders" pointing to /waiter (not /admin), and the
 *      "Managed by {name}" subline references a waiter rather
 *      than a manager review posture.
 *   3. Action group: ActionGroup (from components/shared/
 *      order-detail-shared.tsx) is invoked with isAdmin
 *      omitted (default false), so the Served button respects
 *      the all_lines_ready gate. The admin detail page passes
 *      isAdmin={true} and bypasses that gate — the backend
 *      (routers/orders.py:204-216) permits the override; the
 *      button just reflects it.
 *
 * The shared body helpers (OrderLineRow, LinesProgressSummary,
 * CancelledCard, OrderSkeleton, ErrorState, InvalidIdState,
 * OrderComplaintBadge, ActionGroup, formatPrice, formatOrderDate,
 * HeaderRule) live in components/shared/order-detail-shared.tsx
 * and are imported here and on the admin detail page. The
 * customer detail page has its own customer-flavored variants
 * and does not consume the shared module.
 *
 * Data flow: useOrder(orderId) → GET /orders/{id}, which the
 * backend already admits staff at the same restaurant
 * (routers/orders.py:482-508). Same hook, same shape as the
 * admin page; the page just reads more off the response
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

import { useMemo } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"

import {
  ActionGroup,
  CancelledCard,
  ErrorState,
  formatOrderDate,
  formatPrice,
  HeaderRule,
  InvalidIdState,
  LinesProgressSummary,
  OrderComplaintBadge,
  OrderLineRow,
  OrderSkeleton,
} from "@/components/shared/order-detail-shared"
import {
  deriveStepperStates,
  OrderStepper,
  type OrderStepperNodeId,
} from "@/components/shared/order-stepper"
import { OrderStatusBadge } from "@/components/shared/order-status-badge"
import { RouteGuard } from "@/components/shared/route-guard"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useQueryClient } from "@tanstack/react-query"
import { Clock, Receipt } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { useOrder } from "@/hooks/use-order"
import type { OrderRead } from "@/types"

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
          <Link
            href="/waiter"
            className="text-sm font-medium text-brand-soft-foreground outline-none hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm dark:text-brand-soft-foreground"
          >
            ← Back to all orders
          </Link>
        </div>
      </>
    )
  }

  return (
    <>
      <header aria-live="polite">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-extrabold tracking-[-0.03em] text-foreground sm:text-4xl">
            Order #{order.id}
          </h1>
          <OrderStatusBadge status={order.status} />
          <OrderComplaintBadge orderId={order.id} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {order.waiter_id === userPid
            ? "You are managing this order."
            : order.waiter_id !== null
              ? `Managed by ${order.waiter_name ?? `waiter #${order.waiter_id}`}.`
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
                className="mt-0.5 size-4 text-brand-soft-foreground dark:text-brand-soft-foreground"
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
                className="mt-0.5 size-4 text-brand-soft-foreground dark:text-brand-soft-foreground"
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

        isAdmin is omitted (default false), so the Served
        button respects the all_lines_ready gate. The admin
        detail page passes isAdmin={true} to bypass that gate;
        the backend (routers/orders.py:204-216) permits the
        override.
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
          className="text-sm font-medium text-brand-soft-foreground outline-none hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm dark:text-brand-soft-foreground"
        >
          ← Back to all orders
        </Link>
        <p className="text-xs text-muted-foreground">
          {order.customer_name}
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
    return <InvalidIdState backHref="/waiter" />
  }

  if (query.isPending) {
    return <OrderSkeleton />
  }

  if (query.isError) {
    return (
      <>
        <h1 className="text-3xl font-extrabold tracking-[-0.03em] text-foreground sm:text-4xl">
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
