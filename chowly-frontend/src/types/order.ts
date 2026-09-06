/**
 * Order types — mirror chowly-backend/app/schemas.py order section.
 *
 * Enum values come from app/models.py OrderStatus enum:
 *   IN_PREPARATION = "In Preparation"
 *   DELAYED        = "Delayed"
 *   SERVED         = "Served"
 *   CANCELLED      = "Cancelled"
 *
 * And the new OrderItemStatus enum:
 *   PREPARING = "Preparing"
 *   READY     = "Ready"
 *
 * Note the spaces in the string values — the backend stores them as
 * the human-readable form, not snake_case. Match exactly.
 *
 * `ItemType` (Food / Drink) is the menu-item category — the chef
 * and bartender dashboards filter the order list to their relevant
 * lines by it (PRODUCT.md lines 15-16, 29, 76). It's defined in
 * restaurant.ts (alongside the menu-item types that also use it)
 * and re-imported here so there's one source of truth.
 */

import type { ItemType } from "./restaurant"

export type { ItemType }

/** Mirrors backend `OrderStatus` enum. */
export type OrderStatus =
  | "In Preparation"
  | "Delayed"
  | "Served"
  | "Cancelled"

/**
 * Mirrors backend `OrderItemStatus` enum. The chef/bartender flips
 * a line from PREPARING to READY via PATCH /orders/{id}/items/{id}.
 * The reverse transition is not supported; the state machine on the
 * backend rejects Ready -> Preparing with 409.
 */
export type OrderItemStatus = "Preparing" | "Ready"

/**
 * Mirrors backend `OrderItemRead` — a single line on an order.
 * `chef_id` / `bartender_id` are null until the line is claimed by
 * the respective staff member. `status` is the per-line prep state
 * (Preparing by default, flipped to Ready by the chef/bartender).
 *
 * `menu_item_name` and `item_type` are flat joined fields (not a
 * nested DTO) that the backend resolves from the MenuItem
 * relationship at serialization time. Wire order matches the
 * backend schema (between `menu_item_id` and `quantity`) for
 * readability.
 */
export interface OrderItemRead {
  order_id: number
  menu_item_id: number
  menu_item_name: string
  item_type: ItemType
  quantity: number
  unit_price: number
  subtotal: number
  chef_id: number | null
  bartender_id: number | null
  // Joined display names from the Chef / Bartender profile
  // rows. `chef_name` is non-null when `chef_id` is non-null
  // (the FK is the same row); same for `bartender_name`.
  // Both stay null on an unclaimed line, matching the
  // nullable chef_id / bartender_id. The chef and bartender
  // dashboards read these to render "Claimed by {name}"
  // instead of the previous generic "Claimed" — see
  // staff-dashboard.tsx.
  chef_name: string | null
  bartender_name: string | null
  status: OrderItemStatus
}

/**
 * Mirrors backend `OrderRead` — full order with line items.
 *
 * `all_lines_ready` is a server-computed boolean: true iff the
 * order has at least one item AND every item's status is "Ready".
 * Used by the waiter dashboard to surface a non-binding "all lines
 * ready" hint. The waiter has no way to mark an order Served today;
 * the indicator is purely informational.
 */
export interface OrderRead {
  id: number
  order_date: string // ISO 8601 datetime
  status: OrderStatus
  estimated_wait_time: number // minutes
  total_amount: number
  customer_id: number
  restaurant_id: number
  waiter_id: number | null
  // Joined display names. `customer_name` is always set
  // (the Order FK is NOT NULL); `waiter_name` is null on
  // unclaimed orders, parallel to `waiter_id`. The waiter
  // list and detail pages read these to drop the "#N"
  // placeholders that used to be the only signal.
  customer_name: string
  waiter_name: string | null
  // Cancellation attribution. All three stay null until
  // status flips to "Cancelled"; the same backend write
  // sets status, cancelled_by_user_id, and cancelled_at
  // together. The waiter's CancelledCard surfaces
  // `cancelled_by_name` + a relative time of
  // `cancelled_at` so the operator can see who and when.
  cancelled_by_user_id: number | null
  cancelled_at: string | null // ISO 8601 datetime
  cancelled_by_name: string | null
  items: OrderItemRead[]
  all_lines_ready: boolean
}

/**
 * Mirrors backend `OrderItemCreate` — one line in POST /orders.
 * Server looks up MenuItem.price and computes subtotal; the client
 * never sends unit_price or subtotal.
 */
export interface OrderItemCreate {
  menu_item_id: number
  quantity: number
}

/**
 * Mirrors backend `OrderCreate` — request body for POST /orders.
 * The customer's restaurant_id (from their User row) must match
 * `restaurant_id` here; the router enforces that.
 */
export interface OrderCreate {
  restaurant_id: number
  items: OrderItemCreate[] // backend requires min_length=1
}

/**
 * Mirrors backend `OrderUpdate` — request body for
 * PATCH /orders/{order_id} (waiter/admin only).
 *
 * All fields optional. Per-field role gate (see
 * routers/orders.py): status / waiter_id / estimated_wait_time are
 * waiter/admin only. The frontend should only send fields the
 * caller's role is allowed to write; the server will 403 otherwise.
 */
export interface OrderUpdate {
  status?: OrderStatus
  waiter_id?: number | null
  estimated_wait_time?: number
}

/**
 * Mirrors backend `OrderItemClaimResponse` — response for
 * POST /orders/{order_id}/items/{menu_item_id}/claim.
 *
 * Note this is structurally identical to `OrderItemRead` (same
 * fields). Defined as a separate type to match the backend's
 * separate schema class — if the claim response ever diverges
 * (e.g. adds a `claimed_at` timestamp), only this type changes.
 *
 * `menu_item_name` and `item_type` mirror the same joined fields
 * on `OrderItemRead`.
 */
export interface OrderItemClaimResponse {
  order_id: number
  menu_item_id: number
  menu_item_name: string
  item_type: ItemType
  quantity: number
  unit_price: number
  subtotal: number
  chef_id: number | null
  bartender_id: number | null
  // Mirrors OrderItemRead.chef_name / bartender_name.
  chef_name: string | null
  bartender_name: string | null
  status: OrderItemStatus
}
