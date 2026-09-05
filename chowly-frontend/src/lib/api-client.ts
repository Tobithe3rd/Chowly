/**
 * Typed fetch wrapper for the Chowly backend.
 *
 * Responsibilities:
 *   - Prepend the API base URL (NEXT_PUBLIC_API_BASE_URL).
 *   - Attach Authorization: Bearer <token> when a token is present.
 *   - Set Content-Type: application/json for requests with a body.
 *   - Parse JSON responses.
 *   - Throw an ApiError on non-2xx so React Query mutations and
 *     components can render a single error path.
 *   - Clear the stored token on 401 so the next render sees a logged-
 *     out state. We intentionally do NOT redirect — routing is a UI
 *     concern handled in a separate layer.
 *
 * The base function is `apiFetch<T>`; convenience wrappers (`apiGet`,
 * `apiPost`, `apiPatch`, `apiDelete`) cover the verbs we use most.
 */

import { ApiError } from "./api-error"
import { clearToken, getToken } from "./token"

const DEFAULT_BASE_URL = "http://localhost:8000"

function getBaseUrl(): string {
  // NEXT_PUBLIC_* vars are inlined at build time, so a missing value
  // becomes the literal string "undefined" if not handled. Fall back
  // to the dev default.
  const raw = process.env.NEXT_PUBLIC_API_BASE_URL
  if (!raw || raw === "undefined") return DEFAULT_BASE_URL
  return raw.replace(/\/+$/, "") // strip trailing slash
}

type ApiFetchOptions = Omit<RequestInit, "body"> & {
  body?: unknown
}

export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions = {}
): Promise<T> {
  const { body, headers, ...rest } = options

  const url = `${getBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`

  const finalHeaders: Record<string, string> = {
    Accept: "application/json",
    ...(headers as Record<string, string> | undefined),
  }

  // Attach the bearer token only when we have one. The public
  // endpoints (login, register, list restaurants) must work
  // unauthenticated, so a missing token is not an error.
  const token = getToken()
  if (token) {
    finalHeaders.Authorization = `Bearer ${token}`
  }

  // Only set Content-Type when there's a body to send — browsers
  // refuse to set it on GETs with no body, and including it
  // unconditionally would change a few preflight details elsewhere.
  let serializedBody: BodyInit | undefined
  if (body !== undefined) {
    finalHeaders["Content-Type"] = "application/json"
    serializedBody = JSON.stringify(body)
  }

  const response = await fetch(url, {
    ...rest,
    headers: finalHeaders,
    body: serializedBody,
  })

  // 204 No Content — nothing to parse, return undefined cast to T.
  if (response.status === 204) {
    return undefined as T
  }

  // Try to parse JSON. A non-JSON body on an error path is rare but
  // possible (e.g. proxy returns plain text). Fall back to a generic
  // message rather than crashing the parser.
  const text = await response.text()
  const data: unknown = text ? safeJsonParse(text) : null

  if (!response.ok) {
    // Extract the detail the way FastAPI shapes it. Default to a
    // plain status-text message so the error is never empty.
    let detail: string | unknown[]
    if (
      data &&
      typeof data === "object" &&
      "detail" in data &&
      (typeof (data as { detail: unknown }).detail === "string" ||
        Array.isArray((data as { detail: unknown }).detail))
    ) {
      detail = (data as { detail: string | unknown[] }).detail
    } else {
      detail = response.statusText || "Request failed."
    }

    if (response.status === 401) {
      // Stale or invalid token — wipe it so the next render is
      // logged-out. We don't redirect; that's a UI concern.
      clearToken()
    }

    throw new ApiError(response.status, detail as string | never[])
  }

  return data as T
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// --- Convenience wrappers -------------------------------------------------

export function apiGet<T>(path: string, options?: ApiFetchOptions): Promise<T> {
  return apiFetch<T>(path, { ...options, method: "GET" })
}

export function apiPost<T>(
  path: string,
  body?: unknown,
  options?: ApiFetchOptions
): Promise<T> {
  return apiFetch<T>(path, { ...options, method: "POST", body })
}

export function apiPatch<T>(
  path: string,
  body?: unknown,
  options?: ApiFetchOptions
): Promise<T> {
  return apiFetch<T>(path, { ...options, method: "PATCH", body })
}

export function apiDelete<T>(
  path: string,
  options?: ApiFetchOptions
): Promise<T> {
  return apiFetch<T>(path, { ...options, method: "DELETE" })
}
