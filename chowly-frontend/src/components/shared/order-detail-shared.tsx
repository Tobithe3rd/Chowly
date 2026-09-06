"use client"

/**
 * Shared helpers for the staff-side order detail pages.
 *
 * The waiter detail page (src/app/(app)/waiter/orders/[orderId]/
 * page.tsx) and the admin detail page (src/app/(app)/admin/orders/
 * [orderId]/page.tsx) render the same body — header + stepper +
 * estimated-wait + items card with action group + back link —
 * with three role-driven differences:
 *
 *   - RouteGuard allowedRoles: ["waiter"] vs ["admin"].
 *   - Header copy: waiter page talks about "you" / "managed by
 *     {waiter_name}"; admin page reads as a manager review.
 *   - ActionGroup's Served-override: admins can mark served
 *     regardless of all_lines_ready (the backend permits it at
 *     routers/orders.py:204-216); waiters can only mark served
 *     when all lines are ready. The `isAdmin` prop on
 *     ActionGroup flips that predicate.
 *
 * The customer detail page has its own local helpers — its
 * `OrderLineRow` says "Claimed" (no chef/bartender naming)
 * and its `CancelledCard` has no `cancelled_by_name`
 * attribution. That page is intentionally customer-flavored
 * and does not consume this module. (See the comment at
 * the customer file's local OrderLineRow.)
 *
 * Helpers exported:
 *   - OrderLineRow       — per-line view; names the chef or
 *                          bartender who claimed the line.
 *   - LinesProgressSummary — "N of M lines ready" hint.
 *   - CancelledCard      — short-circuit for cancelled orders,
 *                          including cancelled-by attribution.
 *   - OrderSkeleton      — loading placeholder.
 *   - ErrorState         — non-2xx / network error card.
 *   - InvalidIdState     — bad URL id (non-numeric).
 *   - OrderComplaintBadge — header pill, fetches via
 *                          useComplaint; 404 → absence.
 *   - ActionGroup        — Claim / Mark delayed / Mark served
 *                          button row, with isAdmin override.
 *   - formatPrice        — USD currency format.
 *   - formatOrderDate    — medium date + short time.
 *   - HeaderRule         — decorative amber rule under headers.
 *
 * Consumers import what they need. Each call site is the
 * "thin" page (route + data flow + role-driven header); the
 * body and chrome are this module.
 */

import { useQueryClient, type QueryClient } from "@tanstack/react-query"

import { ClaimButton } from "@/components/shared/claim-button"
import { ComplaintStatusBadge } from "@/components/shared/complaint-status-badge"
import { LineReadyBadge } from "@/components/shared/line-ready-badge"
import { MarkDelayedButton } from "@/components/shared/mark-delayed-button"
import { MarkServedButton } from "@/components/shared/mark-served-button"
import { OrderStatusBadge } from "@/components/shared/order-status-badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useComplaint } from "@/hooks/use-complaint"
import { canClaim, canDelay, isTerminal } from "@/lib/order-utils"
import { ApiError } from "@/lib/api-error"
import type { OrderItemRead, OrderRead } from "@/types"

// --- Formatters ------------------------------------------------------------

const CURRENCY = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
})

export function formatPrice(amount: number): string {
  return CURRENCY.format(amount)
}

export function formatOrderDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d)
}

export function HeaderRule() {
  return (
    <div
      aria-hidden="true"
      className="mt-4 h-px w-full bg-amber-200/70 dark:bg-amber-400/30"
    />
  )
}

// --- Per-line row ----------------------------------------------------------

/**
 * OrderLineRow — the staff's per-line view.
 *
 * Identical to the customer detail's OrderLineRow except the
 * Claimed chip names the claiming role AND the claiming staff
 * member: "Claimed by chef" / "Claimed by bartender" plus the
 * chef_name / bartender_name joined from the profile table. When
 * neither chef_id nor bartender_id is set, falls through to a muted
 * "Preparing" label.
 *
 * Why a copy rather than an import from the customer page: the
 * customer page's row is intentionally customer-flavored (just
 * "Claimed"); the staff view needs the role hint, which would
 * add a prop to the shared version and complicate the customer
 * page. Two near-identical files is cheaper than a parameterized
 * one with a role-conditional branch.
 */
export function OrderLineRow({ line }: { line: OrderItemRead }) {
  const claimedByChef = line.chef_id !== null
  const claimedByBartender = line.bartender_id !== null
  const claimed = claimedByChef || claimedByBartender
  const isReady = line.status === "Ready"
  // Chef and bartender never both claim the same line (an
  // OrderItem is one or the other based on item_type), so the
  // exclusive if/else is the right shape, not a stacked list.
  // chef_name / bartender_name are non-null whenever the
  // matching id is non-null (the FK points at the same row);
  // the `?? "..."` fallback is defense for any future data
  // path that leaves a name null while keeping the id.
  const claimedLabel = claimedByChef
    ? `Claimed by chef ${line.chef_name ?? `#${line.chef_id}`}`
    : claimedByBartender
      ? `Claimed by bartender ${line.bartender_name ?? `#${line.bartender_id}`}`
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

// --- Progress summary ------------------------------------------------------

export function LinesProgressSummary({ order }: { order: OrderRead }) {
  const total = order.items.length
  const ready = order.items.filter((l) => l.status === "Ready").length
  if (ready <= 0 || ready >= total) return null
  return (
    <p className="text-xs font-medium text-muted-foreground">
      {ready} of {total} line{total === 1 ? "" : "s"} ready
    </p>
  )
}

// --- Cancelled card --------------------------------------------------------

export function CancelledCard({ order }: { order: OrderRead }) {
  // cancelled_at and cancelled_by_name are populated by the
  // PATCH /orders/{id} handler in the same write that flips
  // status to Cancelled (routers/orders.py:update_order), so
  // a non-cancelled order never reaches this branch. The
  // null-check on cancelled_at is a defense in case a future
  // Cancelled order row was migrated without attribution
  // (no backfill was written for the seed path); when the
  // column is null, the attribution line falls back to
  // "cancelled at unknown time" so the operator still sees
  // a useful description.
  const cancelledAt = order.cancelled_at
    ? formatOrderDate(order.cancelled_at)
    : "unknown time"
  const cancelledBy = order.cancelled_by_name
    ?? (order.cancelled_by_user_id !== null
      ? `user #${order.cancelled_by_user_id}`
      : "an unknown user")
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
              Placed {formatOrderDate(order.order_date)} · Cancelled by {cancelledBy} at {cancelledAt}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
    </Card>
  )
}

