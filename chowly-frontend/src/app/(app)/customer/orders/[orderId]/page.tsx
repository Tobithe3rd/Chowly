"use client"

/**
 * /customer/orders/[orderId] — order confirmation view.
 *
 * This is the page a customer lands on immediately after placing
 * an order (CartButton's onSuccess navigates here) and the
 * canonical "I just want to see my order" destination. It is a
 * single-order read view; the future order-history list lives at
 * a different route.
 *
 * Data flow: useParams() gives us the route segment. We parse it
 * to a number; if the URL is malformed we render a static
 * "not found" state without firing a request. Otherwise useOrder
 * fetches GET /orders/{id} and we render the Skeleton/Error/data
 * pattern established on /customer.
 *
 * Status badge color-coding mirrors the role chip palette in
 * (app)/layout.tsx: each status gets a light tint + a 200 ring,
 * dark variants included. The status is the page's "you are here"
 * signal, so it carries the chromatic weight — same as the role
 * badge in the topbar.
 */

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { Ban, Clock, Loader2, MessageSquareWarning, Receipt, Star } from "lucide-react"

import { ComplaintStatusBadge } from "@/components/shared/complaint-status-badge"
import { LineReadyBadge } from "@/components/shared/line-ready-badge"
import { RouteGuard } from "@/components/shared/route-guard"
import { OrderStatusBadge } from "@/components/shared/order-status-badge"
import {
  deriveStepperStates,
  OrderStepper,
  type OrderStepperNodeId,
} from "@/components/shared/order-stepper"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { useCancelOrder } from "@/hooks/use-cancel-order"
import { useComplaint } from "@/hooks/use-complaint"
import { useFileComplaint } from "@/hooks/use-file-complaint"
import { useFileRating } from "@/hooks/use-file-rating"
import { useOrder } from "@/hooks/use-order"
import { useRating } from "@/hooks/use-rating"
import { ApiError, describeError } from "@/lib/api-error"
import type {
  ComplaintRead,
  OrderItemRead,
  OrderRead,
  OrderStatus,
  RatingRead,
} from "@/types"

const CURRENCY = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
})

function formatPrice(amount: number): string {
  return CURRENCY.format(amount)
}

/**
 * Per-status verb for the "Your order is being prepared" sentence
 * under the header. The color language lives in the shared
 * `<OrderStatusBadge>`; only the verb stays here because it's
 * a one-off for this page's heading copy.
 */
const STATUS_VERB: Record<OrderStatus, string> = {
  "In Preparation": "is being prepared",
  Delayed: "is running late",
  Served: "has been served",
  Cancelled: "was cancelled",
}

function formatOrderDate(iso: string): string {
  // `iso` is an ISO 8601 datetime. Render in the viewer's
  // locale as a short date + time. We don't reach for a date
  // library — Intl.DateTimeFormat does the right thing for the
  // demo and avoids a dependency for a single use.
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d)
}

/**
 * formatTime — time-only rendering, used by the cancel card's
 * "Cancellable until HH:MM" line.
 *
 * Separate from formatOrderDate because the cancel card
 * intentionally surfaces only the time, not the full date —
 * the user just placed the order, so the date is in the
 * "Placed" card and adding it again would be visual noise.
 * `timeStyle: "short"` is the locale's short time (e.g.
 * "12:34 PM" in en-US, "12:34" in en-GB); Intl handles the
 * AM/PM-vs-24h choice from the viewer's locale.
 */
function formatTime(d: Date): string {
  if (Number.isNaN(d.getTime())) return ""
  return new Intl.DateTimeFormat(undefined, {
    timeStyle: "short",
  }).format(d)
}

/**
 * CUSTOMER_CANCEL_WINDOW_MS — the cancel window, in
 * milliseconds, mirrored from the backend's
 * `CUSTOMER_CANCEL_WINDOW = timedelta(minutes=10)` at
 * routers/orders.py. The frontend uses this for two things:
 *   - "Cancellable until HH:MM" timestamp display.
 *   - Disabling the cancel button when the window has passed
 *     (the server is still the source of truth; this is a
 *     hint, not a security boundary).
 * The two values must stay in sync; a backend change here
 * requires a frontend change at the same commit.
 */
const CUSTOMER_CANCEL_WINDOW_MS = 10 * 60 * 1000

/**
 * formatFeedbackDate — same shape as formatOrderDate, kept as a
 * separate helper so the two call sites stay self-documenting.
 * Used by FeedbackCard's "Filed [date]" footers (complaint_date
 * and rating_date).
 */
function formatFeedbackDate(iso: string): string {
  return formatOrderDate(iso)
}

function HeaderRule() {
  return (
    <div
      aria-hidden="true"
      className="mt-4 h-px w-full bg-brand/30 dark:bg-brand-soft"
    />
  )
}

