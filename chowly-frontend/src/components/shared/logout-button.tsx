"use client"

import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/use-auth"

/**
 * LogoutButton — single-click sign-out.
 *
 * Renders nothing for unauthenticated callers, so it's safe to drop
 * into any page (or layout) without an `isAuthenticated &&` guard at
 * the call site. After clicking, the token is cleared, the auth
 * context resets, and we push the user to /login.
 *
 * No confirmation dialog — a logout in a demo is cheap to redo.
 */
export function LogoutButton() {
  const { isAuthenticated, logout } = useAuth()
  const router = useRouter()

  if (!isAuthenticated) {
    return null
  }

  function onClick() {
    logout()
    router.push("/login")
  }

  return (
    <Button variant="outline" size="sm" onClick={onClick}>
      Log out
    </Button>
  )
}