// --- Loading / error / invalid-id states -----------------------------------

export function OrderSkeleton() {
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

export function ErrorState({
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

/**
 * InvalidIdState — bad URL id (non-numeric).
 *
 * `backHref` is parameterized so the same shape can be reused
 * for both the waiter detail (back to /waiter) and the admin
 * detail (back to /admin). The body copy is otherwise generic.
 */
export function InvalidIdState({ backHref }: { backHref: string }) {
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
          <a href={backHref}>Back to all orders</a>
        </Button>
      </div>
    </div>
  )
}

// --- Header complaint pill -------------------------------------------------

/**
 * OrderComplaintBadge — small "Open" pill in the header.
 *
 * Same shape as the list row's OrderComplaintIndicator (which
 * is local to /waiter); a 404 lands as absence, any other
 * error renders nothing. The detail page already has the
 * complaint-fetching hook in flight via useComplaint, so this
 * is a tiny presentational component that just reads its
 * result and renders (or doesn't). Kept in this module rather
 * than promoted to a top-level shared/ because the list row
 * uses a slightly different shape (the list wraps it in a flex
 * gap) — the shared version would need a wrapper, and
 * duplicating 6 lines is cheaper.
 */
export function OrderComplaintBadge({ orderId }: { orderId: number }) {
  const query = useComplaint(orderId)
  if (query.isError) return null
  if (query.isPending) return null
  if (query.data?.status !== "Open") return null
  return <ComplaintStatusBadge status="Open" />
}

// --- Action group ----------------------------------------------------------

/**
 * ActionGroup — the three staff actions rendered as a group.
 *
 * Each button is rendered unconditionally; the predicate from
 * lib/order-utils decides enabled vs disabled, and the
 * `disabledReason` prop on the shared buttons surfaces the
 * why-not as muted text directly under the label.
 *
 * Why all three render even when disabled (rather than
 * filtering the unavailable ones out): the list page picks
 * one-of-three by priority; the detail page is the *full-control*
 * surface, so the operator benefits from seeing every action
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
 *
 * Admin override: when isAdmin is true, the canServe predicate
 * relaxes to "non-terminal" only. The backend (routers/orders.py:
 * 204-216) lets an admin PATCH status=Served even when
 * all_lines_ready is false; the button just reflects that. The
 * other two predicates are unchanged: claim is still blocked
 * when another waiter owns the order, delay still requires the
 * current user to be the claimer (admin doesn't pretend to be
 * the claimer). Those restrictions keep the admin's review
 * surface honest about the operational state.
 */
export function ActionGroup({
  order,
  userPid,
  queryClient,
  isAdmin = false,
}: {
  order: OrderRead
  userPid: number | undefined
  queryClient: QueryClient
  isAdmin?: boolean
}) {
  const claimable = canClaim(order)
  const delayable = canDelay(order, userPid)
  // Waiter: claimed-by-me + all_lines_ready + non-terminal.
  // Admin: non-terminal only (server allows the override).
  const serveable =
    !isTerminal(order.status) &&
    (isAdmin || (order.all_lines_ready && order.waiter_id === userPid))

  // Per-action disabled reasons. These are pre-computed so
  // the JSX stays flat — each <ClaimButton> / etc. gets either
  // an active state or a disabled-with-reason state.
  // waiter_name is null on unclaimed orders, so the
  // `?? "#N"` fallback only fires on a data-inconsistency
  // path (id set, name null) — the type is `string | null`
  // because the Order waiter_id is nullable.
  const claimedByLabel = `Claimed by ${order.waiter_name ?? `#${order.waiter_id}`}`
  const claimDisabledReason = !claimable
    ? order.waiter_id !== null
      ? claimedByLabel
      : isTerminal(order.status)
        ? "Order is already closed."
        : "Not claimable."
    : undefined
  const delayDisabledReason = !delayable
    ? isTerminal(order.status)
      ? "Order is already closed."
      : order.waiter_id !== null && order.waiter_id !== userPid
        ? claimedByLabel
        : "Not your order to manage."
    : undefined
  const serveDisabledReason = !serveable
    ? isTerminal(order.status)
      ? "Order is already closed."
      : isAdmin
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

// We re-export useQueryClient so consumers can grab one from a
// single import. The waiter file already used useQueryClient()
// inline; this export keeps the new shared module's surface
// small without dragging the hook in.
export { useQueryClient }
