/**
 * LineReadyBadge — a small "Ready" emerald pill for an order
 * line whose per-line status is "Ready".
 *
 * The badge is used in three places:
 *   1. Chef dashboard — when a chef marks a line Ready, the row
 *      flips from "Mark ready" button to this badge.
 *   2. Bartender dashboard — same flow, scoped to drinks.
 *   3. Customer order detail — the per-line "Ready" indicator
 *      on the customer's own order, so they can see the kitchen/
 *      bar have finished a line.
 *
 * Emerald tint (vs amber for "Claimed by you") so a scan of
 * either the kitchen lane or the customer order page tells
 * "done" from "in progress" at a glance. Same inline-flex /
 * rounded-full idiom as ComplaintStatusBadge so the badges
 * sit at the same visual weight across the app.
 *
 * The chevron-icon check is purely decorative; the copy
 * carries the meaning. ARIA: the surrounding context
 * (a table cell with "Items" heading, or an order line row)
 * names the line; the badge text is "Ready" so the screen
 * reader reads it as a status, not a generic decoration.
 */

import { Check } from "lucide-react"

export function LineReadyBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
      <Check aria-hidden="true" className="size-3" />
      Ready
    </span>
  )
}
