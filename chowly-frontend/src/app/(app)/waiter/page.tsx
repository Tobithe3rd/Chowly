"use client"

/**
 * /waiter — the floor dashboard, with a per-row Claim action.
 *
 * The operational view of "what's happening at the restaurant
 * right now." Pulls the order list (tenant-scoped to the waiter's
 * restaurant by the backend) and renders a dense table. Active
 * statuses (In Preparation, Delayed) read at full contrast;
 * terminal ones (Served, Cancelled) are muted so a scan from the
 * top of the list lands on the work first.
 *
 * Why muted, not filtered: a waiter needs the history to know
 * "did I already mark this served?" Filtering it out would lose
 * that context. Muting keeps it in the list at one opacity step
 * down, the same way a closed ticket stays in a POS feed.
 *
 * Sort comes from the backend (`order_date DESC`); the page does
 * NOT re-sort client-side. Trust the server.
 *
 * Polling: useOrders refetches every 10s, and we surface that to
 * the user as an "Updated Xs ago" line under the header. Without
 * the hint, a 10s interval is invisible — and invisible polling
 * reads as "this might be stale." The line is the affordance for
 * "yes, this is live."
 *
 * Claim action: each unclaimed, non-terminal row shows a Claim
 * button. The button opens a small Dialog with an ETA input;
 * confirm posts PATCH /orders/{id} via useClaimOrder and the
 * 10s poll picks up the change. Inline error (no toast) — the
 * dialog stays open so the waiter can fix the ETA and retry
 * without losing context. Same pattern as the cart Sheet.
 *
 * All-lines-ready indicator: when the order's per-line status
 * is "Ready" for every line (a server-computed boolean on
 * OrderRead.all_lines_ready), a small non-binding "All lines
 * ready" emerald pill renders next to the status badge. The
 * pill is a pre-condition signal for the Mark Served action —
 * the action only enables when the indicator is on.
 *
 * Mark Served action: when an order is claimed by the current
 * waiter AND all_lines_ready is true AND the order isn't
 * already terminal, the Actions cell shows a "Mark served"
 * button (in addition to / instead of the existing "Claimed
 * by you" badge). The button opens a confirm dialog; on
 * success the row's status flips to Served and the row is
 * muted. Backend enforces a 409 if the all_lines_ready
 * condition is somehow false at submit time (race between
 * the indicator rendering and a line being un-Ready by a
 * chef/bartender) and the dialog renders the error inline.
 *
 * Mark Delayed action: when an order is claimed by the current
 * waiter AND not terminal, the Actions cell shows a "Mark
 * delayed" button (when status is In Preparation) or a "Mark
 * in preparation" button (when status is Delayed — the
 * reversal). One button, two states, drives both directions
 * of the transition. MarkServedButton takes priority when
 * both Mark Delayed and Mark Served are eligible (claimed by
 * me + all_lines_ready + non-terminal); the rationale is
 * that the natural next step when the kitchen signals ready
 * is the terminal action. The button is mutually exclusive
 * with Claim (which only fires on unclaimed rows) and with
 * Mark Served (priority above). The dialog description
 * explicitly tells the waiter the action is reversible.
 *
 * Row click affordance: each row is a click target for the
 * new /waiter/orders/{id} detail page. The whole row
 * navigates on mouse click, Enter, or Space; the order # cell
 * additionally renders a real <Link> for prefetch, right-click
 * "Open in new tab", and middle-click. Action buttons
 * (Claim / Mark delayed / Mark served) stop propagation so
 * clicking them runs the action without also navigating to
 * the detail page.
 *
 * List vs detail split: the list keeps its single-action
 * affordance (one button at a time, mutually exclusive by
 * state) for fast scans. The detail page carries the full
 * control surface (all three buttons rendered together, each
 * disabled-with-reason when its precondition isn't met).
 * Same predicates drive both.
 *
 * Known gap: the backend's OrderRead has no `claimed_by_name`
 * join, so we can only show "Claimed by you" (when waiter_id
 * matches the JWT's pid) or "Claimed" (when it doesn't). We do
 * not invent a name that isn't in the response — see the gaps
 * section in the plan for the fix.
 */

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { RefreshCw } from "lucide-react"