/**
 * OrderLineRow — a single line on the order detail page.
 *
 * Three states the customer sees for each line:
 *   - Ready   — emerald "Ready" pill (LineReadyBadge).
 *   - Preparing, claimed by a chef or bartender — a small
 *     "Claimed" pill so the customer knows work has started.
 *   - Preparing, not yet claimed — muted "Preparing" label
 *     ("no news is good news"; we don't shout).
 *
 * The "Claimed" pill is intentional color-neutral (sky), not
 * emerald: it represents *in-progress* work, not completion.
 * Reusing the OrderStatusBadge palette means the same
 * sky-=in-flight / emerald-=done language carries here, so
 * the customer doesn't have to learn a second set of chips.
 *
 * `menu_item_name` is joined on the backend; no client-side
 * menu lookup is needed.
 */
function OrderLineRow({ line }: { line: OrderItemRead }) {
  const claimed = line.chef_id !== null || line.bartender_id !== null
  const isReady = line.status === "Ready"
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
              Claimed
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

/**
 * LinesProgressSummary — a one-line "N of M lines ready" hint
 * that sits between the stepper and the per-line list.
 *
 * Only renders when the count is *partial* (1 ≤ ready < total).
 * At 0 the per-line list already shows "Preparing" everywhere;
 * at total the stepper's third node is already emerald, so the
 * line would be redundant. The summary is the bridge between
 * those two states.
 *
 * The text is the customer's only explicit "the kitchen is
 * working on N of your M lines" signal. Without it, partial
 * progress is invisible — a customer staring at a half-Ready
 * list has to count chips to know how much work is left.
 */
function LinesProgressSummary({ order }: { order: OrderRead }) {
  const total = order.items.length
  const ready = order.items.filter((l) => l.status === "Ready").length
  // 0 of N is "the per-line list is all 'Preparing'" (and the
  // stepper's "Lines ready" node is current), N of N is "the
  // stepper's 'Lines ready' node is done". The summary is for
  // the in-between, so we return null at both endpoints.
  if (ready <= 0 || ready >= total) return null
  return (
    <p className="text-xs font-medium text-muted-foreground">
      {ready} of {total} line{total === 1 ? "" : "s"} ready
    </p>
  )
}

/**
 * CancelledCard — the dedicated short-circuit when the order
 * is in the Cancelled terminal state.
 *
 * The four-step stepper doesn't make sense for a cancelled
 * order: there is no "next step" to walk to, and rendering a
 * row of muted pending nodes on top of a rose-tinted status
 * badge would be a contradiction (the order is done, but the
 * last step is still "Served" — neither done nor reachable).
 *
 * Instead, a single rose-tinted card carries the same message
 * the user sees in the OrderStatusBadge ("Order #N was
 * cancelled") and adds the date for context. Mirrors the
 * existing error-state chrome (border + rose tint) so the
 * "this is over" signal reads consistently.
 */
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
  // Per-status copy. A 404 ("order not found / not yours") is a
  // different recovery path than a transient 5xx: the user
  // probably mistyped the id, not lost their network.
  const hint = isApi && error.status === 404
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
  // URL is /customer/orders/abc or similar. Don't even try the
  // network — there's no integer id to send. A back link gets
  // the user out without dead-ending.
  return (
    <div className="mt-10 rounded-lg border border-border bg-card p-6">
      <h1 className="text-3xl font-extrabold tracking-[-0.03em] text-foreground sm:text-4xl">
        That order link is invalid
      </h1>
      <HeaderRule />
      <p className="mt-4 text-sm text-muted-foreground">
        The link you followed doesn’t look like a valid order number.
      </p>
      <div className="mt-4">
        <Button variant="outline" size="sm" asChild>
          <a href="/customer">Back to the menu</a>
        </Button>
      </div>
    </div>
  )
}

