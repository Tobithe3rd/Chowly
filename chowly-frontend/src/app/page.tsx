"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"

import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/hooks/use-auth"
import { getRoleHome } from "@/lib/role-routes"

/**
 * `/` — pure router.
 *
 * While AuthProvider is still reading localStorage on mount we show
 * a Skeleton placeholder. Once loaded, we either push to /login (no
 * session) or to the user's role-specific home.
 *
 * The role → path mapping lives in lib/role-routes so it stays in
 * sync with the login page's "you-already-have-a-session" redirect.
 */
export default function Home() {
  const { isAuthenticated, isLoading, user } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (isLoading) return
    if (!isAuthenticated) {
      router.replace("/login")
      return
    }
    if (user) {
      router.replace(getRoleHome(user.role))
    }
  }, [isLoading, isAuthenticated, user, router])

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 dark:bg-black">
      <div className="w-full max-w-sm space-y-3">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  )
}
