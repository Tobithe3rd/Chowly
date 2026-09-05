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
 * Known gap: the backend's OrderRead has no `claimed_by_name`
 * join, so we can only show "Claimed by you" (when waiter_id
 * matches the JWT's pid) or "Claimed" (when it doesn't). We do
 * not invent a name that isn't in the response — see the gaps
 * section in the plan for the fix.
 */

import { useEffect, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Loader2, RefreshCw } from "lucide-react"

import { RouteGuard } from "@/components/shared/route-guard"
import { ComplaintStatusBadge } from "@/components/shared/complaint-status-badge"
import { OrderStatusBadge } from "@/components/shared/order-status-badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { useClaimOrder } from "@/hooks/use-claim-order"
import { useComplaint } from "@/hooks/use-complaint"
import { useMarkDelayed } from "@/hooks/use-mark-delayed"
import { useMarkServed } from "@/hooks/use-mark-served"
import { useOrders } from "@/hooks/use-orders"
import { ApiError, describeError } from "@/lib/api-error"
import { canDelay, isTerminal } from "@/lib/order-utils"
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
function canClaim(order: OrderRead): boolean {
  if (order.waiter_id !== null) return false
  if (isTerminal(order.status)) return false
  return true
}

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
      <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
        Claimed by you
      </span>
    )
  }
  return (
    <span className="text-sm text-muted-foreground">Claimed</span>
  )
}

/**
 * MarkServedButton — the waiter-driven Served action.
 *
 * A small outline button that opens a confirm dialog; on confirm
 * the row's status flips to "Served" and the row is muted. The
 * button is only enabled when:
 *   - the order is claimed by the current waiter
 *     (`order.waiter_id === userPid`),
 *   - the order is not already terminal
 *     (`!isTerminal(order.status)` — covers the re-Served case
 *     without needing a second predicate), and
 *   - all lines on the order are Ready
 *     (`order.all_lines_ready === true`).
 *
 * The three predicates map directly to the three backend
 * rejections: 403 if the role check fails (already gated by
 * route-guard, so this is defense-in-depth), 409 if the
 * all_lines_ready condition is false at submit time (a race
 * between the button enabling and a line being un-Ready), and
 * 409 if the order is already Served (the terminal-state rule
 * + idempotency). All three are user-readable backend messages
 * rendered inline in the dialog via describeError.
 *
 * Why an extra Dialog rather than confirming inline: the
 * existing claim/resolve-complaint dialogs all use the same
 * two-step pattern. Confirmation is the unit, and a single
 * pattern across the page keeps the page rhythm consistent.
 *
 * On success: invalidate the orders query so the row flips
 * to Served on the next 10s poll (or the next render after
 * an explicit refetch). The 10s cadence is the canonical
 * freshness signal on this page; we just nudge it forward.
 */