function OrderView({ order }: { order: OrderRead }) {
  // `menu_item_name` is joined on each line by the backend, so the
  // rows render the friendly name directly — no client-side menu
  // lookup is needed. We still reduce quantities for the "N items
  // across M lines" summary in the card description.
  const itemCount = useMemo(
    () => order.items.reduce((n, l) => n + l.quantity, 0),
    [order.items],
  )
  // Stepper state is derived in the page (the source of truth is
  // the OrderRead payload), then passed in. The stepper itself is
  // presentational — see components/shared/order-stepper.tsx.
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
  // The Cancelled state is its own surface — a four-step stepper
  // with the final two steps still pending would contradict the
  // rose "this is over" badge. The short-circuit lives here in
  // the page, not the stepper, because the stepper is shared with
  // future order states.
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
        {/*
          Cancelled branch's "View all my orders →" — same shape
          as the live OrderView's back link above. The Cancelled
          short-circuit doesn't render FeedbackCard (cancelled
          orders can't be rated), so the link sits one slot up —
          directly after the items card, paired with the existing
          "Back to the menu" button. Same Next.js Link + amber
          treatment as the live branch so the two render paths
          feel like the same page.
        */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/customer/orders"
            className="text-sm font-medium text-brand-soft-foreground outline-none hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm dark:text-brand-soft-foreground"
          >
            View all my orders →
          </Link>
          <Button variant="outline" size="sm" asChild>
            <a href="/customer">Back to the menu</a>
          </Button>
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
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Your order {STATUS_VERB[order.status]}.
        </p>
        <HeaderRule />
      </header>

      {/*
        Progress stepper card. Carries the order-level "where
        are we" signal in a single horizontal line; mirrors the
        OrderStatusBadge palette so the page doesn't introduce
        a second chromatic system. The Delayed tint is a
        top-level flag passed through to the stepper's current
        node, not a separate node.
      */}
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

      <Card size="sm" className="mt-3">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Items</CardTitle>
              <CardDescription>
                {itemCount} item{itemCount === 1 ? "" : "s"} across{" "}
                {order.items.length} line{order.items.length === 1 ? "" : "s"}.
              </CardDescription>
            </div>
            <div className="pt-1">
              <LinesProgressSummary order={order} />
            </div>
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
        CancelOrderCard sits between the items card and the
        FeedbackCard. The cancel action is "void the order
        before completion" — closer in lifecycle to the
        items card (what's about to be voided) than to the
        FeedbackCard (post-completion feedback). The card
        gates itself to non-terminal orders; in this
        branch the order is non-terminal, so the card
        always renders here.
      */}
      <CancelOrderCard order={order} />

      <FeedbackCard orderId={order.id} />

      {/*
        "View all my orders →" — additive back link to the
        customer's order history. Sits *above* the existing
        "Back to the menu" button (which is right-aligned and
        reads as a primary action); the link is left-aligned,
        text-only, and reads as a secondary "or" — the customer
        can either continue browsing the menu, or jump to the
        full history. Persistent across all order states
        (live, Served, Cancelled) so the customer always has
        the way-back whether the order is in flight or done.

        Next.js Link rather than a plain <a> for client-side
        navigation — the existing "Back to the menu" buttons
        in this file use <a>, but the new code is a fresh
        insertion and Link gives prefetch + soft nav for free
        (the list page is small and prefetch is a win).
      */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/customer/orders"
          className="text-sm font-medium text-brand-soft-foreground outline-none hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm dark:text-brand-soft-foreground"
        >
          View all my orders →
        </Link>
        <Button variant="outline" size="sm" asChild>
          <a href="/customer">Back to the menu</a>
        </Button>
      </div>
    </>
  )
}

// --- FeedbackCard + dialogs ---------------------------------------------

/**
 * StarRow — renders 1-5 stars for a read-only rating display.
 *
 * The first `value` stars are filled with the amber brand color
 * (same family as the page's accent and the role chip), the rest
 * are outline-only at low contrast so the filled stars read as
 * the "active" portion. No click handler — this is the read view.
 * For the interactive picker (in the rating dialog), see
 * RatingStarPicker below — the visual is the same, the click
 * behavior is what differs.
 */
function StarRow({ value }: { value: number }) {
  // Clamp to 1-5 so a stray backend value never renders 0 or
  // 6 stars. Backend-validated, but a defensive clamp is cheap
  // and keeps the render pure.
  const filled = Math.max(1, Math.min(5, Math.round(value)))
  return (
    <div
      className="inline-flex items-center gap-0.5"
      aria-label={`Rated ${filled} out of 5`}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          aria-hidden="true"
          className={
            n <= filled
              ? "size-4 fill-amber-400 text-amber-500"
              : "size-4 text-muted-foreground/40"
          }
        />
      ))}
    </div>
  )
}

/**
 * RatingStarPicker — the interactive 1-5 star picker used in
 * FileRatingDialog.
 *
 * Click sets `value` to the star's index (1-5). Hover previews
 * the fill up to the hovered position without committing the
 * value (commit happens on click). The committed `value` is the
 * source of truth — the hover is a presentation detail.
 */
function RatingStarPicker({
  value,
  hover,
  onChange,
  onHoverChange,
  disabled,
}: {
  value: number
  hover: number
  onChange: (n: number) => void
  onHoverChange: (n: number) => void
  disabled?: boolean
}) {
  // `display` is what we paint: hover takes priority while the
  // pointer is over a star, value otherwise. A value of 0 means
  // "nothing picked yet" and renders all stars outline.
  const display = hover > 0 ? hover : value
  return (
    <div
      className="inline-flex items-center gap-1"
      role="radiogroup"
      aria-label="Rating"
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`Rate ${n} out of 5`}
          disabled={disabled}
          onClick={() => onChange(n)}
          onMouseEnter={() => onHoverChange(n)}
          onMouseLeave={() => onHoverChange(0)}
          onFocus={() => onHoverChange(n)}
          onBlur={() => onHoverChange(0)}
          className="rounded-sm p-0.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Star
            aria-hidden="true"
            className={
              n <= display
                ? "size-7 fill-amber-400 text-amber-500"
                : "size-7 text-muted-foreground/40"
            }
          />
        </button>
      ))}
    </div>
  )
}