import { ClaimButton } from "@/components/shared/claim-button"
import { ComplaintStatusBadge } from "@/components/shared/complaint-status-badge"
import { MarkDelayedButton } from "@/components/shared/mark-delayed-button"
import { MarkServedButton } from "@/components/shared/mark-served-button"
import { OrderStatusBadge } from "@/components/shared/order-status-badge"
import { RouteGuard } from "@/components/shared/route-guard"
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
import { useAuth } from "@/hooks/use-auth"
import { useComplaint } from "@/hooks/use-complaint"
import { useOrders } from "@/hooks/use-orders"
import { ApiError } from "@/lib/api-error"
import { canClaim, canDelay, isTerminal } from "@/lib/order-utils"
import type { OrderRead } from "@/types"

const CURRENCY = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
})

function formatPrice(amount: number): string {
  return CURRENCY.format(amount)
}

// A status is "terminal" iff it doesn't represent work the waiter
// is currently doing. Served orders are done; Cancelled orders
// never need anything. Both share a single visual treatment
// (muted row, no hover lift) so a scan of the table can skip
// them at a glance. Now lives in lib/order-utils so the chef
// and bartender dashboards share the same predicate.

// An order is claimable when no one has taken it yet AND it
// represents live work. The "non-terminal" half reuses the same
// rule that mutes Served/Cancelled rows — there's no claim
// action on rows the page already de-emphasizes, so the two
// visual rules stay coherent.
// (canClaim / canDelay are now imported from @/lib/order-utils
// — see the imports at the top of this file. The local copy
// is gone.)

// Relative time formatter for both the polling hint and the
// "Placed" column. Intl.RelativeTimeFormat does the locale
// plumbing; we just pick the right unit.
const RTF = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })

function formatRelative(targetMs: number, nowMs: number): string {
  const diffSec = Math.round((targetMs - nowMs) / 1000)
  const abs = Math.abs(diffSec)
  if (abs < 60) return RTF.format(diffSec, "second")
  const diffMin = Math.round(diffSec / 60)
  if (Math.abs(diffMin) < 60) return RTF.format(diffMin, "minute")
  const diffHr = Math.round(diffMin / 60)
  if (Math.abs(diffHr) < 24) return RTF.format(diffHr, "hour")
  const diffDay = Math.round(diffHr / 24)
  return RTF.format(diffDay, "day")
}

function formatOrderDateTime(iso: string): string {
  // Full local date+time for the `title` tooltip on the Placed cell.
  // Hidden behind a hover so the column stays compact.
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d)
}

function summarizeItems(order: OrderRead): string {
  const lines = order.items.length
  const units = order.items.reduce((n, l) => n + l.quantity, 0)
  return `${lines} line${lines === 1 ? "" : "s"} · ${units} item${units === 1 ? "" : "s"}`
}

/**
 * A 1Hz wall-clock ticker that updates `now` in state. The component
 * using this never calls `Date.now()` during render — the value is
 * captured by the effect and read from state. Sharing one ticker
 * across the page (rather than starting one per row) keeps all
 * "Xs ago" strings on the same reference instant.
 */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

function UpdatedHint({ updatedAt, now }: { updatedAt: number; now: number }) {
  return (
    <span className="text-xs text-muted-foreground tabular-nums">
      Updated {formatRelative(updatedAt, now)}
    </span>
  )
}

