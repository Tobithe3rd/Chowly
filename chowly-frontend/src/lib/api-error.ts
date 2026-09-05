/**
 * Error types for the typed API client.
 *
 * The backend uses FastAPI, which produces two error shapes on non-2xx
 * responses:
 *
 *   1. `{"detail": "<string>"}` — for HTTPException and 5xx.
 *   2. `{"detail": [{loc, msg, type, input, ctx}, ...]}` — for 422
 *      Pydantic validation failures. `detail` is an array of field
 *      errors, not a string.
 *
 * `ApiError` carries whichever shape came back, and `fieldErrors` is a
 * convenience getter that flattens the array shape to a {field: msg}
 * map so forms can render per-field errors without knowing the wire
 * format.
 */

export type ValidationErrorItem = {
  loc: (string | number)[]
  msg: string
  type: string
  input: unknown
}

export class ApiError extends Error {
  status: number
  detail: string | ValidationErrorItem[]

  constructor(status: number, detail: string | ValidationErrorItem[]) {
    // Use the first item's msg (or the whole detail string) as the
    // default Error message so `err.message` is still useful for logs
    // and dev consoles.
    const message =
      typeof detail === "string"
        ? detail
        : detail.length > 0
          ? detail[0].msg
          : "Request failed."
    super(message)
    this.name = "ApiError"
    this.status = status
    this.detail = detail
  }

  /**
   * Field-level error map for 422 validation errors, or null when the
   * error is not a validation error.
   *
   * The key is the `loc` joined with dots minus the leading "body" /
   * "query" / "path" / "header" segment — so a validation error on the
   * `email` field of the request body comes out as "email" rather
   * than "body.email", which is what React form libraries expect.
   */
  get fieldErrors(): { [field: string]: string } | null {
    if (!Array.isArray(this.detail)) return null
    const out: { [field: string]: string } = {}
    for (const item of this.detail) {
      // loc typically looks like ["body", "email"], ["body", "items", 0,
      // "menu_item_id"], etc. Skip the leading source segment.
      const segments = item.loc.slice(1)
      const key = segments
        .map((s) => String(s))
        .join(".")
      if (key) {
        out[key] = item.msg
      }
    }
    return Object.keys(out).length > 0 ? out : null
  }
}

/**
 * Collapse an ApiError to a single user-readable string.
 *
 * The backend's two error shapes (string detail for HTTPException;
 * array of validation items for 422) need different rendering. For
 * dialog footers, sheet footers, and other one-line error slots, one
 * line is enough: we collapse the array to its first message.
 *
 * Pass a `fallback` to customize the message when neither `detail`
 * nor `err.message` is useful — by default, a generic "Request
 * failed." Most call sites override it with an action-specific
 * fallback like "Could not claim the order." or "Could not save
 * the menu item." so the user can tell which action failed.
 */
export function describeError(
  err: ApiError | null | undefined,
  fallback = "Request failed."
): string {
  if (!err) return ""
  if (typeof err.detail === "string") return err.detail
  if (Array.isArray(err.detail) && err.detail.length > 0) {
    const first = err.detail[0]
    if (first && typeof first === "object" && "msg" in first) {
      return String((first as { msg: unknown }).msg)
    }
  }
  return err.message || fallback
}
