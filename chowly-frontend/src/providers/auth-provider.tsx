"use client"

/**
 * Auth state for the Chowly frontend.
 *
 * The provider owns three things:
 *   1. The decoded token payload (user identity)
 *   2. `isLoading` — true only during the initial mount check, so
 *      downstream UI can show a spinner instead of flashing the
 *      "logged out" state.
 *   3. `login(token)` / `logout()` — the only mutators; they keep
 *      localStorage and the React state in sync.
 *
 * The provider does NOT redirect, render a router, or wrap children
 * with anything that changes their tree. Routing decisions are a
 * page-level concern (handled when we build the login page).
 */

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

import { decodeToken, type DecodedTokenPayload } from "@/lib/jwt"
import { clearToken, getToken, setToken } from "@/lib/token"

export type AuthContextValue = {
  user: DecodedTokenPayload | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (token: string) => void
  logout: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  // `isLoading` defaults to true so the first render doesn't claim
  // we're logged out before useEffect has had a chance to read
  // localStorage. After the effect runs, it flips to false and
  // stays there — `login()` and `logout()` don't toggle it.
  const [user, setUser] = useState<DecodedTokenPayload | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const stored = getToken()
    if (stored) {
      const decoded = decodeToken(stored)
      if (decoded) {
        setUser(decoded)
      } else {
        // Stored token was bad (malformed or expired). Wipe it so
        // the next render isn't in a weird "we have a token but
        // it's junk" state, and let the user log in again.
        clearToken()
      }
    }
    setIsLoading(false)
  }, [])

  const login = useCallback((token: string) => {
    const decoded = decodeToken(token)
    // Refuse to accept a token we can't decode — the API client
    // would 401 on the next request anyway, and accepting it would
    // leave the UI claiming "logged in" while the server disagrees.
    if (!decoded) {
      clearToken()
      return
    }
    setToken(token)
    setUser(decoded)
  }, [])

  const logout = useCallback(() => {
    clearToken()
    setUser(null)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: user !== null,
      isLoading,
      login,
      logout,
    }),
    [user, isLoading, login, logout]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
