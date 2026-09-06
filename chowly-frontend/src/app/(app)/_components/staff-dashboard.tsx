"use client"

/**
 * StaffDashboard — shared table for the chef and bartender views.
 *
 * One row per line of the relevant item type (Food for chef, Drink
 * for bartender). The chef and bartender never see each other's
 * lanes (PRODUCT.md line 29, 76: "the chef and bartender never
 * see each other's lines"), so the table is the unit of work
 * rather than the order.
 *
 * Why one source of truth: the two views differ only in (a) the
 * item_type they filter on, (b) which claim-id field to read
 * ("by you" comparison), and (c) copy. Everything else — table
 * chrome, polling cadence, skeleton, error slot, dialog pattern —
 * is identical. Three props encapsulate the differences; one
 * component holds the structure.
 *
 * Per-line action cell (single column, three states):
 *   - line.status === "Ready": a small "Ready" emerald badge.
 *     No button — the row is done.
 *   - line.status === "Preparing" and the caller can act
 *     (unclaimed line, or line claimed by the caller): the
 *     Claim button stays for staff who want to claim a line
 *     "for later" without marking it ready yet, AND a Mark
 *     ready button that performs the Preparing -> Ready
 *     transition in one step (and, if unclaimed, also claims
 *     the line — the backend allows claim-by-marking-ready).
 *   - line.status === "Preparing" and claimed by another
 *     staff member: a "Claimed by {name}" indicator with the
 *     other staff member's display name (joined via
 *     OrderItem.chef / OrderItem.bartender, populated in
 *     `_load_order_with_items`). The per-line PATCH gate
 *     would 403 any Mark ready attempt from the wrong user,
 *     so we don't render a button.
 *
 * Both buttons open a small Dialog that confirms the action;
 * on success, the next 10s poll picks up the new state and
 * the row flips (to "Claimed by you" or "Ready"). Inline
 * error (no toast) — the dialog stays open on failure so
 * the user can retry without losing context. Same pattern
 * as the cart Sheet and the waiter page's claim dialog.
 */

import { useEffect, useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Loader2, RefreshCw } from "lucide-react"

import { LineReadyBadge } from "@/components/shared/line-ready-badge"
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
import { useClaimOrderItem } from "@/hooks/use-claim-order-item"
import { useMarkLineReady } from "@/hooks/use-mark-line-ready"
import { useOrders } from "@/hooks/use-orders"
import { ApiError, describeError } from "@/lib/api-error"
import { isTerminal } from "@/lib/order-utils"
import type {
  ItemType,
  OrderItemRead,
  OrderRead,
  Role,
} from "@/types"

type StaffDashboardProps = {
  /**
   * The dashboard's role. Used for the page title and the
   * "Claimed by you" comparison's column name. Doesn't change
   * the table structure or the polling cadence.
   */
  role: Extract<Role, "chef" | "bartender">
  /**
   * The item_type this dashboard filters to. Chef sees "Food";
   * bartender sees "Drink". Drives the row filter, the empty
   * state copy, and the page title's "what's on my lane" framing.
   */
  relevantItemType: ItemType
  /**
   * On each line, the field that records the claimer for this
   * role: chef_id for chef, bartender_id for bartender. The
   * "claimed by you" cell reads this field, and the inline
   * "is claimable" check uses it too.
   */
  claimField: "chef_id" | "bartender_id"
}

type StaffLine = {
  order: OrderRead
  line: OrderItemRead
}

// --- Small helpers ---------------------------------------------------------

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
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d)
}

/**
 * A 1Hz wall-clock ticker shared by all rows on the page. One
 * timer for the page (rather than per row) keeps "Xs ago"
 * strings on the same reference instant.
 */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

// --- Subcomponents ---------------------------------------------------------

function ClaimedCell({
  line,
  claimField,
  userPid,
}: {
  line: OrderItemRead
  claimField: "chef_id" | "bartender_id"
  userPid: number | undefined
}) {
  // Compare the relevant claim-id field (chef_id or bartender_id
  // depending on the view) to the JWT's pid. When they match,
  // the line is yours; when they don't, it's some other staff
  // member — and the joined name (chef_name / bartender_name)
  // surfaces who. The "by you" branch keeps the amber pill
  // for self-consistency with the rest of the staff UI; the
  // "by another" branch shows the actual name. A null name
  // (defense — should not happen given the FK, but the type
  // is `| null`) falls back to the bare id so the operator
  // can still tell two concurrent claims apart.
  const claimedBy = line[claimField]
  if (typeof claimedBy === "number" && claimedBy === userPid) {
    return (
      <span className="inline-flex items-center rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand-soft-foreground dark:bg-brand-soft dark:text-brand-soft-foreground">
        Claimed by you
      </span>
    )
  }
  const otherName = claimField === "chef_id" ? line.chef_name : line.bartender_name
  return (
    <span className="text-sm text-muted-foreground">
      Claimed by {otherName ?? `#${claimedBy}`}
    </span>
  )
}