/**
 * FeedbackCard — the "Feedback" section on the order detail page.
 *
 * Two sub-sections, complaint and rating, each independently in
 * one of three states: loading, error (non-404), read, or empty.
 * 404 lands as a typed ApiError from useComplaint/useRating and is
 * treated as "absence" (the empty state) rather than an error —
 * the backend deliberately returns 404 to mean "no feedback yet",
 * and the page surfaces that as the "File" CTA.
 *
 * Sub-section layout: label on the left (Complaint / Rating),
 * status/cta on the right. Below the header, the body (text or
 * stars) and a "Filed [date]" footer in muted copy.
 *
 * Dialog state lives in the card so the card is the only
 * place that owns the open/close state. The dialogs themselves
 * are presentational — they receive the orderId and an onFiled
 * callback that invalidates the relevant query so the card
 * re-fetches and the read view appears with the new content.
 */
function FeedbackCard({ orderId }: { orderId: number }) {
  const queryClient = useQueryClient()
  const complaint = useComplaint(orderId)
  const rating = useRating(orderId)

  // One of two dialogs may be open, or none. The discriminated
  // union keeps the two cases from interfering — opening the
  // complaint dialog closes the rating dialog and vice versa.
  const [dialog, setDialog] = useState<
    { kind: "complaint" } | { kind: "rating" } | null
  >(null)

  function invalidateComplaint() {
    queryClient.invalidateQueries({ queryKey: ["complaint", orderId] })
  }
  function invalidateRating() {
    queryClient.invalidateQueries({ queryKey: ["rating", orderId] })
  }

  return (
    <Card size="sm" className="mt-6">
      <CardHeader>
        <div className="flex items-start gap-2">
          <MessageSquareWarning
            aria-hidden="true"
            className="mt-0.5 size-4 text-brand-soft-foreground dark:text-brand-soft-foreground"
          />
          <div>
            <CardTitle>Feedback</CardTitle>
            <CardDescription>
              Let us know how the order went. You can file a complaint
              or rate the experience once.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-5">
          <ComplaintSubSection
            query={complaint}
            onFile={() => setDialog({ kind: "complaint" })}
          />
          <RatingSubSection
            query={rating}
            onFile={() => setDialog({ kind: "rating" })}
          />
        </div>
      </CardContent>

      {/*
        Dialog mounts at the bottom of the card. The card owns
        the open/close state; the dialog is fully driven by props.
        The onFiled callback invalidates the relevant query so the
        card re-fetches — the read view then re-renders with the
        new content. No toast: the inline read view appearing is
        the success signal (same pattern as the cart Sheet's
        onSuccess for place-order).
      */}
      {dialog?.kind === "complaint" ? (
        <FileComplaintDialog
          orderId={orderId}
          onClose={() => setDialog(null)}
          onFiled={() => {
            setDialog(null)
            invalidateComplaint()
          }}
        />
      ) : null}
      {dialog?.kind === "rating" ? (
        <FileRatingDialog
          orderId={orderId}
          onClose={() => setDialog(null)}
          onFiled={() => {
            setDialog(null)
            invalidateRating()
          }}
        />
      ) : null}
    </Card>
  )
}

/**
 * SubSectionRow — the per-sub-section layout shell. Renders a
 * label on the left, a status/CTA on the right, and a body block
 * below. Used by both ComplaintSubSection and RatingSubSection;
 * the body content is the only thing that differs.
 *
 * Why a shell component: the two sub-sections share the same
 * header/footer rhythm and the same loading/error/empty/read
 * state machine. The shell encapsulates the rhythm; the
 * sub-sections pass in the body for the "read" state and the
 * empty-state copy.
 */
function SubSectionRow({
  label,
  rightSlot,
  body,
}: {
  label: string
  rightSlot: React.ReactNode
  body: React.ReactNode
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm font-semibold text-foreground">
          {label}
        </span>
        <div className="flex items-center gap-2">{rightSlot}</div>
      </div>
      <div className="mt-2">{body}</div>
    </div>
  )
}

/**
 * ComplaintSubSection — read, empty, loading, or error state
 * for the complaint on this order.
 *
 * The 404 case (no complaint on file) is treated as absence and
 * renders the empty state, not the error state. 403 (not your
 * order) is treated as a real error — the user navigated to an
 * order they don't own and the action isn't recoverable from
 * this page.
 */
