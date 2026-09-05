"use client"

/**
 * useAuth — read the current AuthContext value.
 *
 * Throws if called outside an AuthProvider so we get a clear error
 * at the call site rather than a silent undefined crash later.
 */

import { useContext } from "react"

import { AuthContext, type AuthContextValue } from "@/providers/auth-provider"

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error(
      "useAuth must be used inside an <AuthProvider>. " +
        "Wrap your tree in providers/query-provider.tsx's QueryProvider " +
        "and providers/auth-provider.tsx's AuthProvider."
    )
  }
  return ctx
}
