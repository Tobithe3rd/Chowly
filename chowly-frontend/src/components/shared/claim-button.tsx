"use client"

/**
 * ClaimButton — the waiter's "take ownership" action.
 *
 * A small outline button that opens a confirm dialog with an ETA
 * input; on confirm the row's `waiter_id` flips to the current
 * user and the order moves from "unclaimed" to "Claimed by you."
 *
 * Used by two surfaces:
 *   - The waiter list row (the original call site) — only renders
 *     when the order is unclaimed + non-terminal. The button is
 *     the entire action cell.
 *   - The waiter order detail page — renders as part of the
 *     action group, with optional `disabled` / `disabledReason`
 *     for "already claimed by someone else" cases.
 *
 * Why a dialog with an ETA input rather than a one-click
 * "Claim": the backend requires an `estimated_wait_time` on
 * the PATCH (the field is in OrderUpdate with a 0-480 min
 * range, ge=0 to allow "no estimate"). The existing list-row
 * flow surfaces the ETA in a tiny input; a single-click
 * shortcut that submitted the order's existing estimate would
 * skip the chance to update the estimate. The dialog makes
 * the change explicit and gives the user a moment to think
 * about the right answer. Same pattern as the cart Sheet
 * footer.
 *
 * On success: invalidate the orders query so the next 10s poll
 * tick (≤10s away) shows the updated waiter_id / status / ETA.
 * The 10s cadence is the canonical freshness signal on the list
 * page; we just nudge it forward. The detail page also
 * invalidates ["order", order.id] so a re-visit reflects the
 * new state without a full page reload.
 *
 * Disabled-with-reason mode: when the caller passes
 * `disabled={true}` and `disabledReason` (used by the detail
 * page's action group), the button renders greyed out and the
 * reason renders as muted copy directly below the label. The
 * dialog never opens in this state — clicking the disabled
 * button is a no-op. This is the affordance for "Claim —
 * already claimed by #N" on the detail page.
 *
 * The userPid prop is required (rather than read from
 * useAuth inside the component) so the call site can scope
 * the prop read to the page's role context, and the predicate
 * is a single, explicit dependency. The list page already
 * pulls userPid off the auth hook; the detail page does the
 * same.
 */

import { useEffect, useState } from "react"
import type { QueryClient } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"

import { useClaimOrder } from "@/hooks/use-claim-order"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function ClaimButton({
  order,
  queryClient,
  userPid,
  disabled = false,
  disabledReason,
}: {
  order: OrderRead
  queryClient: QueryClient
  userPid: number | undefined
  disabled?: boolean
  disabledReason?: string
}) {
  const [open, setOpen] = useState(false)
  // Default the ETA to whatever's already on the order, falling
  // back to 20 (the backend's DEFAULT_ESTIMATED_WAIT_MINUTES at
  // routers/orders.py). This matches the "soft default" the
  // user already sees in the ETA cell on the list page.
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
    if (open) {
      setEtaMinutes(
        order.estimated_wait_time > 0
          ? String(order.estimated_wait_time)
          : "20",
      )
    }
  }, [open, order.estimated_wait_time])

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
          // signal on the list page; we just nudge it forward.
          queryClient.invalidateQueries({ queryKey: ["orders", "all"] })
          queryClient.invalidateQueries({ queryKey: ["order", order.id] })
          setOpen(false)
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
    <div className="flex flex-col items-start gap-1">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-label={`Claim order #${order.id}`}
        title={disabled ? disabledReason : undefined}
      >
        Claim
      </Button>
      {disabled && disabledReason ? (
        <span className="text-xs text-muted-foreground">{disabledReason}</span>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
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
              onClick={() => setOpen(false)}
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
    </div>
  )
}