function ComplaintSubSection({
  query,
  onFile,
}: {
  query: ReturnType<typeof useComplaint>
  onFile: () => void
}) {
  if (query.isPending) {
    return (
      <SubSectionRow
        label="Complaint"
        rightSlot={<Skeleton className="h-5 w-16" />}
        body={<Skeleton className="h-4 w-72" />}
      />
    )
  }

  if (query.isError) {
    const is404 =
      query.error instanceof ApiError && query.error.status === 404
    if (is404) {
      return (
        <SubSectionRow
          label="Complaint"
          rightSlot={
            <Button
              variant="outline"
              size="sm"
              onClick={onFile}
              aria-label="File a complaint"
            >
              File a complaint
            </Button>
          }
          body={
            <p className="text-sm text-muted-foreground">
              No complaint on file.
            </p>
          }
        />
      )
    }
    // Non-404 error (403, 500, network) — show inline, not the
    // empty state. The message is the server's detail; if the
    // ApiError detail is empty we fall back to a generic one.
    const message = describeError(
      query.error,
      "Could not load the complaint.",
    )
    const is403 =
      query.error instanceof ApiError && query.error.status === 403
    return (
      <SubSectionRow
        label="Complaint"
        rightSlot={null}
        body={
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2"
          >
            <p className="text-sm text-destructive">{message}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {is403
                ? "You can only see feedback on your own orders."
                : "Try refreshing the page in a moment."}
            </p>
          </div>
        }
      />
    )
  }

  if (!query.data) {
    // Defensive — useQuery with a 2xx always returns data, but
    // the type narrowing is exhaustive on isPending/isError, not
    // on data being present. Render a skeleton to keep the page
    // visually stable.
    return (
      <SubSectionRow
        label="Complaint"
        rightSlot={<Skeleton className="h-5 w-16" />}
        body={<Skeleton className="h-4 w-72" />}
      />
    )
  }

  return (
    <SubSectionRow
      label="Complaint"
      rightSlot={<ComplaintStatusBadge status={query.data.status} />}
      body={<ComplaintBody complaint={query.data} />}
    />
  )
}

function ComplaintBody({ complaint }: { complaint: ComplaintRead }) {
  // The text is preserved with whitespace-pre-wrap so any
  // newlines the user typed survive the round-trip. The
  // "Filed [date]" footer is muted copy under the body.
  return (
    <div>
      <p className="text-sm whitespace-pre-wrap text-foreground">
        {complaint.complaint_text}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        Filed {formatFeedbackDate(complaint.complaint_date)}
      </p>
    </div>
  )
}

/**
 * RatingSubSection — read, empty, loading, or error state for
 * the rating on this order. Same 404-as-absence pattern as
 * ComplaintSubSection.
 */
function RatingSubSection({
  query,
  onFile,
}: {
  query: ReturnType<typeof useRating>
  onFile: () => void
}) {
  if (query.isPending) {
    return (
      <SubSectionRow
        label="Rating"
        rightSlot={<Skeleton className="h-5 w-20" />}
        body={<Skeleton className="h-4 w-48" />}
      />
    )
  }

  if (query.isError) {
    const is404 =
      query.error instanceof ApiError && query.error.status === 404
    if (is404) {
      return (
        <SubSectionRow
          label="Rating"
          rightSlot={
            <Button
              variant="outline"
              size="sm"
              onClick={onFile}
              aria-label="Rate this order"
            >
              Rate this order
            </Button>
          }
          body={
            <p className="text-sm text-muted-foreground">
              No rating on file.
            </p>
          }
        />
      )
    }
    const message = describeError(query.error, "Could not load the rating.")
    const is403 =
      query.error instanceof ApiError && query.error.status === 403
    return (
      <SubSectionRow
        label="Rating"
        rightSlot={null}
        body={
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2"
          >
            <p className="text-sm text-destructive">{message}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {is403
                ? "You can only see feedback on your own orders."
                : "Try refreshing the page in a moment."}
            </p>
          </div>
        }
      />
    )
  }

  if (!query.data) {
    return (
      <SubSectionRow
        label="Rating"
        rightSlot={<Skeleton className="h-5 w-20" />}
        body={<Skeleton className="h-4 w-48" />}
      />
    )
  }

  return (
    <SubSectionRow
      label="Rating"
      rightSlot={<StarRow value={query.data.rating_value} />}
      body={<RatingBody rating={query.data} />}
    />
  )
}

