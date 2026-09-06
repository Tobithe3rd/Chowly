"use client"

import { type ReactNode } from "react"
import Link from "next/link"

import { CartButton } from "@/components/shared/cart-button"
import { LogoutButton } from "@/components/shared/logout-button"
import { Badge } from "@/components/ui/badge"
import { useAuth } from "@/hooks/use-auth"
import { Skeleton } from "@/components/ui/skeleton"
import type { Role } from "@/types"

/**
 * (app) route group layout — wraps every role dashboard with a
 * topbar + content shell.
 *
 * The topbar's right-hand cluster (email, role badge, logout) is
 * only meaningful once AuthProvider has a `user`. While the initial
 * localStorage read is in flight, we render the wordmark alone and
 * let the cluster appear when the user resolves.
 *
 * This layout does NOT gate access or redirect. `RouteGuard` is
 * still the per-page source of truth for auth/role enforcement;
 * the layout assumes anyone who reaches it has already cleared the
 * guard. We read `user` directly via `useAuth()` so the topbar can
 * react to in-session changes (e.g. after a role update) without
 * duplicating the guard's redirect logic.
 */

// Per-role accent. Operate-mode rule: accent color is reserved for
// state and "you are here" navigation, never decoration. The role
// badge IS the you-are-here signal, so this is the one place a
// chromatic palette is correct. Each chip pairs a light tint and
// dark tint so contrast holds in both themes. The 300 fill + 400
// ring and the ring-2 step the saturation and weight up so the
// chip has presence in the chrome without losing AA contrast.
const ROLE_CHIP: Record<Role, string> = {
  customer:
    "bg-amber-300/90 text-amber-950 ring-amber-400 dark:bg-amber-400/30 dark:text-amber-50 dark:ring-amber-400/60",
  waiter:
    "bg-sky-300/90 text-sky-950 ring-sky-400 dark:bg-sky-400/30 dark:text-sky-50 dark:ring-sky-400/60",
  chef:
    "bg-rose-300/90 text-rose-950 ring-rose-400 dark:bg-rose-400/30 dark:text-rose-50 dark:ring-rose-400/60",
  bartender:
    "bg-violet-300/90 text-violet-950 ring-violet-400 dark:bg-violet-400/30 dark:text-violet-50 dark:ring-violet-400/60",
  admin:
    "bg-emerald-300/90 text-emerald-950 ring-emerald-400 dark:bg-emerald-400/30 dark:text-emerald-50 dark:ring-emerald-400/60",
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const { isLoading, user } = useAuth()

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/*
        Header is bg-background (not bg-card) so it sits flush with
        the page — the 1px border-b is the only seam between chrome
        and content, and the H1's colored rule below picks up the
        visual work the card surface used to do.
      */}
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex h-18 max-w-7xl items-center justify-between gap-6 px-6">
          <a
            href="/"
            className="group flex items-center gap-3 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm"
            aria-label="Chowly — go to home"
          >
            <span
              aria-hidden="true"
              className="inline-block size-8 rounded-full bg-gradient-to-br from-brand to-accent shadow-[0_2px_8px_rgba(28,73,210,0.35),inset_0_-3px_6px_rgba(0,0,0,0.18)] ring-2 ring-background/40"
            />
            <span className="text-xl font-extrabold tracking-[-0.04em] text-foreground font-heading">
              Chowly
            </span>
          </a>

          {isLoading || !user ? (
            <Skeleton className="h-7 w-64" />
          ) : (
            <div className="flex items-center gap-2 sm:gap-3">
              <span className="hidden text-sm font-medium text-foreground/80 sm:inline">
                {user.email}
              </span>
              <span
                aria-hidden="true"
                className="hidden h-4 w-px bg-border sm:inline-block"
              />
              <Badge
                className={`h-7 rounded-full px-2.5 text-xs font-bold tracking-tight ring-2 ring-inset ${ROLE_CHIP[user.role]}`}
                aria-label={`Role: ${user.role}`}
              >
                {user.role}
              </Badge>
              {/*
                "My orders" is the customer's persistent lookup
                surface — the complement to the menu (which is the
                customer's creation surface). Scoped by role, not
                by URL, for the same reason CartButton is: the
                role is the source of truth, the route is
                incidental. Staff roles have a list-as-home
                dashboard that already does this job (waiter,
                chef, bartender, admin all land on a list view),
                so the link would be redundant; rendering it for
                non-customers would add visual weight without a
                payoff. Visual weight: same as the role badge's
                text height (h-7) so the cluster's vertical rhythm
                stays consistent — a small text link, not a button,
                to match the email line above (which is the other
                text element in the cluster).
              */}
              {user.role === "customer" ? (
                <Link
                  href="/customer/orders"
                  className="inline-flex h-7 items-center rounded-md px-2 text-sm font-medium text-foreground/80 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  My orders
                </Link>
              ) : null}
              {/*
                Cart control is scoped by role, not by URL. A customer
                who later visits /orders/{id} or /cart should still
                see their cart trigger — the role is the source of
                truth, the route is incidental. For waiters/chefs/
                bartenders/admins the cart is meaningless; the
                component never mounts.
              */}
              {user.role === "customer" ? <CartButton /> : null}
              <LogoutButton />
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8 sm:py-10">{children}</main>
    </div>
  )
}
