/**
 * Shared helpers for the staff dashboards (waiter, chef, bartender).
 *
 * Lives in @/lib rather than @/types or @/hooks so it can hold
 * any small utility without dragging in a category that doesn't
 * fit. Right now it's just `isTerminal`; if more helpers appear
 * (e.g. a "can edit" check, a "next status" resolver), they
 * land here too rather than getting duplicated per page.
 */

import type { OrderRead, OrderStatus } from "@/types"

/**
 * A status is "terminal" iff it doesn't represent work staff is
 * currently doing. Served orders are done; Cancelled orders
 * never need anything. Used by:
 *   - the waiter dashboard to mute rows that aren't active work
 *     (table-level visual treatment)
 *   - the chef and bartender dashboards to filter terminal
 *     orders out of the per-line list entirely (they only care
 *     about active work)
 *
 * One copy, three pages — the predicate is the same shape across
 * roles, and the three callers' intent ("not active work")
 * matches.
 */
export function isTerminal(status: OrderStatus): boolean {
  return status === "Served" || status === "Cancelled"
}

/**
 * A "can delay" check for the waiter's per-row action.
 *
 * Returns true when the order is claimable AND claimed by the
 * current waiter AND not terminal. Used by the waiter page to
 * decide whether to render the MarkDelayedButton (which sets
 * status to Delayed, or reverses Delayed back to In
 * Preparation).
 *
 * Shape notes:
 *   - Takes (order, userPid) — unlike `canClaim` in
 *     waiter/page.tsx, which only takes order and lets the
 *     call site do the userPid check. canDelay lives here
 *     (rather than next to canClaim) because the user-pid
 *     check is intrinsic to the action: a Mark Delayed button
 *     rendered on another waiter's order would be a
 *     tenant-confusion footgun. Bundling the check into the
 *     predicate makes the call site one line and impossible
 *     to forget.
 *   - `typeof userPid !== "number"` covers the case where the
 *     JWT doesn't carry a pid (shouldn't happen for an
 *     authenticated waiter, but the type allows undefined and
 *     the early-out is cheap).
 *   - The non-terminal check is what keeps the button off
 *     Served / Cancelled rows; the user can never re-open a
 *     terminal order to flag it as delayed.
 */
export function canDelay(
  order: OrderRead,
  userPid: number | undefined,
): boolean {
  if (isTerminal(order.status)) return false
  if (typeof userPid !== "number") return false
  return order.waiter_id === userPid
}
