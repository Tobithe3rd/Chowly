"use client"

import { useRouter } from "next/navigation"
import { useEffect, type ReactNode } from "react"

import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/hooks/use-auth"
import { getRoleHome } from "@/lib/role-routes"
import type { Role } from "@/types"

/**
 * RouteGuard — gate a page by auth state and (optionally) role.
 *
 * Three branches, in order:
 *   1. While AuthProvider is still reading localStorage on mount,
 *      render a Skeleton placeholder. Don't redirect yet — we don't
 *      know if the user is logged in or not.
 *   2. If not authenticated, push to /login.
 *   3. If `allowedRoles` is set and the user's role isn't in it,
 *      push to that user's own role home (so a customer hitting
 *      /admin lands on /customer rather than a 403 page).
 *   4. Otherwise render children.
 *
 * Returns the skeleton element directly (not wrapped in a div) so it
 * fills whatever parent layout the page chose.
 */
export function RouteGuard({
  allowedRoles,
  children,
}: {
  allowedRoles?: Role[]
  children: ReactNode
}) {
  const { isAuthenticated, isLoading, user } = useAuth()
  const router = useRouter()

  useEffect(() => {
    // Don't decide anything while we're still reading localStorage.
    if (isLoading) return
    if (!isAuthenticated) {
      router.replace("/login")
      return
    }
    if (allowedRoles && user && !allowedRoles.includes(user.role)) {
      // Mismatched role — bounce to the user's own home rather than
      // a generic error page.
      router.replace(getRoleHome(user.role))
    }
  }, [isLoading, isAuthenticated, allowedRoles, user, router])

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 dark:bg-black">
        <div className="w-full max-w-sm space-y-3">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    )
  }

  // If we're not authenticated, or we're authenticated but the role
  // doesn't match, don't render children — the useEffect is already
  // pushing us elsewhere. Rendering children briefly while the route
  // transition happens would flash protected content to the wrong
  // user.
  if (!isAuthenticated) return null
  if (allowedRoles && user && !allowedRoles.includes(user.role)) return null

  return <>{children}</>
}