function MarkServedButton({
  order,
  queryClient,
}: {
  order: OrderRead
  queryClient: ReturnType<typeof useQueryClient>
}) {
  const [open, setOpen] = useState(false)
  const markServed = useMarkServed()

  // Reset the inline error state every time the dialog opens
  // so a prior failure doesn't carry over. The hook's error is
  // cleared on the next mutate call, but explicit-reset is
  // cheaper than a re-read-and-check at submit time.
  useEffect(() => {
    if (open) markServed.reset()
  }, [open, markServed])

  function onConfirm() {
    markServed.mutate(
      { orderId: order.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["orders", "all"] })
          setOpen(false)
        },
        // Errors render inline in the dialog footer; the dialog
        // stays open so the waiter can read the message and
        // decide whether to retry (e.g. a 409 on a race where
        // a chef un-Ready'd a line between the indicator
        // rendering and the button click).
      },
    )
  }

  const errorMessage = describeError(
    markServed.error,
    "Could not mark the order as served.",
  )

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={`Mark order #${order.id} as served`}
      >
        Mark served
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark order #{order.id} as served?</DialogTitle>
            <DialogDescription>
              All lines are ready. This closes the order on the
              floor — the row will move to the muted state and
              no further status changes are possible.
            </DialogDescription>
          </DialogHeader>

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
              onClick={() => setOpen(false)}
              disabled={markServed.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={onConfirm}
              disabled={markServed.isPending}
              aria-busy={markServed.isPending}
            >
              {markServed.isPending ? (
                <>
                  <Loader2 aria-hidden="true" className="animate-spin" />
                  Marking…
                </>
              ) : (
                "Mark served"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * MarkDelayedButton — the waiter-driven Delayed / In Preparation
 * action.
 *
 * A small outline button (parallel to MarkServedButton) that
 * opens a confirm dialog; on confirm the row's status flips.
 * One button handles BOTH directions of the transition:
 *
 *   - order.status === "In Preparation" → "Mark delayed" (sets
 *     to Delayed). The "flag a long order" path; the kitchen/
 *     bar knows the order is taking longer, the customer sees
 *     the new status on their detail page.
 *   - order.status === "Delayed"        → "Mark in preparation"
 *     (sets to In Preparation). The reversal; the kitchen/
 *     bar has caught up.
 *
 * The button is only rendered when `canDelay(order, userPid)`
 * is true (see lib/order-utils): the order is non-terminal
 * and claimed by the current waiter. The action cell on the
 * row is the only call site; the predicate keeps the affordance
 * off Served / Cancelled rows and off rows another waiter
 * claimed.
 *
 * Why one button, two states, instead of two buttons:
 *   - The two targets are mutually exclusive in the UI (an
 *     order is either In Preparation or Delayed, never both).
 *     Showing both buttons in the action cell would invite
 *     clicks that are no-ops.
 *   - The label switch IS the affordance: the waiter always
 *     sees a single forward action, and the label tells them
 *     which direction. The dialog description repeats the
 *     direction so the choice is unambiguous before they
 *     confirm.
 *   - The reversal is what the user explicitly approved
 *     ("v1 includes the reversal"). The dialog description
 *     tells the waiter the action is reversible — "You can
 *     flip it back…" — so they're less anxious about flagging
 *     a borderline case.
 *
 * Why no Served-style pre-condition check: the backend's
 * per-field role gate accepts the Delayed / In Preparation
 * transition unconditionally for the waiter role (the
 * terminal-state rule only fires for Served). The
 * `all_lines_ready` precondition is Served-specific and does
 * not apply here. The MarkDelayedButton and the MarkServedButton
 * are mutually exclusive in the action cell — when
 * `all_lines_ready` becomes true, MarkServedButton takes
 * priority (see OrderRow's action-cell logic).
 *
 * On success: invalidate the orders query so the row's status
 * and the button's label flip on the next 10s poll (or the
 * next render after an explicit refetch). The 10s cadence is
 * the canonical freshness signal on this page; we just nudge
 * it forward.
 */
function MarkDelayedButton({
  order,
  queryClient,
}: {
  order: OrderRead
  queryClient: ReturnType<typeof useQueryClient>
}) {
  const [open, setOpen] = useState(false)
  const markDelayed = useMarkDelayed()

  // The action is value-parameterized: the target is "Delayed"
  // when the order is currently In Preparation, and "In
  // Preparation" when it's currently Delayed. The reverse
  // mapping is unambiguous because the button is only rendered
  // when canDelay is true, which means the order is not
  // terminal (Served or Cancelled); the only two eligible
  // statuses are In Preparation and Delayed, and they map
  // 1:1 to the target.
  const isReversal = order.status === "Delayed"
  const target: "Delayed" | "In Preparation" = isReversal
    ? "In Preparation"
    : "Delayed"
  const buttonLabel = isReversal ? "Mark in preparation" : "Mark delayed"
  const dialogTitle = isReversal
    ? `Mark order #${order.id} as in preparation?`
    : `Mark order #${order.id} as delayed?`
  const dialogDescription = isReversal
    ? "The status will switch back to In Preparation. The order is no longer flagged as delayed."
    : "The status will switch to Delayed. The customer will see the new status on their order page. You can flip it back to In Preparation later if the kitchen catches up."
  const confirmLabel = isReversal ? "Mark in preparation" : "Mark delayed"
  const ariaLabel = isReversal
    ? `Mark order #${order.id} as in preparation`
    : `Mark order #${order.id} as delayed`

  // Reset the inline error state every time the dialog opens
  // so a prior failure doesn't carry over. Same pattern as
  // MarkServedButton.
  useEffect(() => {
    if (open) markDelayed.reset()
  }, [open, markDelayed])

  function onConfirm() {
    markDelayed.mutate(
      { orderId: order.id, target },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["orders", "all"] })
          setOpen(false)
        },
        // Errors render inline in the dialog footer; the dialog
        // stays open so the waiter can read the message and
        // decide whether to retry. Today the only realistic
        // errors are 500 / network — the backend doesn't have
        // a Delayed-specific pre-condition — so the inline slot
        // is mostly defense-in-depth.
      },
    )
  }

  const errorMessage = describeError(
    markDelayed.error,
    isReversal
      ? "Could not mark the order as in preparation."
      : "Could not mark the order as delayed.",
  )

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={ariaLabel}
      >
        {buttonLabel}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>{dialogDescription}</DialogDescription>
          </DialogHeader>

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
              onClick={() => setOpen(false)}
              disabled={markDelayed.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={onConfirm}
              disabled={markDelayed.isPending}
              aria-busy={markDelayed.isPending}
            >
              {markDelayed.isPending ? (
                <>
                  <Loader2 aria-hidden="true" className="animate-spin" />
                  Marking…
                </>
              ) : (
                confirmLabel
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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
 * OrderRow — the data row, with a stateful Claim dialog.
 *
 * The row owns its own claim UI so multiple rows can have
 * independent dialog state and the page doesn't have to thread
 * per-row state down. The mutation is also instantiated here
 * (rather than at the page level) so the loading/error state is
 * local to the row — one slow claim doesn't block the others.
 *
 * On success, we invalidate the orders query so the 10s poll
 * window shortens to "next tick." The mutation result is
 * intentionally not used; the cache is the source of truth.
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
  const muted = isTerminal(order.status)
  const claimable = canClaim(order)
  const [claimOpen, setClaimOpen] = useState(false)
  // Default the ETA to whatever's already on the order, falling
  // back to 20 (the backend's DEFAULT_ESTIMATED_WAIT_MINUTES at
  // routers/orders.py). This matches the "soft default" the
  // user already sees in the ETA cell.
  const [etaMinutes, setEtaMinutes] = useState<string>(
    order.estimated_wait_time > 0 ? String(order.estimated_wait_time) : "20",
  )
  const claim = useClaimOrder()

  // Reset the ETA input whenever the dialog opens. Without this,
  // a waiter who cancelled once would see the prior edit
  // pre-populated on a different row, which is fine — but a
  // successful claim (which closes the dialog) followed by a
  // cancel-then-reopen of the same row would also carry over,
  // and that's surprising. Reset-on-open is the cheaper
  // surprise-free behavior.
  useEffect(() => {
    if (claimOpen) {
      setEtaMinutes(
        order.estimated_wait_time > 0
          ? String(order.estimated_wait_time)
          : "20",
      )
    }
  }, [claimOpen, order.estimated_wait_time])

  // Disabled state for the Confirm button. The backend caps ETA
  // at 480 (OrderUpdate schema), and ge=0 — a negative value
  // would 422. We also refuse to submit when no waiter profile
  // id is in the JWT (would 403 with the "waiter_id must be …"
  // message); the error slot will surface that case cleanly,
  // but the button is better disabled so the user sees the
  // pre-flight failure first.
  const eta = Number(etaMinutes)
  const etaValid = Number.isFinite(eta) && eta >= 0 && eta <= 480
  const canSubmit =
    etaValid && typeof userPid === "number" && !claim.isPending

  function onConfirm() {
    if (!canSubmit || typeof userPid !== "number") return
    claim.mutate(
      {
        orderId: order.id,
        status: order.status,
        estimated_wait_time: eta,
        waiterId: userPid,
      },
      {
        onSuccess: () => {
          // Invalidate the unfiltered list so the next poll tick
          // (≤10s away) shows the updated waiter_id / status /
          // eta. The 10s cadence is the canonical freshness
          // signal on this page; we just nudge it forward.
          queryClient.invalidateQueries({ queryKey: ["orders", "all"] })
          setClaimOpen(false)
        },
        // Errors render inline in the dialog footer (see below).
        // We do NOT toast here — the dialog stays open so the
        // waiter can fix the ETA and retry, same pattern as the
        // cart Sheet footer.
      },
    )
  }

  const errorMessage = describeError(claim.error, "Could not claim the order.")

  return (
    <TableRow
      // The muted treatment drops the row's hover lift and
      // dims the text. The data row is still selectable and
      // readable — the change is "this is not active work,"
      // not "this is gone."
      className={muted ? "text-muted-foreground hover:bg-transparent" : undefined}
      data-status={order.status}
    >
      <TableCell className="font-semibold tabular-nums text-foreground">
        {/* Read-only first pass — no detail route exists yet, so
            the id is plain text. The next step turns this into a
            link to the staff order-detail page. */}
        #{order.id}
      </TableCell>
      <TableCell className="tabular-nums">
        {/* `customer_id` is the only identifier the list endpoint
            returns; the Customer row's name isn't joined. Showing
            the raw id (as "#N") is honest and avoids a per-row
            N+1 fetch. */}
        #{order.customer_id}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center gap-1.5">
          <OrderStatusBadge status={order.status} size="sm" />
          <OrderComplaintIndicator orderId={order.id} />
          <OrderAllLinesReadyIndicator
            allLinesReady={order.all_lines_ready}
          />
          <OrderLinesProgressIndicator order={order} />
        </div>
      </TableCell>
      <TableCell className="text-sm text-foreground">
        {summarizeItems(order)}
      </TableCell>
      <TableCell className="text-right text-sm font-semibold tabular-nums text-foreground">
        {formatPrice(order.total_amount)}
      </TableCell>
      <TableCell className="text-sm tabular-nums text-foreground">
        {order.estimated_wait_time > 0 ? (
          `${order.estimated_wait_time} min`
        ) : (
          <span aria-label="No estimate" className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell
        className="text-sm tabular-nums"
        title={formatOrderDateTime(order.order_date)}
      >
        {formatRelative(new Date(order.order_date).getTime(), now)}
      </TableCell>
      <TableCell>
        {/*
          Action cell. Five states, ordered by what's actionable
          first (a row that's already served renders nothing):
            1. unclaimed + non-terminal     → Claim button
            2. claimed by me + all lines
               ready + non-terminal         → MarkServedButton
            3. claimed by me + non-terminal
               + lines not all ready        → MarkDelayedButton
               (or claimed by me + Delayed
               + all lines ready, the rare
               case where the user wants
               to reverse a delay first —
               see priority note below)
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
          in two steps: from the next non-ready state — the
          "ready" signal only flips the column from
          MarkDelayedButton to MarkServedButton, the status
          itself doesn't move. In practice the waiter's
          "flag it delayed" instinct fires BEFORE lines are
          ready, which is the canDelay-only path.
        */}
        {claimable ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setClaimOpen(true)}
            aria-label={`Claim order #${order.id}`}
          >
            Claim
          </Button>
        ) : !muted &&
          order.all_lines_ready &&
          typeof order.waiter_id === "number" &&
          order.waiter_id === userPid ? (
          <MarkServedButton order={order} queryClient={queryClient} />
        ) : !muted && canDelay(order, userPid) ? (
          <MarkDelayedButton order={order} queryClient={queryClient} />
        ) : order.waiter_id !== null ? (
          <ClaimedCell order={order} userPid={userPid} />
        ) : (
          // Terminal rows (Served/Cancelled) without a waiter
          // — nothing to show, keep the column quiet.
          <span className="text-sm text-muted-foreground">—</span>
        )}
      </TableCell>

      <Dialog open={claimOpen} onOpenChange={setClaimOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Claim order #{order.id}</DialogTitle>
            <DialogDescription>
              Set how long this order should take. The customer
              sees the estimate on the order page.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor={`eta-${order.id}`}>Estimated wait (minutes)</Label>
            <Input
              id={`eta-${order.id}`}
              type="number"
              inputMode="numeric"
              min={0}
              max={480}
              step={1}
              value={etaMinutes}
              onChange={(e) => setEtaMinutes(e.target.value)}
              aria-invalid={etaMinutes !== "" && !etaValid}
              aria-describedby={errorMessage ? `claim-error-${order.id}` : undefined}
            />
            {!etaValid && etaMinutes !== "" ? (
              <p className="text-xs text-destructive">
                ETA must be between 0 and 480 minutes.
              </p>
            ) : null}
          </div>

          {/*
            Inline error slot. Same shape as the cart Sheet footer:
            role="alert" so the change is announced, destructive/30
            border + destructive/5 background for the rose tint
            without making it look like a separate surface. The
            error stays in the dialog so the user can adjust the
            ETA and retry without losing context.
          */}
          {errorMessage ? (
            <div
              id={`claim-error-${order.id}`}
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2"
            >
              <p className="text-sm text-destructive">{errorMessage}</p>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setClaimOpen(false)}
              disabled={claim.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={onConfirm}
              disabled={!canSubmit}
              aria-busy={claim.isPending}
              title={
                typeof userPid !== "number"
                  ? "Your account is missing a waiter profile id."
                  : !etaValid
                    ? "ETA must be between 0 and 480 minutes."
                    : undefined
              }
            >
              {claim.isPending ? (
                <>
                  <Loader2 aria-hidden="true" className="animate-spin" />
                  Claiming…
                </>
              ) : (
                "Claim order"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
          <h1 className="text-2xl font-bold tracking-[-0.02em] text-foreground sm:text-3xl">
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
