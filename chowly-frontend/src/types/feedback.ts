/**
 * Feedback types — mirror chowly-backend/app/schemas.py feedback
 * section (Complaint + Rating + Payment).
 *
 * Enum values come from app/models.py:
 *   ComplaintStatus: OPEN = "Open", RESOLVED = "Resolved"
 *   PaymentStatus:   PENDING = "Pending", COMPLETED = "Completed",
 *                    FAILED = "Failed"
 */

/** Mirrors backend `ComplaintStatus` enum. */
export type ComplaintStatus = "Open" | "Resolved"

/** Mirrors backend `PaymentStatus` enum. (Not currently returned by
 *  any route in the feedback router; the seed script writes payment
 *  rows directly. Mirrored in case a payment-read endpoint is added
 *  later.) */
export type PaymentStatus = "Pending" | "Completed" | "Failed"

/**
 * Mirrors backend `ComplaintRead` — full complaint on an order.
 * `complaint_date` is the ISO 8601 datetime the row was inserted.
 */
export interface ComplaintRead {
  id: number
  complaint_text: string
  complaint_date: string // ISO 8601 datetime
  status: ComplaintStatus
  order_id: number
  customer_id: number
}

/**
 * Mirrors backend `ComplaintCreate` — input for
 * POST /orders/{order_id}/complaint.
 * Starts in `Open` status server-side; resolution is a separate flow.
 */
export interface ComplaintCreate {
  complaint_text: string
}

/**
 * Mirrors backend `RatingRead` — full rating on an order.
 */
export interface RatingRead {
  id: number
  rating_value: number // 1-5, server-validated
  comment: string | null
  rating_date: string // ISO 8601 datetime
  order_id: number
  customer_id: number
}

/**
 * Mirrors backend `RatingCreate` — input for
 * POST /orders/{order_id}/rating.
 * `rating_value` is constrained to 1-5 server-side.
 */
export interface RatingCreate {
  rating_value: number
  comment?: string | null
}

/**
 * Mirrors backend `PaymentRead`. Not returned by any current route;
 * mirrored for completeness. Payment is explicitly out of scope
 * for the frontend per the project plan.
 */
export interface PaymentRead {
  id: number
  amount: number
  payment_method: string
  payment_status: PaymentStatus
  payment_date: string | null
  transaction_reference: string | null
  order_id: number
}
