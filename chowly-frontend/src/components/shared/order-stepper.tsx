/**
 * OrderStepper — a horizontal four-node progress indicator for the
 * customer order detail page.
 *
 * Nodes, in order: Placed → Claimed (by waiter) → Lines Ready →
 * Served. The first node is always "done" once the order exists;
 * the last is only "done" when the backend has flipped status to
 * Served. Between them, each node reads its completion from one
 * field on the OrderRead payload (waiter_id, all_lines_ready,
 * status), so the stepper is a *projection* of the data, not a
 * second source of truth.
 *
 * Three visual states per node, sharing the same color language
 * as OrderStatusBadge (sky=in-flight, amber=warning, emerald=done):
 *   - done    — emerald ring + filled emerald circle with a
 *               checkmark. The connector to the next node also
 *               turns emerald so progress reads as a single line.
 *   - current — sky ring + filled sky circle with a ring pulse
 *               to mark "this is where you are." The connector
 *               BEFORE the current node is emerald (the user has
 *               passed the previous step); the connector AFTER
 *               is muted.
 *   - pending — muted outline only.
 *
 * Why this color language, not a brand-new one: OrderStatusBadge
 * already maps sky→in-flight, amber→warning, emerald→done, and
 * the page uses the same palette in its role badge, complaint
 * chip, and line-ready pill. Reusing it means the stepper
 * doesn't introduce a second chromatic system — the customer
 * sees "sky = work in progress" and "emerald = done" with no
 * new vocabulary.
 *
 * Delayed is not a node. It is a *tint* on the current step's
 * text, applied when the caller passes `isDelayed`. This mirrors
 * the existing OrderStatusBadge palette (Delayed = amber), so a
 * customer who already understands the badge automatically
 * understands the tint.
 *
 * Accessibility: the stepper is wrapped in an aria-label and
 * each node's text label is read in order by a screen reader
 * via the `aria-current` attribute on the active node. The
 * visual ring is decorative — the text carries the meaning.
 *
 * This is the first stepper in the app's component library.
 * The decision to make it presentational (state-derivation
 * lives in the caller) means a future onboarding stepper or
 * a future claim-confirm stepper can use the same primitive
 * with a different node list.
 */

import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

export type OrderStepperNodeId = "placed" | "claimed" | "ready" | "served"

type NodeState = "done" | "current" | "pending"

type Step = {
  id: OrderStepperNodeId
  label: string
}

const STEPS: Step[] = [
  { id: "placed", label: "Placed" },
  { id: "claimed", label: "Claimed" },
  { id: "ready", label: "Lines ready" },
  { id: "served", label: "Served" },
]

/**
 * Derive each node's visual state from the caller's data.
 *
 * Pure function so it's trivially testable and the call site
 * doesn't need to think about which field maps to which node —
 * it just hands over the OrderRead and gets a list of states.
 *
 * "Current" is the *first* step that is not yet done. If the
 * order is Served, all four are done. If it has no waiter,
 * the second node is current. The function never returns
 * multiple "current" nodes — a single active step is the
 * point of the visualization.
 */
export function deriveStepperStates(
  waiterClaimed: boolean,
  allLinesReady: boolean,
  isServed: boolean,
): Record<OrderStepperNodeId, NodeState> {
  const doneOf = (id: OrderStepperNodeId): boolean => {
    if (id === "placed") return true // Always done once the order exists.
    if (id === "claimed") return waiterClaimed
    if (id === "ready") return allLinesReady
    if (id === "served") return isServed
    return false
  }
  const states: Record<OrderStepperNodeId, NodeState> = {
    placed: "pending",
    claimed: "pending",
    ready: "pending",
    served: "pending",
  }
  for (const s of STEPS) states[s.id] = doneOf(s.id) ? "done" : "pending"
  // Promote the first non-done step to "current" so the user
  // sees a single ringed "you are here" indicator. If every
  // step is done (Served), nothing flips to current — the
  // stepper reads as a fully-completed line.
  for (const s of STEPS) {
    if (states[s.id] === "pending") {
      states[s.id] = "current"
      break
    }
  }
  return states
}

export function OrderStepper({
  states,
  isDelayed = false,
  className,
}: {
  states: Record<OrderStepperNodeId, NodeState>
  isDelayed?: boolean
  className?: string
}) {
  return (
    <ol
      aria-label="Order progress"
      className={cn("flex w-full items-start gap-0", className)}
    >
      {STEPS.map((step, i) => {
        const state = states[step.id]
        const isLast = i === STEPS.length - 1
        // The connector BEFORE a node inherits the node's
        // state: a done step's left connector is emerald
        // (the user has passed it); a current/pending step's
        // left connector is muted. The rightmost connector
        // (after the last node) is hidden via `isLast`.
        const leftConnectorDone = state === "done"
        const showLeftConnector = i > 0
        return (
          <li
            key={step.id}
            className={cn(
              "relative flex flex-1 flex-col items-center",
              isLast && "flex-none",
            )}
            aria-current={state === "current" ? "step" : undefined}
          >
            {showLeftConnector ? (
              <div
                aria-hidden="true"
                className={cn(
                  "absolute left-0 right-1/2 top-3.5 h-0.5 -translate-y-1/2",
                  leftConnectorDone
                    ? "bg-emerald-500"
                    : "bg-muted-foreground/20",
                )}
              />
            ) : null}
            {!isLast ? (
              <div
                aria-hidden="true"
                className={cn(
                  "absolute left-1/2 right-0 top-3.5 h-0.5 -translate-y-1/2",
                  // The right connector of a done step is also
                  // emerald — the line reads as a continuous
                  // completed trail up to the current step.
                  state === "done"
                    ? "bg-emerald-500"
                    : "bg-muted-foreground/20",
                )}
              />
            ) : null}
            <span
              className={cn(
                "relative z-10 flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold ring-1 ring-inset",
                state === "done" &&
                  "bg-emerald-500 text-white ring-emerald-600",
                state === "current" &&
                  "bg-sky-200 text-sky-900 ring-sky-400 dark:bg-sky-400/30 dark:text-sky-50 dark:ring-sky-300/60",
                state === "pending" &&
                  "bg-muted text-muted-foreground ring-muted-foreground/30",
              )}
            >
              {state === "done" ? (
                <Check aria-hidden="true" className="size-3.5" />
              ) : (
                <span aria-hidden="true">{i + 1}</span>
              )}
            </span>
            <span
              className={cn(
                "mt-2 text-center text-xs",
                state === "done" && "font-medium text-foreground",
                state === "current" &&
                  "font-semibold text-foreground",
                state === "pending" && "text-muted-foreground",
                // Delayed tint on the *current* step's label —
                // mirrors the existing OrderStatusBadge palette
                // (Delayed = amber) so a customer who already
                // understands the badge automatically
                // understands the tint.
                isDelayed &&
                  state === "current" &&
                  "text-amber-700 dark:text-amber-300",
              )}
            >
              {step.label}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
