"use client"

/**
 * ComplaintStatusBadge — the per-status color chip for a complaint.
 *
 * Mirrors OrderStatusBadge's structure (see
 * src/components/shared/order-status-badge.tsx) but for the complaint
 * lifecycle. Two states only — Open and Resolved — so no size prop:
 * the chip is always the table-row "sm" treatment, since feedback is
 * an inline accent on the order detail page, never the page's
 * "you are here" signal.
 *
 * Color tokens:
 *   Open     = amber-200/900 ring-amber-300   (matches the order's
 *                                              Delayed palette, so
 *                                              an Open complaint reads
 *                                              as the same kind of
 *                                              "active issue" the user
 *                                              has already seen on
 *                                              the order status).
 *   Resolved = emerald-200/900 ring-emerald-300 (matches the order's
 *                                              Served palette, so a
 *                                              Resolved complaint
 *                                              reads as the same kind
 *                                              of "done" the user has
 *                                              already seen on the
 *                                              order status).
 *
 * Why a new component, not a variant of OrderStatusBadge:
 * OrderStatusBadge is typed `Record<OrderStatus, string>` — OrderStatus
 * is the order-lifecycle union. Widening it to include Open/Resolved
 * would loosen the contract for the three pages that already use it
 * (customer, waiter, staff dashboard). A separate component keeps the
 * two semantics independent and the chips one look-up away from each
 * other, in case the design system wants to tweak them in parallel.
 */

import { Badge } from "@/components/ui/badge"
import type { ComplaintStatus } from "@/types"

const STATUS_CHIP: Record<ComplaintStatus, string> = {
  Open:
    "bg-amber-200 text-amber-900 ring-amber-300 dark:bg-amber-400/20 dark:text-amber-100 dark:ring-amber-400/40",
  Resolved:
    "bg-emerald-200 text-emerald-900 ring-emerald-300 dark:bg-emerald-400/20 dark:text-emerald-100 dark:ring-emerald-400/40",
}

export function ComplaintStatusBadge({ status }: { status: ComplaintStatus }) {
  return (
    <Badge
      aria-label={`Complaint status: ${status}`}
      className={
        "h-5 px-2 text-[11px] font-semibold ring-1 ring-inset " +
        STATUS_CHIP[status]
      }
    >
      {status}
    </Badge>
  )
}
