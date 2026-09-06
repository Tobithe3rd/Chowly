"use client"

/**
 * /admin/orders/[orderId] — the admin's order detail page.
 *
 * A manager review surface. Mirrors the waiter's detail page
 * (header + stepper + estimated-wait + items card with action
 * group + back link) with three role-driven differences:
 *
 *   1. RouteGuard: allowedRoles={["admin"]} instead of
 *      {["waiter"]}. Same one-line shape, no special-casing.
 *      A non-admin who lands here is bounced to their own
 *      home via getRoleHome(user.role).
 *   2. Header retarget: the subline reads as a manager review
 *      ("Admin review · managed by {name}" or "Admin review ·
 *      unclaimed") rather than the waiter's "You are managing
 *      this order / Managed by {name}". The admin doesn't
 *      claim orders from this page; this view is for reading
 *      + acting on the Served override.
 *   3. ActionGroup: passed isAdmin={true}. The Mark-served
 *      button's predicate relaxes from "all_lines_ready +
 *      claimed-by-me + non-terminal" to just "non-terminal" —
 *      the backend (routers/orders.py:204-216) lets an admin
 *      PATCH status=Served even when all_lines_ready is false,
 *      so the button reflects that. Claim and Mark-delayed
 *      stay conservative (admin doesn't claim orders from
 *      here; admin's reassign-waiter flow is its own future
 *      step).
 *
 * The shared body helpers (OrderLineRow, LinesProgressSummary,
 * CancelledCard, OrderSkeleton, ErrorState, InvalidIdState,
 * OrderComplaintBadge, ActionGroup, formatPrice, formatOrderDate,
 * HeaderRule) live in components/shared/order-detail-shared.tsx
 * — same import surface as the waiter page. The customer detail
 * page is intentionally customer-flavored and does not consume
 * the shared module.
 *
 * Data flow: useOrder(orderId) → GET /orders/{id}, which the
 * backend admits admin tenant-scoped (routers/orders.py:489-508:
 * the `else: tenant-scoped` branch under get_order). Same hook,
 * same shape as the waiter page; this page just reads more
 * (waiter_id, all_lines_ready, cancelled_by_*) to surface the
 * audit-trail copy and to drive the admin's Served override.
 *
 * Polling: useOrder polls every 25s with a terminal-pause,
 * same as the waiter page. After a Mark-served mutation the
 * button's onSuccess invalidates ["order", id] and the 25s
 * poll picks up the new state — or an explicit refetch via
 * "Try again" if the admin is impatient.
 */

import { useMemo } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { Clock, Receipt } from "lucide-react"

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

  // Cancelled short-circuit — same shape as the waiter and
  // customer pages. No action group (the order is over); the
  // items card and back link render as they do on the live
  // branch. The CancelledCard's "Cancelled by {name} · {time}"
  // copy is the audit-trail signal — when an admin lands on a
  // cancelled order, they should see who closed it.
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
            href="/admin"
            className="text-sm font-medium text-amber-700 outline-none hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm dark:text-amber-300"
          >
            ← Back to admin
          </Link>
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
          {order.waiter_id !== null
            ? `Admin review · managed by ${order.waiter_name ?? `waiter #${order.waiter_id}`}.`
            : "Admin review · unclaimed."}
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
        are the chrome.

        isAdmin={true}: the Mark-served predicate relaxes to
        "non-terminal only" (the backend allows admin to
        override all_lines_ready at routers/orders.py:204-216).
        Claim and Mark-delayed stay conservative; admin's
        reassign-waiter flow is a future step.
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
              isAdmin
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
        Back link to /admin. The admin's home is where the
        complaints list and recent-orders section live; the
        detail page is the drill-in sibling, not a separate
        history.
      */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/admin"
          className="text-sm font-medium text-amber-700 outline-none hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm dark:text-amber-300"
        >
          ← Back to admin
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
    return <InvalidIdState backHref="/admin" />
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

export default function AdminOrderPage() {
  return (
    <RouteGuard allowedRoles={["admin"]}>
      <OrderDashboard />
    </RouteGuard>
  )
}
