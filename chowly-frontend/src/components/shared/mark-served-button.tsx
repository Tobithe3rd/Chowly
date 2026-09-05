"use client"

/**
 * MarkServedButton — the waiter-driven Served action.
 *
 * A small outline button that opens a confirm dialog; on confirm
 * the order's status flips to "Served" and any list row is muted.
 *
 * The button is only ENABLED when:
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
 * freshness signal on the list page; we just nudge it forward.
 *
 * The detail page also invalidates ["order", order.id] so a
 * re-visit to the detail URL after marking served reflects the
 * new state without a full page reload.
 *
 * Disabled-with-reason mode: when the caller passes
 * `disabled={true}` and `disabledReason` (used by the detail
 * page's action group), the button renders greyed out and the
 * reason renders as muted copy directly below the label. The
 * dialog never opens in this state — clicking the disabled
 * button is a no-op (the browser's native disabled handling
 * suppresses the click event). This is the affordance for
 * "Mark served — 2 lines still preparing" on the detail page.
 */

import { useEffect, useState } from "react"
import { useQueryClient, type QueryClient } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"

import { useMarkServed } from "@/hooks/use-mark-served"
import { ApiError, describeError } from "@/lib/api-error"
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

export function MarkServedButton({
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
          queryClient.invalidateQueries({ queryKey: ["order", order.id] })
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
    <div className="flex flex-col items-start gap-1">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-label={`Mark order #${order.id} as served`}
        title={disabled ? disabledReason : undefined}
      >
        Mark served
      </Button>
      {disabled && disabledReason ? (
        <span className="text-xs text-muted-foreground">{disabledReason}</span>
      ) : null}

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
    </div>
  )
}
