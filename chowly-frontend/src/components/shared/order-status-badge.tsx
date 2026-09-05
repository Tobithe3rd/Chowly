"use client"

/**
 * OrderStatusBadge — the per-status color chip, shared across pages.
 *
 * Originally inlined in the customer order page; extracted when the
 * waiter dashboard needed the same status language at table density.
 * The color-to-status mapping is a UI contract: sky=in-flight,
 * amber=warning, emerald=done, rose=terminal. Anywhere an
 * `OrderStatus` value is shown to the user, it should pass through
 * this component so the palette stays consistent.
 *
 * Two sizes:
 *   - "md" — the page-header treatment (h-7 rounded-full). Used
 *     where the status is the page's "you are here" signal.
 *   - "sm" — the table-row treatment (h-5). Used where the status
 *     is one of several columns and the badge can't dominate.
 *
 * Both share the same color tokens so a row badge and a header
 * badge for the same order read as the same status at different
 * sizes.
 */

import { Badge } from "@/components/ui/badge"
import type { OrderStatus } from "@/types"

const STATUS_CHIP: Record<OrderStatus, string> = {
  "In Preparation":
    "bg-sky-200 text-sky-900 ring-sky-300 dark:bg-sky-400/20 dark:text-sky-100 dark:ring-sky-400/40",
  Delayed:
    "bg-amber-200 text-amber-900 ring-amber-300 dark:bg-amber-400/20 dark:text-amber-100 dark:ring-amber-400/40",
  Served:
    "bg-emerald-200 text-emerald-900 ring-emerald-300 dark:bg-emerald-400/20 dark:text-emerald-100 dark:ring-emerald-400/40",
  Cancelled:
    "bg-rose-200 text-rose-900 ring-rose-300 dark:bg-rose-400/20 dark:text-rose-100 dark:ring-rose-400/40",
}

export function OrderStatusBadge({
  status,
  size = "md",
}: {
  status: OrderStatus
  size?: "sm" | "md"
}) {
  return (
    <Badge
      aria-label={`Status: ${status}`}
      className={
        "font-semibold ring-1 ring-inset " +
        STATUS_CHIP[status] +
        " " +
        (size === "sm"
          ? "h-5 px-2 text-[11px]"
          : "h-7 rounded-full px-2.5 text-xs")
      }
    >
      {status}
    </Badge>
  )
}