function TableSkeleton() {
  // Eight rows is enough to fill the viewport at typical heights
  // without committing to "the list is exactly this long" — which
  // is the kind of lie Skeleton rows shouldn't tell. Cell widths
  // match the real table headers so the layout doesn't shift
  // when the data lands.
  return (
    <div
      className="overflow-hidden rounded-lg border border-border bg-card"
      aria-hidden="true"
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-20">Order</TableHead>
            <TableHead className="w-24">Customer</TableHead>
            <TableHead className="w-32">Status</TableHead>
            <TableHead>Items</TableHead>
            <TableHead className="w-24 text-right">Total</TableHead>
            <TableHead className="w-20">ETA</TableHead>
            <TableHead className="w-32">Placed</TableHead>
            <TableHead className="w-32">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 8 }).map((_, i) => (
            <TableRow key={i}>
              <TableCell><Skeleton className="h-4 w-14" /></TableCell>
              <TableCell><Skeleton className="h-4 w-12" /></TableCell>
              <TableCell><Skeleton className="h-5 w-24 rounded-full" /></TableCell>
              <TableCell><Skeleton className="h-4 w-32" /></TableCell>
              <TableCell><Skeleton className="ml-auto h-4 w-16" /></TableCell>
              <TableCell><Skeleton className="h-4 w-12" /></TableCell>
              <TableCell><Skeleton className="h-4 w-20" /></TableCell>
              <TableCell><Skeleton className="h-7 w-20" /></TableCell>
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
      : "Could not load the orders list."
    : error.message || "Could not load the orders list."
  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive/30 bg-destructive/5 p-4"
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

function EmptyState() {
  return (
    <div className="rounded-lg border border-border bg-card p-10 text-center">
      <p className="text-sm font-medium text-foreground">No orders yet</p>
      <p className="mt-1 text-sm text-muted-foreground">
        New orders will appear here automatically.
      </p>
    </div>
  )
}

function ClaimedCell({
  order,
  userPid,
}: {
  order: OrderRead
  userPid: number | undefined
}) {
  // The backend's OrderRead only returns `waiter_id`, not the
  // assigned waiter's name — no `claimed_by` join exists. We
  // surface "by you" when the id matches the caller's JWT pid,
  // and a generic "Claimed" otherwise. This is flagged as a
  // backend gap (see plan); do not silently invent a name.
  if (typeof order.waiter_id === "number" && order.waiter_id === userPid) {
    return (
      <span className="inline-flex items-center rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand-soft-foreground dark:bg-brand-soft dark:text-brand-soft-foreground">
        Claimed by you
      </span>
    )
  }
  return (
    <span className="text-sm text-muted-foreground">Claimed</span>
  )
}

/**
 * OrderComplaintIndicator — tiny "Open" badge next to the order
 * status when the order has an open complaint on file.
 *
 * The waiter dashboard is the operational view ("what's happening
 * at the restaurant right now"). An Open complaint is a flag
 * that the customer already noticed something went wrong; the
 * indicator lets a waiter scanning the table spot it at a glance
 * without leaving the page to read the complaint.
 *
 * Two state-handling rules, both inherited from useComplaint's
 * 404-as-absence contract:
 *   - No complaint on file (404) → render nothing. The page
 *     doesn't error out because a complaint is missing; the
 *     absence is the answer.
 *   - Any other error (403 from a future role mismatch, 500, …) →
 *     render nothing. The indicator is non-critical; surfacing
 *     a transient backend failure as a missing badge is
 *     strictly better than turning the table into an error
 *     page.
 *
 * The hook call costs one GET per row per 10s poll (same cadence
 * the order itself is on), which is acceptable for the
 * operational density of this page. If the density ever grows,
 * a single batch hook (GET /restaurants/{id}/complaints?status=
 * Open) would be the next move — the per-row hook is the
 * simplest shape that works today.
 */
function OrderComplaintIndicator({ orderId }: { orderId: number }) {
  const query = useComplaint(orderId)
  // 404 means "no complaint on this order" — that's the success
  // case for our purpose. Any error renders nothing; the
  // indicator is decorative.
  if (query.isError) return null
  if (query.isPending) return null
  if (query.data?.status !== "Open") return null
  return <ComplaintStatusBadge status="Open" />
}

/**
 * OrderAllLinesReadyIndicator — a non-binding hint that the
 * kitchen/bar have finished every line on the order.
 *
 * Reads the server-computed `all_lines_ready` boolean off the
 * OrderRead payload (no extra request, no per-row hook — the
 * aggregate is computed in Python by the list_orders endpoint
 * and surfaces as a single field on every order row). Renders
 * nothing when the value is false; renders a small emerald
 * "All lines ready" pill when true.
 *
 * This is purely informational by design. The waiter today has
 * no UI to PATCH an order's status to Served; the PATCH route
 * exists and admits the transition, but the only call site
 * (the Claim dialog) passes the same status back. Surfacing
 * the indicator now means the moment a Served action ships
 * (its own follow-up step), the waiter already has the
 * pre-condition signal in front of them — no table reshuffle
 * needed.
 *
 * The indicator does NOT change the row's muted-vs-active
 * treatment, the Claim button's eligibility, or any other
 * action on the row. A Served action is a future step; today
 * the indicator is a flag, not a button.
 */
function OrderAllLinesReadyIndicator({
  allLinesReady,
}: {
  allLinesReady: boolean
}) {
  if (!allLinesReady) return null
  return (
    <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
      All lines ready
    </span>
  )
}

/**
 * OrderLinesProgressIndicator — a compact "N of M lines ready"
 * hint that shows when the order is *partially* ready (1 ≤ N < M).
 *
 * This is the *mid-state* sibling of OrderAllLinesReadyIndicator:
 * the all-ready case is covered by the emerald pill; the
 * zero-ready case is the default (no hint, the per-line rows
 * tell the story); the in-between case is the gap the indicator
 * fills. The text uses the same sky-tinted "in-flight"
 * chromatic family as the OrderStatusBadge for "In Preparation"
 * — partial work is a non-terminal signal, not a done signal.
 *
 * Why compact: this is a table cell. The customer-facing page
 * has a full "N of M lines ready" line under the stepper; the
 * waiter's view condenses to the minimum that fits next to the
 * status badge without competing for visual weight.
 *
 * Render conditions, made explicit: returns null when
 *   - total < 2 (a single-line order is either all-ready
 *     and covered by the existing pill, or not-ready and
 *     silent by default — no partial state to render);
 *   - ready <= 0 (nothing to show, the absence of the pill
 *     is the signal);
 *   - ready >= total (the all-ready pill already shows).
 */
function OrderLinesProgressIndicator({
  order,
}: {
  order: OrderRead
}) {
  const total = order.items.length
  if (total < 2) return null
  const ready = order.items.filter((l) => l.status === "Ready").length
  if (ready <= 0 || ready >= total) return null
  return (
    <span className="inline-flex items-center rounded-full bg-sky-500/15 px-2 py-0.5 text-xs font-medium text-sky-700 dark:text-sky-300 tabular-nums">
      {ready} / {total} ready
    </span>
  )
}

/**
 * OrderRow — the data row, with a stateful row click + action.
 *
 * Row-level navigation: the whole row is a click target for the
 * new /waiter/orders/{id} detail page. onClick + onKeyDown (Enter
 * /Space) navigate; role="link" + tabIndex + aria-label make it a
 * single semantic link for screen readers and keyboard users. The
 * order # cell additionally renders a real <Link> so right-click
 * "Open in new tab" and middle-click work, and Next.js prefetches
 * the detail page on hover. Clicking the order # cell fires both
 * the link's default navigation and the row's onClick → router.push
 * to the same URL; the double-call is harmless (router.push to a
 * page you're already navigating to is a no-op).
 *
 * Action buttons (Claim / Mark delayed / Mark served) call
 * e.stopPropagation() so clicking them runs the action WITHOUT
 * also navigating to the detail page. Without stopPropagation,
 * a click on Claim would both open the claim dialog AND
 * navigate, which is the wrong UX.
 *
 * The three action buttons render in a mutually exclusive
 * priority order, the same as the previous step's plan:
 *   1. unclaimed + non-terminal     → ClaimButton
 *   2. claimed by me + all lines
 *      ready + non-terminal         → MarkServedButton
 *   3. claimed by me + non-terminal → MarkDelayedButton
 *   4. claimed by anyone else       → ClaimedCell
 *   5. terminal (Served/Cancelled)  → "—"
 *
 * The new /waiter/orders/{id} detail page is the
 * full-control surface — when the waiter wants to see the
 * whole order and apply the right action, they go there.
 * The list row stays the fast-scan lane.
 */
function OrderRow({
  order,
  now,
  userPid,
  queryClient,
}: {
  order: OrderRead
  now: number
  userPid: number | undefined
  queryClient: ReturnType<typeof useQueryClient>
}) {
  const router = useRouter()
  const muted = isTerminal(order.status)
  const claimable = canClaim(order)
  const serveable =
    !muted &&
    order.all_lines_ready &&
    typeof order.waiter_id === "number" &&
    order.waiter_id === userPid
  const delayable = canDelay(order, userPid)

  // The row's click navigation. Kept as a local function so
  // the same URL handler fires for onClick (mouse) and
  // onKeyDown (Enter/Space), and so the <Link> on the order #
  // cell can coexist without an event-coordination dance —
  // both call router.push to the same URL, and the second is
  // a no-op.
  const navigate = () => router.push(`/waiter/orders/${order.id}`)

  return (
    <TableRow
      // The muted treatment drops the row's hover lift and
      // dims the text. The data row is still selectable and
      // readable — the change is "this is not active work,"
      // not "this is gone." The cursor-pointer + hover
      // classes also stay so the click affordance is visible
      // on muted rows; the dimming is just on the foreground
      // text.
      className={
        muted
          ? "cursor-pointer text-muted-foreground hover:bg-muted/40 focus-visible:bg-brand-soft focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset focus-visible:outline-none"
          : "cursor-pointer hover:bg-muted/40 focus-visible:bg-brand-soft focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset focus-visible:outline-none dark:focus-visible:bg-brand-soft dark:focus-visible:ring-brand-soft-foreground/60"
      }
      data-status={order.status}
      role="link"
      tabIndex={0}
      aria-label={`View order #${order.id}`}
      onClick={navigate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          navigate()
        }
      }}
    >
      <TableCell className="cursor-pointer p-0 font-semibold tabular-nums text-foreground">
        {/*
          The order # cell renders a real <Link> for the
          affordances only an <a> gives: Next.js prefetch on
          hover, right-click "Open in new tab", middle-click
          open in new tab, and a real anchor for screen-reader
          users who navigate by link list. The row's onClick
          is the mouse-click-anywhere handler; when the user
          clicks the id cell, both fire (Link's default
          navigation + row's onClick → router.push to the
          same URL) and the second is a no-op. focus-visible
          lives on the <tr> so the row is the focus stop, not
          the link.
        */}
        <Link
          href={`/waiter/orders/${order.id}`}
          onClick={(e) => e.stopPropagation()}
          className="block px-4 py-2 outline-none"
        >
          #{order.id}
        </Link>
      </TableCell>
      <TableCell className="cursor-pointer">
        {order.customer_name}
      </TableCell>
      <TableCell className="cursor-pointer">
        <div className="flex flex-wrap items-center gap-1.5">
          <OrderStatusBadge status={order.status} size="sm" />
          <OrderComplaintIndicator orderId={order.id} />
          <OrderAllLinesReadyIndicator
            allLinesReady={order.all_lines_ready}
          />
          <OrderLinesProgressIndicator order={order} />
        </div>
      </TableCell>
      <TableCell className="cursor-pointer text-sm text-foreground">
        {summarizeItems(order)}
      </TableCell>
      <TableCell className="cursor-pointer text-right text-sm font-semibold tabular-nums text-foreground">
        {formatPrice(order.total_amount)}
      </TableCell>
      <TableCell className="cursor-pointer text-sm tabular-nums text-foreground">
        {order.estimated_wait_time > 0 ? (
          `${order.estimated_wait_time} min`
        ) : (
          <span aria-label="No estimate" className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell
        className="cursor-pointer text-sm tabular-nums"
        title={formatOrderDateTime(order.order_date)}
      >
        {formatRelative(new Date(order.order_date).getTime(), now)}
      </TableCell>
      <TableCell>
        {/*
          Action cell. Five states, ordered by what's actionable
          first (a row that's already served renders nothing):
            1. unclaimed + non-terminal     → ClaimButton
            2. claimed by me + all lines
               ready + non-terminal         → MarkServedButton
            3. claimed by me + non-terminal
               + lines not all ready        → MarkDelayedButton
               (or claimed by me + Delayed
               + all lines ready, the rare
               case where the user wants
               to reverse a delay first)
            4. claimed by anyone (incl. me
               when not all ready AND
               not the "claimed by me" set
               above)                       → ClaimedCell
            5. terminal (Served / Cancelled) → "—"

          The three actionable buttons (Claim / Mark delayed /
          Mark served) NEVER overlap on the same row because
          the if/else chain is exclusive — each branch renders
          exactly one element. When canServe and canDelay are
          both true (claimed by me, all lines ready, non-
          terminal), MarkServedButton takes priority; the
          rationale is that the natural next step when the
          kitchen signals ready is the terminal action, and
          the waiter's path back to "Mark delayed" is to
          re-engage the row after the serve. If the user
          wants to mark delayed first (rare), they can do it
          on the detail page (where all three buttons render
          together with disabled-with-reason states).

          The wrapping <div onClick={stopPropagation}> swallows
          the click before it bubbles to the row's onClick
          handler — without it, clicking Claim / Mark served /
          Mark delayed would also trigger the row's
          router.push to the detail page, which is the wrong
          UX (the action would open its dialog AND navigate).
          The wrapper is the cheaper alternative to threading
          stopPropagation through each action button's onClick
          prop, and it works for any future button added to
          the action cell without further plumbing.
        */}
        <div
          onClick={(e) => e.stopPropagation()}
          className="inline-block"
        >
          {claimable ? (
            <ClaimButton
              order={order}
              queryClient={queryClient}
              userPid={userPid}
            />
          ) : serveable ? (
            <MarkServedButton order={order} queryClient={queryClient} />
        ) : delayable ? (
          <MarkDelayedButton order={order} queryClient={queryClient} />
        ) : order.waiter_id !== null ? (
          <ClaimedCell order={order} userPid={userPid} />
        ) : (
          // Terminal rows (Served/Cancelled) without a waiter
          // — nothing to show, keep the column quiet.
          <span className="text-sm text-muted-foreground">—</span>
        )}
        </div>
      </TableCell>
    </TableRow>
  )
}

function WaiterDashboard() {
  const { user } = useAuth()
  const query = useOrders()
  const queryClient = useQueryClient()
  // Shared wall-clock ticker — drives the "Updated Xs ago" hint
  // and every row's relative Placed time. One timer for the whole
  // page means every "Xs ago" string on screen is computed from
  // the same instant.
  const now = useNow()

  if (query.isPending) {
    return <TableSkeleton />
  }

  if (query.isError) {
    return <ErrorState error={query.error} onRetry={() => query.refetch()} />
  }

  const orders = query.data ?? []
  const restaurantId = user?.rid
  const subtitle = restaurantId
    ? `${orders.length} order${orders.length === 1 ? "" : "s"} at restaurant #${restaurantId}`
    : `${orders.length} order${orders.length === 1 ? "" : "s"}`

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-[-0.03em] text-foreground sm:text-4xl">
            Orders
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex items-center gap-3">
          <UpdatedHint updatedAt={query.dataUpdatedAt} now={now} />
          <span aria-hidden="true" className="hidden h-4 w-px bg-border sm:inline-block" />
          <Button
            variant="outline"
            size="sm"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
            aria-label="Refresh orders"
          >
            <RefreshCw
              aria-hidden="true"
              className={query.isFetching ? "animate-spin" : undefined}
            />
            Refresh
          </Button>
        </div>
      </header>

      <div className="mt-6">
        {orders.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Order</TableHead>
                  <TableHead className="w-24">Customer</TableHead>
                  <TableHead className="w-32">Status</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead className="w-24 text-right">Total</TableHead>
                  <TableHead className="w-20">ETA</TableHead>
                  <TableHead className="w-32">Placed</TableHead>
                  <TableHead className="w-32">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o) => (
                  <OrderRow
                    key={o.id}
                    order={o}
                    now={now}
                    userPid={user?.pid}
                    queryClient={queryClient}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  )
}

export default function WaiterPage() {
  return (
    <RouteGuard allowedRoles={["waiter"]}>
      <WaiterDashboard />
    </RouteGuard>
  )
}
