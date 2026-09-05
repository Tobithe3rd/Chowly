/**
 * Token storage for the typed API client.
 *
 * The backend returns the JWT in the login response body (no cookie),
 * so the frontend is responsible for persisting it. We use
 * localStorage so the token survives a page reload — acceptable for a
 * demo, where the trade-off (XSS-readable token) is not a concern.
 *
 * All helpers guard against SSR. Next.js renders the App Router
 * layout on the server during the first request, where `window` is
 * undefined; reading localStorage there would throw. We no-op in that
 * case so the module is safe to import from server components too.
 */

const TOKEN_KEY = "chowly_token"

function hasWindow(): boolean {
  return typeof window !== "undefined"
}

export function getToken(): string | null {
  if (!hasWindow()) return null
  try {
    return window.localStorage.getItem(TOKEN_KEY)
  } catch {
    // localStorage can throw in private-browsing mode or with cookies
    // disabled. Treat that the same as "no token."
    return null
  }
}

export function setToken(token: string): void {
  if (!hasWindow()) return
  try {
    window.localStorage.setItem(TOKEN_KEY, token)
  } catch {
    // Same swallow rationale as getToken.
  }
}

export function clearToken(): void {
  if (!hasWindow()) return
  try {
    window.localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Same swallow rationale as getToken.
  }
}

export const TOKEN_STORAGE_KEY = TOKEN_KEY