/**
 * LineReadyBadge — small "Ready" indicator for a line whose status
 * is "Ready". Imported from the shared component so the chef page,
 * bartender page, and customer order detail page render the exact
 * same visual treatment for the Ready state.
 */

/**
 * LineRow — one row per line of the relevant type.
 *
 * Owns its own claim dialog and mark-ready dialog (one per row
 * keeps state and loading/error local) and its own mutations.
 * The page passes the queryClient in so onSuccess can invalidate
 * the orders query and let the 10s poll pick up the change.
 *
 * The action cell renders one of three states per line:
 *   1. Ready: a small "Ready" emerald badge (no button).
 *   2. Preparing, claimable by this user: Claim button (preserves
 *      the existing claim-only flow for staff who want to claim
 *      but not mark ready yet) + Mark ready button (one-step
 *      claim-and-finish — also covers the "Preparing, claimed
 *      by you" case where Claim is no longer relevant).
 *   3. Preparing, claimed by someone else: a generic "Claimed"
 *      indicator — no action, no button.
 *
 * The Mark ready button's dialog copy adapts to the unclaimed-vs-
 * claimed case: unclaimed lines describe the action as "claim
 * and mark ready" (so the user knows the side effect); lines
 * already claimed by the caller describe it as just "mark ready".
 */