function RatingBody({ rating }: { rating: RatingRead }) {
  return (
    <div>
      {rating.comment ? (
        <p className="text-sm whitespace-pre-wrap text-foreground">
          {rating.comment}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">No comment.</p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Filed {formatFeedbackDate(rating.rating_date)}
      </p>
    </div>
  )
}

// --- Dialogs -------------------------------------------------------------

/**
 * FileComplaintDialog — the "File a complaint" form.
 *
 * Fields: complaint_text (textarea, 1-2000 chars enforced
 * client-side; the backend's Pydantic constraint is the same).
 * The live character count under the textarea gives the user
 * a "approaching the limit" signal before the form locks the
 * submit button.
 *
 * 409 vs other errors: the backend returns 409 ("Order N already
 * has a complaint") on a second submission. The dialog detects
 * that specifically and renders "You've already filed a
 * complaint on this order." — a stable, action-specific message
 * — instead of falling through to the default 409 detail
 * (which is a developer-facing string like "Order 1 already has
 * a complaint (id 1)."). All other errors (422, 500, network)
 * fall through to describeError with the action-specific
 * fallback.
 *
 * The dialog stays open on failure so the user can retry
 * without losing the form contents. On success, the parent
 * closes the dialog and invalidates the complaint query.
 */
function FileComplaintDialog({
  orderId,
  onClose,
  onFiled,
}: {
  orderId: number
  onClose: () => void
  onFiled: () => void
}) {
  const fileComplaint = useFileComplaint()

  const [text, setText] = useState("")
  const [clientError, setClientError] = useState<string | null>(null)

  // Reset the form every time the dialog opens. Without this,
  // re-opening after a successful submit would briefly render
  // the prior value (or after a cancel-and-reopen, the prior
  // half-typed value).
  useEffect(() => {
    setText("")
    setClientError(null)
  }, [])

  const trimmedLength = text.trim().length
  const isPending = fileComplaint.isPending

  function validate(): { ok: true; text: string } | { ok: false; msg: string } {
    if (trimmedLength < 1) {
      return { ok: false, msg: "Please describe your complaint." }
    }
    if (trimmedLength > 2000) {
      return {
        ok: false,
        msg: "Complaint must be 2000 characters or fewer.",
      }
    }
    return { ok: true, text: text.trim() }
  }

  function onSubmit() {
    setClientError(null)
    const v = validate()
    if (!v.ok) {
      setClientError(v.msg)
      return
    }
    fileComplaint.mutate(
      { orderId, body: { complaint_text: v.text } },
      { onSuccess: () => onFiled() },
    )
  }

  // Error precedence: client validation > 409 > describeError.
  // The clientError is set by validate() and clears the
  // mutation's own error display until the user types again.
  // 409 is treated as a distinct user-facing message because
  // "you already filed this" is a different recovery path than
  // "the server rejected your input" — the right next action is
  // to look at the existing complaint, not to retry.
  const is409 =
    fileComplaint.error instanceof ApiError &&
    fileComplaint.error.status === 409
  const errorMessage =
    clientError ??
    (is409
      ? "You've already filed a complaint on this order."
      : describeError(
          fileComplaint.error,
          "Could not file your complaint.",
        ))

  // Submit is enabled when there's content to submit and we're
  // not in flight. The length cap is the same check validate()
  // runs — disable early to keep the visual state in sync with
  // the post-submit state (no flicker from enabled to disabled
  // + error message).
  const canSubmit = trimmedLength > 0 && trimmedLength <= 2000 && !isPending
  const overLimit = text.length > 2000

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>File a complaint</DialogTitle>
          <DialogDescription>
            Tell us what went wrong. We&apos;ll review it and work to
            make it right.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <label
            htmlFor="complaint-text"
            className="text-sm font-medium leading-none"
          >
            What happened?
          </label>
          <Textarea
            id="complaint-text"
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              // Clear any prior client error so the user gets
              // a clean slate while typing. Server errors are
              // not cleared here — they re-render on the next
              // attempt and the user shouldn't see their
              // mutation error vanish before they get to read
              // it.
              if (clientError) setClientError(null)
            }}
            placeholder="Describe the issue…"
            rows={5}
            disabled={isPending}
            aria-invalid={overLimit}
          />
          {/*
            Live character count. Two states: under-the-cap in
            muted copy, over-the-cap in destructive red. The
            over state is the visual signal that the submit is
            about to be blocked — saves the user a click on a
            disabled button to find out why.
          */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              Max 2000 characters.
            </span>
            <span
              className={
                overLimit
                  ? "font-semibold text-destructive tabular-nums"
                  : "text-muted-foreground tabular-nums"
              }
              aria-live="polite"
            >
              {text.length} / 2000
            </span>
          </div>
        </div>

        {/*
          Inline error slot. Same shape as the cart Sheet footer
          and the claim dialogs: role="alert" so the change is
          announced, destructive/30 border + destructive/5
          background for the rose tint. The dialog stays open
          so the user can retry without losing context.
        */}
        {errorMessage ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2"
          >
            <p className="text-sm text-destructive">{errorMessage}</p>
          </div>
        ) : null}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={onSubmit}
            disabled={!canSubmit}
            aria-busy={isPending}
          >
            {isPending ? (
              <>
                <Loader2 aria-hidden="true" className="animate-spin" />
                Filing…
              </>
            ) : (
              "File complaint"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * FileRatingDialog — the "Rate this order" form.
 *
 * Fields: rating_value (1-5, picked via the star picker) and an
 * optional comment (textarea, 0-2000 chars). The picker uses
 * hover preview — the filled stars up to the hovered position
 * are painted, but the committed value only changes on click.
 *
 * 409 vs other errors: same pattern as FileComplaintDialog.
 * The backend returns 409 ("Order N already has a rating") on
 * a second submission; the dialog detects that and renders
 * "You've already rated this order." instead of the raw 409
 * detail. All other errors fall through to describeError.
 */
function FileRatingDialog({
  orderId,
  onClose,
  onFiled,
}: {
  orderId: number
  onClose: () => void
  onFiled: () => void
}) {
  const fileRating = useFileRating()

  const [value, setValue] = useState<number>(0)
  const [hover, setHover] = useState<number>(0)
  const [comment, setComment] = useState("")
  const [clientError, setClientError] = useState<string | null>(null)

  useEffect(() => {
    setValue(0)
    setHover(0)
    setComment("")
    setClientError(null)
  }, [])

  const isPending = fileRating.isPending

  function validate(): { ok: true } | { ok: false; msg: string } {
    if (value < 1 || value > 5) {
      return { ok: false, msg: "Please choose a rating from 1 to 5." }
    }
    if (comment.length > 2000) {
      return { ok: false, msg: "Comment must be 2000 characters or fewer." }
    }
    return { ok: true }
  }

  function onSubmit() {
    setClientError(null)
    const v = validate()
    if (!v.ok) {
      setClientError(v.msg)
      return
    }
    fileRating.mutate(
      {
        orderId,
        body: {
          rating_value: value,
          comment: comment.trim().length === 0 ? null : comment.trim(),
        },
      },
      { onSuccess: () => onFiled() },
    )
  }

  const is409 =
    fileRating.error instanceof ApiError && fileRating.error.status === 409
  const errorMessage =
    clientError ??
    (is409
      ? "You've already rated this order."
      : describeError(fileRating.error, "Could not submit your rating."))

  const canSubmit = value >= 1 && value <= 5 && comment.length <= 2000 && !isPending
  const commentOverLimit = comment.length > 2000

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rate this order</DialogTitle>
          <DialogDescription>
            Pick a star rating and (optionally) tell us why.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium leading-none">
              How was your experience?
            </span>
            <span
              className="text-xs text-muted-foreground tabular-nums"
              aria-live="polite"
            >
              {value > 0 ? `${value} / 5` : "Pick a rating"}
            </span>
          </div>
          <RatingStarPicker
            value={value}
            hover={hover}
            onChange={setValue}
            onHoverChange={setHover}
            disabled={isPending}
          />
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="rating-comment"
            className="text-sm font-medium leading-none"
          >
            Comment{" "}
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              Optional. Up to 2000 characters.
            </span>
          </label>
          <Textarea
            id="rating-comment"
            value={comment}
            onChange={(e) => {
              setComment(e.target.value)
              if (clientError) setClientError(null)
            }}
            placeholder="What stood out about the order?"
            rows={4}
            disabled={isPending}
            aria-invalid={commentOverLimit}
          />
          {commentOverLimit ? (
            <p
              role="alert"
              className="text-xs text-destructive"
            >
              Comment must be 2000 characters or fewer.
            </p>
          ) : null}
        </div>

        {errorMessage ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2"
          >
            <p className="text-sm text-destructive">{errorMessage}</p>
          </div>
        ) : null}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={onSubmit}
            disabled={!canSubmit}
            aria-busy={isPending}
          >
            {isPending ? (
              <>
                <Loader2 aria-hidden="true" className="animate-spin" />
                Submitting…
              </>
            ) : (
              "Submit rating"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// --- CancelOrderCard + dialog --------------------------------------------

/**
 * CancelOrderCard — the "Cancel this order" surface on the
 * customer order detail page.
 *
 * Renders only in the live branch (the OrderView's
 * `order.status !== "Cancelled"` gate and the page-level
 * non-terminal gate above it). A Served order doesn't reach
 * the live branch; a Cancelled order is short-circuited
 * before this component even mounts. The card doesn't
 * duplicate the gate — by the time it renders, the order
 * is non-terminal.
 *
 * Two visible states:
 *   - "Window open" — shows the cancellable-until time and
 *     an enabled Cancel button. Clicking opens the
 *     CancelOrderDialog.
 *   - "Window closed" — shows "Cancellation window has
 *     passed." and a disabled button. The disabled button
 *     is the affordance: the user understands the action is
 *     no longer available without reading a separate error
 *     message, and the server is the source of truth (a
 *     user who manages to click through still gets a 409
 *     from the backend, which the dialog would render — but
 *     the dialog is never opened because the button is
 *     disabled).
 *
 * The "window open" computation is at render time, not
 * live. The page re-renders on each useOrder poll (every
 * 25s while the order is non-terminal), so the card
 * flips from open to closed within at most 25s of the
 * boundary. A user who lingers on the page and clicks the
 * button between the local-clock boundary and the next
 * poll will see a 409 from the server — the dialog
 * handles that case the same way every other dialog does.
 *
 * The card owns its dialog state (the same pattern as
 * FeedbackCard): the dialog mounts only when `open` is
 * true, and unmounts on close — so a successful cancel
 * (which closes the dialog) cleanly drops the dialog
 * element on the same render the order flips to the
 * Cancelled short-circuit.
 */
function CancelOrderCard({ order }: { order: OrderRead }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)

  // The cancellable-until timestamp is order_date + 10
  // minutes (mirrored from the backend's
  // CUSTOMER_CANCEL_WINDOW). Parsed once per render — the
  // order object is the source of truth, and the calculation
  // is cheap (one Date parse + add).
  const orderDateMs = new Date(order.order_date).getTime()
  const cancellableUntil = new Date(
    orderDateMs + CUSTOMER_CANCEL_WINDOW_MS,
  )
  const windowOpen =
    Number.isFinite(orderDateMs) && Date.now() < cancellableUntil.getTime()

  return (
    <Card size="sm" className="mt-6">
      <CardHeader>
        <div className="flex items-start gap-2">
          <Ban
            aria-hidden="true"
            className="mt-0.5 size-4 text-muted-foreground"
          />
          <div>
            <CardTitle>Cancel this order</CardTitle>
            <CardDescription>
              {windowOpen ? (
                <>
                  Cancellable until {formatTime(cancellableUntil)}.
                </>
              ) : (
                <>Cancellation window has passed.</>
              )}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          disabled={!windowOpen}
          aria-label="Cancel this order"
          title={
            windowOpen
              ? undefined
              : "The 10-minute cancellation window has passed."
          }
        >
          Cancel order
        </Button>
      </CardContent>

      {/*
        Dialog mounts at the bottom of the card, same shape
        as FeedbackCard. The card owns the open/close state;
        the dialog is fully driven by props. On a successful
        cancel, the parent invalidates the order query so the
        page re-fetches and the OrderView's Cancelled
        short-circuit takes over.
      */}
      {open ? (
        <CancelOrderDialog
          orderId={order.id}
          onClose={() => setOpen(false)}
          onCancelled={() => {
            setOpen(false)
            queryClient.invalidateQueries({ queryKey: ["order", order.id] })
            queryClient.invalidateQueries({ queryKey: ["orders", "all"] })
          }}
        />
      ) : null}
    </Card>
  )
}

/**
 * CancelOrderDialog — the "are you sure?" prompt for
 * customer-initiated cancellation.
 *
 * No form fields — the action is a single click, and the
 * server is the source of truth for what's legal. The
 * dialog body is one short sentence explaining the action
 * (mirrors the brevity of MarkServedButton and
 * MarkDelayedButton: those dialogs also have no input
 * fields, just confirm/cancel).
 *
 * The cancel button is always enabled unless the mutation
 * is in flight; the server is the authority on whether the
 * cancel is legal (timer, ownership, value, terminal
 * state). All four 409/403 failure modes render via
 * describeError with the action-specific fallback — same
 * pattern as the FileComplaintDialog's 409 handling, but
 * without the special-cased message. The backend's
 * messages are specific enough ("the 10-minute window has
 * passed", "is already Cancelled", "can only cancel your
 * own orders") that no client-side translation is needed.
 *
 * The dialog stays open on failure so the user can read
 * the message and decide whether to retry. A successful
 * cancel closes the dialog via the parent's onCancelled.
 */
function CancelOrderDialog({
  orderId,
  onClose,
  onCancelled,
}: {
  orderId: number
  onClose: () => void
  onCancelled: () => void
}) {
  const cancel = useCancelOrder()
  const isPending = cancel.isPending

  // Reset the inline error state every time the dialog
  // opens so a prior failure doesn't carry over. Same
  // pattern as FileComplaintDialog's reset effect.
  useEffect(() => {
    cancel.reset()
  }, [cancel])

  const errorMessage = describeError(
    cancel.error,
    "Could not cancel the order.",
  )

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel order #{orderId}?</DialogTitle>
          <DialogDescription>
            This will cancel your order and let the kitchen
            know. You can place a new one anytime.
          </DialogDescription>
        </DialogHeader>

        {/*
          Inline error slot. Same shape as the cart Sheet
          footer and the other dialogs: role="alert" so the
          change is announced, destructive/30 border +
          destructive/5 background for the rose tint. The
          dialog stays open so the user can read the message
          and decide whether to retry.
        */}
        {errorMessage ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2"
          >
            <p className="text-sm text-destructive">{errorMessage}</p>
          </div>
        ) : null}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isPending}
          >
            Keep order
          </Button>
          <Button
            onClick={() =>
              cancel.mutate(
                { orderId },
                { onSuccess: onCancelled },
              )
            }
            disabled={isPending}
            aria-busy={isPending}
          >
            {isPending ? (
              <>
                <Loader2 aria-hidden="true" className="animate-spin" />
                Cancelling…
              </>
            ) : (
              "Cancel order"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function OrderDashboard() {
  // useParams() returns an object whose keys are dynamic route
  // segments. For [orderId] it's { orderId: string }.
  const params = useParams<{ orderId: string }>()
  const orderIdParam = params?.orderId
  const orderId = useMemo(() => {
    if (typeof orderIdParam !== "string") return undefined
    const n = Number(orderIdParam)
    return Number.isFinite(n) ? n : undefined
  }, [orderIdParam])
  const query = useOrder(orderId)

  // The id couldn't be parsed. Don't fire the network call —
  // show the static "invalid link" state.
  if (orderId === undefined) {
    return <InvalidIdState />
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
    // The backend always returns a body on 200, so this branch is
    // defensive. We can't reach for `query.refetch()` here without
    // tripping TypeScript's discriminated-union narrowing; the
    // Skeleton state is the closest visual approximation, and a
    // retried query will simply flip past it.
    return <OrderSkeleton />
  }

  return <OrderView order={query.data} />
}

export default function OrderPage() {
  return (
    <RouteGuard allowedRoles={["customer"]}>
      <OrderDashboard />
    </RouteGuard>
  )
}
