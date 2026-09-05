"use client"

/**
 * MarkDelayedButton — the waiter-driven Delayed / In Preparation
 * action.
 *
 * A small outline button (parallel to MarkServedButton) that
 * opens a confirm dialog; on confirm the order's status flips.
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
 * not apply here.
 *
 * On success: invalidate the orders query so the row's status
 * and the button's label flip on the next 10s poll (or the
 * next render after an explicit refetch). The 10s cadence is
 * the canonical freshness signal on the list page; we just
 * nudge it forward. The detail page also invalidates
 * ["order", order.id] so a re-visit reflects the new state
 * without a full page reload.
 *
 * Disabled-with-reason mode: when the caller passes
 * `disabled={true}` and `disabledReason` (used by the detail
 * page's action group), the button renders greyed out and the
 * reason renders as muted copy directly below the label. The
 * dialog never opens in this state — clicking the disabled
 * button is a no-op (the browser's native disabled handling
 * suppresses the click event). This is the affordance for
 * "Mark delayed — not claimed by you" on the detail page.
 */

import { useEffect, useState } from "react"
import type { QueryClient } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"

import { useMarkDelayed } from "@/hooks/use-mark-delayed"
import { describeError } from "@/lib/api-error"
import type { OrderRead } from "@/types"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export function MarkDelayedButton({
  order,
  queryClient,
  disabled = false,
  disabledReason,
}: {
  order: OrderRead
  queryClient: QueryClient
  disabled?: boolean
  disabledReason?: string
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
          queryClient.invalidateQueries({ queryKey: ["order", order.id] })
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
    <div className="flex flex-col items-start gap-1">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-label={ariaLabel}
        title={disabled ? disabledReason : undefined}
      >
        {buttonLabel}
      </Button>
      {disabled && disabledReason ? (
        <span className="text-xs text-muted-foreground">{disabledReason}</span>
      ) : null}

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
    </div>
  )
}