function LineRow({
  entry,
  claimField,
  userPid,
  now,
  queryClient,
  role,
}: {
  entry: StaffLine
  claimField: "chef_id" | "bartender_id"
  userPid: number | undefined
  now: number
  queryClient: ReturnType<typeof useQueryClient>
  role: "chef" | "bartender"
}) {
  const { order, line } = entry
  const [claimOpen, setClaimOpen] = useState(false)
  const [markReadyOpen, setMarkReadyOpen] = useState(false)
  const claim = useClaimOrderItem()
  const markReady = useMarkLineReady()
  const claimedBy = line[claimField]
  const claimable = claimedBy === null
  const claimedByMe =
    typeof claimedBy === "number" && claimedBy === userPid
  // Mark-ready eligibility: line must still be Preparing (Ready
  // rows show the Ready badge instead) AND the caller must be
  // able to act on the line — i.e. they own the claim, or the
  // line is unclaimed (so the Mark ready doubles as the claim).
  // This mirrors the per-line check the PATCH endpoint enforces,
  // expressed purely from fields we already have on the wire
  // (status + chef_id/bartender_id + JWT pid).
  const markReadyEligible =
    line.status === "Preparing" && (claimable || claimedByMe)

  function onConfirmClaim() {
    claim.mutate(
      { orderId: order.id, menuItemId: line.menu_item_id },
      {
        onSuccess: () => {
          // Invalidate the unfiltered list so the next poll tick
          // (≤10s away) shows the updated chef_id/bartender_id.
          // The 10s cadence is the canonical freshness signal
          // on this page; we just nudge it forward.
          queryClient.invalidateQueries({ queryKey: ["orders", "all"] })
          setClaimOpen(false)
        },
        // Errors render inline in the dialog footer (see below).
        // We do NOT toast — the dialog stays open so the user
        // can retry, same pattern as the cart Sheet footer and
        // the waiter page's claim dialog.
      },
    )
  }

  function onConfirmMarkReady() {
    markReady.mutate(
      { orderId: order.id, menuItemId: line.menu_item_id },
      {
        onSuccess: () => {
          // Same invalidation as claim: the orders query is the
          // source of truth, the 10s poll is the freshness signal.
          // After invalidation the row flips to "Ready" and the
          // waiter's all_lines_ready aggregate catches up on the
          // next list poll.
          queryClient.invalidateQueries({ queryKey: ["orders", "all"] })
          setMarkReadyOpen(false)
        },
        // Inline error in the dialog footer; dialog stays open on
        // failure so the user can retry. Same pattern as the
        // claim dialog above and the cart Sheet.
      },
    )
  }

  const claimErrorMessage = describeError(
    claim.error,
    "Could not claim the line.",
  )
  const markReadyErrorMessage = describeError(
    markReady.error,
    "Could not mark the line ready.",
  )

  // Subject for the confirm dialog's title. The line's name
  // comes from the joined menu_item_name; for the role-flavor
  // ("Prep this dish" / "Pour this drink") we keep it neutral
  // and just say the line name.
  const claimDialogTitle = `Claim ${line.menu_item_name}?`
  const claimDialogDescription =
    role === "chef"
      ? "You'll take ownership of this line for prep."
      : "You'll take ownership of this line for pouring."

  // Mark-ready dialog copy adapts to the claim state. When
  // unclaimed, the action claims + marks in one step; when
  // already claimed by the caller, it's a pure status flip.
  const markReadyDialogTitle = `Mark ${line.menu_item_name} ready?`
  const markReadyDialogDescription = claimable
    ? role === "chef"
      ? "You'll take ownership and mark this line as ready for service."
      : "You'll take ownership and mark this line as ready to pour."
    : role === "chef"
      ? "This dish is ready to serve."
      : "This drink is ready to pour."

  return (
    <TableRow data-status={order.status}>
      <TableCell className="font-semibold tabular-nums text-foreground">
        #{order.id}
      </TableCell>
      <TableCell className="text-sm text-foreground">
        {line.menu_item_name}
      </TableCell>
      <TableCell className="text-sm tabular-nums text-foreground">
        {line.quantity}
      </TableCell>
      <TableCell>
        {/* Parent-order status. The line itself has its own
            status too (Preparing / Ready) but the kitchen/bar
            lane's primary urgency signal is the parent —
            "Delayed" is the fire alarm. */}
        <OrderStatusBadge status={order.status} size="sm" />
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
          Action cell — three states:
          - line.status === "Ready": LineReadyBadge (no action)
          - line.status === "Preparing" and claimable: Claim +
            Mark ready buttons (side by side, two intents)
          - line.status === "Preparing" and claimedByMe: just
            the Mark ready button (Claim is no longer relevant
            since the user already owns the line)
          - line.status === "Preparing" and claimedBy another:
            ClaimedCell (generic "Claimed") — no Mark ready,
            since the per-line gate would 403 anyway.

          The flex container is gap-2 to give both buttons room
          to breathe when they coexist; on a tight viewport the
          buttons may wrap, which is acceptable for the
          operational density of this page.
        */}
        {line.status === "Ready" ? (
          <LineReadyBadge />
        ) : markReadyEligible ? (
          <div className="flex flex-wrap items-center gap-2">
            {claimable ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setClaimOpen(true)}
                aria-label={`Claim ${line.menu_item_name} on order #${order.id}`}
              >
                Claim
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMarkReadyOpen(true)}
              aria-label={`Mark ${line.menu_item_name} ready on order #${order.id}`}
            >
              Mark ready
            </Button>
          </div>
        ) : (
          <ClaimedCell
            line={line}
            claimField={claimField}
            userPid={userPid}
          />
        )}
      </TableCell>

      <Dialog open={claimOpen} onOpenChange={setClaimOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{claimDialogTitle}</DialogTitle>
            <DialogDescription>{claimDialogDescription}</DialogDescription>
          </DialogHeader>

          {/*
            Inline error slot. Same shape as the cart Sheet footer
            and the waiter page's claim dialog: role="alert" so the
            change is announced, destructive/30 border +
            destructive/5 background for the rose tint. The
            dialog stays open so the user can retry without
            losing context.
          */}
          {claimErrorMessage ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2"
            >
              <p className="text-sm text-destructive">{claimErrorMessage}</p>
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
              onClick={onConfirmClaim}
              disabled={claim.isPending}
              aria-busy={claim.isPending}
            >
              {claim.isPending ? (
                <>
                  <Loader2 aria-hidden="true" className="animate-spin" />
                  Claiming…
                </>
              ) : (
                "Claim"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={markReadyOpen} onOpenChange={setMarkReadyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{markReadyDialogTitle}</DialogTitle>
            <DialogDescription>{markReadyDialogDescription}</DialogDescription>
          </DialogHeader>

          {markReadyErrorMessage ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2"
            >
              <p className="text-sm text-destructive">
                {markReadyErrorMessage}
              </p>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMarkReadyOpen(false)}
              disabled={markReady.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={onConfirmMarkReady}
              disabled={markReady.isPending}
              aria-busy={markReady.isPending}
            >
              {markReady.isPending ? (
                <>
                  <Loader2 aria-hidden="true" className="animate-spin" />
                  Marking…
                </>
              ) : (
                "Mark ready"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TableRow>
  )
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
  // without committing to "the list is exactly this long." Cell
  // widths match the real table headers so the layout doesn't
  // shift on data load.
  return (
    <div
      className="overflow-hidden rounded-lg border border-border bg-card"
      aria-hidden="true"
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-20">Order</TableHead>
            <TableHead>Line</TableHead>
            <TableHead className="w-16">Qty</TableHead>
            <TableHead className="w-32">Order status</TableHead>
            <TableHead className="w-20">ETA</TableHead>
            <TableHead className="w-32">Placed</TableHead>
            <TableHead className="w-32">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 8 }).map((_, i) => (
            <TableRow key={i}>
              <TableCell><Skeleton className="h-4 w-14" /></TableCell>
              <TableCell><Skeleton className="h-4 w-32" /></TableCell>
              <TableCell><Skeleton className="h-4 w-6" /></TableCell>
              <TableCell><Skeleton className="h-5 w-24 rounded-full" /></TableCell>
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
        {isApi ? "Try again in a moment." : "Check your connection and try again."}
      </p>
      <div className="mt-3">
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </div>
  )
}

function EmptyState({
  role,
  itemType,
}: {
  role: "chef" | "bartender"
  itemType: ItemType
}) {
  const noun = role === "chef" ? "kitchen" : "bar"
  return (
    <div className="rounded-lg border border-border bg-card p-10 text-center">
      <p className="text-sm font-medium text-foreground">
        No {itemType.toLowerCase()} lines to work right now
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        New {itemType.toLowerCase()} orders will appear in the {noun} as they come in.
      </p>
    </div>
  )
}

// --- Main component --------------------------------------------------------

export function StaffDashboard({
  role,
  relevantItemType,
  claimField,
}: StaffDashboardProps) {
  const { user } = useAuth()
  const query = useOrders()
  const queryClient = useQueryClient()
  const now = useNow()

  // Flatten orders -> relevant-type lines, dropping terminal
  // parents. useMemo so the flattening doesn't re-run on every
  // wall-clock tick (the `now` dependency would otherwise
  // re-compute on each 1Hz re-render).
  const lines = useMemo<StaffLine[]>(() => {
    const orders = query.data ?? []
    const out: StaffLine[] = []
    for (const order of orders) {
      if (isTerminal(order.status)) continue
      for (const line of order.items) {
        if (line.item_type !== relevantItemType) continue
        out.push({ order, line })
      }
    }
    // Trust the server's order_date DESC ordering. The lines
    // inherit it by virtue of walking the orders in order.
    return out
  }, [query.data, relevantItemType])

  if (query.isPending) {
    return <TableSkeleton />
  }

  if (query.isError) {
    return <ErrorState error={query.error} onRetry={() => query.refetch()} />
  }

  const title = role === "chef" ? "Kitchen" : "Bar"
  const itemTypeLabel = relevantItemType.toLowerCase()
  const subtitle =
    lines.length === 0
      ? `No ${itemTypeLabel} lines at the moment`
      : `${lines.length} ${itemTypeLabel} line${lines.length === 1 ? "" : "s"} on ${
          new Set(lines.map((l) => l.order.id)).size
        } order${
          new Set(lines.map((l) => l.order.id)).size === 1 ? "" : "s"
        }`

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-[-0.03em] text-foreground sm:text-4xl">
            {title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex items-center gap-3">
          <UpdatedHint updatedAt={query.dataUpdatedAt} now={now} />
          <span
            aria-hidden="true"
            className="hidden h-4 w-px bg-border sm:inline-block"
          />
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
        {lines.length === 0 ? (
          <EmptyState role={role} itemType={relevantItemType} />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Order</TableHead>
                  <TableHead>Line</TableHead>
                  <TableHead className="w-16">Qty</TableHead>
                  <TableHead className="w-32">Order status</TableHead>
                  <TableHead className="w-20">ETA</TableHead>
                  <TableHead className="w-32">Placed</TableHead>
                  <TableHead className="w-32">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((entry) => (
                  <LineRow
                    key={`${entry.order.id}-${entry.line.menu_item_id}`}
                    entry={entry}
                    claimField={claimField}
                    userPid={user?.pid}
                    now={now}
                    queryClient={queryClient}
                    role={role}
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
