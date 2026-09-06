"use client"

/**
 * /admin — restaurant menu-item management.
 *
 * The admin sees a table of their own restaurant's menu items
 * (read from user.rid, the admin's tenant from the JWT), with
 * Create, Edit, and "Delete" (availability flip) actions. The
 * same `useRestaurant(rid)` the customer page uses is the data
 * source — one query, no parallel admin-specific endpoint.
 *
 * Two notes on the design, both in the plan:
 *
 *   1. **No real "delete" endpoint exists.** The backend exposes
 *      only POST and PATCH on /menu-items; verified via
 *      /openapi.json and routers/restaurants.py. The user decision
 *      (per the planning session) is to use PATCH
 *      availability_status = "unavailable" as the "delete"
 *      surface. The customer page already filters to
 *      availability_status === "available" (customer/page.tsx),
 *      and the orders router rejects ordering unavailable items
 *      (orders.py:237). So flipping an item to unavailable hides
 *      it from customers and blocks new orders, without needing
 *      a new endpoint, a destructive action, or any FK concerns.
 *      The row stays in the admin's table with an "Unavailable"
 *      badge; admins re-enable via Edit.
 *
 *   2. **No 10s polling, no wall-clock ticker.** This is a CRUD
 *      screen, not an operational one. Refetching happens on
 *      mount and on mutation success. If a second admin is
 *      editing the same restaurant in another tab, the staleness
 *      window is the time between their save and our next
 *      action — a multi-tab consistency problem that's not
 *      worth a 10s timer on every page load.
 *
 * All inline-error rendering uses the shared describeError
 * helper from lib/api-error.ts, with action-specific fallbacks
 * so the user knows which action failed.
 */

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useQueryClient } from "@tanstack/react-query"
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react"

import { ComplaintStatusBadge } from "@/components/shared/complaint-status-badge"
import { OrderStatusBadge } from "@/components/shared/order-status-badge"
import { RouteGuard } from "@/components/shared/route-guard"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/hooks/use-auth"
import { useCreateMenuItem } from "@/hooks/use-create-menu-item"
import { useRestaurant } from "@/hooks/use-restaurant"
import { useOrders } from "@/hooks/use-orders"
import { useRestaurantComplaints } from "@/hooks/use-restaurant-complaints"
import { useResolveComplaint } from "@/hooks/use-resolve-complaint"
import {
  useSetMenuItemAvailability,
  type MenuItemAvailability,
} from "@/hooks/use-set-menu-item-availability"
import { useUpdateMenuItem } from "@/hooks/use-update-menu-item"
import { ApiError, describeError } from "@/lib/api-error"
import type {
  ComplaintRead,
  ComplaintStatus,
  ItemType,
  MenuItemRead,
  MenuItemCreate,
  OrderRead,
} from "@/types"

// --- Page -----------------------------------------------------------------

/**
 * AdminPage — the admin's three-section landing surface.
 *
 * Three sections, all tenant-scoped to the admin's restaurant:
 *   1. Complaints (above) — read-only list with a Resolve action
 *      on Open rows. The #N cell now links into the new admin
 *      order detail page (src/app/(app)/admin/orders/[orderId]/
 *      page.tsx) so an admin can drill from "someone filed a
 *      complaint on order #N" straight to the full order view.
 *      Mirrors the menu-items table's "skeleton / error / empty"
 *      pattern. Driven by useRestaurantComplaints + useResolveComplaint.
 *   2. Recent orders (middle) — the latest 10 orders at the
 *      admin's restaurant, with links to the order detail
 *      page. Lets the admin reach orders that have no
 *      complaint (the "I just want to look" path, as opposed
 *      to the complaint-driven drill-in from section 1).
 *      Driven by useOrders (the same hook the waiter page
 *      uses, tenant-scoped to the admin via the JWT).
 *   3. Menu items (below) — unchanged from the previous step.
 *
 * The ordering is intentional: complaints are the most
 * time-sensitive ("act now" signal), recent orders are the
 * operational context, and the menu-items CRUD surface is the
 * bulk of the page but the least time-sensitive.
 */
export default function AdminPage() {
  return (
    <RouteGuard allowedRoles={["admin"]}>
      <div className="space-y-12">
        <ComplaintsAdmin />
        <RecentOrdersAdmin />
        <MenuItemsAdmin />
      </div>
    </RouteGuard>
  )
}

// --- Currency helper -------------------------------------------------------

// Currency display is hard-coded for the demo — the backend
// doesn't expose a per-restaurant currency yet, and the seeded
// restaurants span USD/EUR/GBP. Once `RestaurantDetail` carries
// a `currency` field, drop this and read it off the response.
// (Same fallback the customer page uses; if the demo grows a
// multi-currency story, this gets consolidated in one place.)
const CURRENCY = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
})

function formatPrice(amount: string | number): string {
  // `amount` is sometimes a stringified Decimal from Pydantic
  // (menu item prices, e.g. "12.50") and sometimes a number
  // (OrderRead.total_amount, which Pydantic serializes as a
  // plain JSON number). Coerce either way to number for
  // display; for a demo we accept the float precision loss
  // rather than reimplementing Decimal formatting.
  const n = Number(amount)
  return Number.isFinite(n) ? CURRENCY.format(n) : String(amount)
}

// `complaint_date` is an ISO 8601 datetime from the backend (stored
// as a Pydantic datetime on the ComplaintRead schema). The admin
// table needs a compact "when was this filed" column — the same
// `medium` date style the menu-items form uses, no time-of-day
// detail (the value is rarely "five minutes ago"-level operational).
function formatComplaintDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(d)
}

// "Placed" timestamp on the recent-orders table. The customer
// page and the order detail page use the same medium-date +
// short-time format. Reusing the same idiom keeps the
// "when was this filed" cells consistent across the three
// pages an admin can drill through.
function formatOrderDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d)
}

// Truncate complaint text to a row-friendly width with the full
// text surfaced via `title=` on hover. The text is small enough
// (1-2000 chars) that even a rough cap keeps the row readable
// without losing information; long text gets the tooltip.
const COMPLAINT_TEXT_PREVIEW_CHARS = 80
function truncateComplaintText(text: string): string {
  if (text.length <= COMPLAINT_TEXT_PREVIEW_CHARS) return text
  return text.slice(0, COMPLAINT_TEXT_PREVIEW_CHARS - 1) + "…"
}

// --- The view -------------------------------------------------------------

/**
 * ComplaintsAdmin — the admin's read-and-resolve view for complaints
 * at their own restaurant.
 *
 * Mirrors the MenuItemsAdmin data-flow pattern (useAuth for rid,
 * useQuery-driven table, TableSkeleton/ErrorState/EmptyAdminState
 * local components reused at the bottom of the file) but with a
 * single "Resolve" action on Open rows. The filter is a small
 * Select for All/Open/Resolved; changing it changes the
 * useRestaurantComplaints queryKey, which triggers a refetch
 * under a new key.
 *
 * Why complaints above menu items: a complaint is an "act now"
 * signal — a customer flagged a problem. The admin landing on
 * /admin should see those before the menu CRUD surface, which
 * is the bulk of the page but the less time-sensitive half.
 */
function ComplaintsAdmin() {
  const { user } = useAuth()
  const restaurantId = user?.rid
  const queryClient = useQueryClient()

  // Filter state. "all" is the default so the table is the
  // full history; selecting Open or Resolved re-fetches under
  // a new key.
  const [statusFilter, setStatusFilter] = useState<"all" | ComplaintStatus>(
    "all",
  )
  const [resolveTarget, setResolveTarget] = useState<ComplaintRead | null>(
    null,
  )

  const filterArg = statusFilter === "all" ? undefined : statusFilter
  const query = useRestaurantComplaints(restaurantId, filterArg)

  // Same rid-undefined guard as MenuItemsAdmin — the page already
  // has a single restaurant-id source, so both sections render the
  // same defensive empty state if the admin's JWT has no rid.
  if (restaurantId === undefined) {
    return (
      <EmptyAdminState
        title="No restaurant on this admin account"
        body="This admin account is not linked to a restaurant. The admin view needs a tenant."
      />
    )
  }

  function invalidate() {
    // Invalidate every key under the same restaurant — the page
    // may have multiple filtered entries cached (All, Open,
    // Resolved), and the resolve action changes them all.
    queryClient.invalidateQueries({
      queryKey: ["restaurant-complaints", restaurantId],
    })
  }

  if (query.isPending) {
    return <ComplaintsTableSkeleton />
  }

  if (query.isError) {
    return (
      <ErrorState
        error={query.error}
        onRetry={() => query.refetch()}
      />
    )
  }

  const complaints = query.data ?? []
  const openCount = complaints.filter((c) => c.status === "Open").length
  // Subtitle: "Mama Put Kitchen · 3 complaints · 2 open" — keeps
  // the header self-describing without cramming the page header.
  const restaurantName =
    // The admin page also has a MenuItemsAdmin section that
    // loads the restaurant name via useRestaurant. To avoid a
    // second fetch, fall back to a generic label here; the
    // menu-items section will surface the full name.
    "Restaurant"
  const subtitle = `${restaurantName} · ${complaints.length} complaint${
    complaints.length === 1 ? "" : "s"
  } · ${openCount} open`

  return (
    <section>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-[-0.02em] text-foreground sm:text-3xl">
            Complaints
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="complaints-filter" className="sr-only">
            Filter by status
          </Label>
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as "all" | ComplaintStatus)}
          >
            <SelectTrigger
              id="complaints-filter"
              className="w-36"
              aria-label="Filter complaints by status"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="Open">Open</SelectItem>
              <SelectItem value="Resolved">Resolved</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </header>

      <div className="mt-6">
        {complaints.length === 0 ? (
          <EmptyAdminState
            title={
              statusFilter === "all"
                ? "No complaints on file"
                : `No ${statusFilter.toLowerCase()} complaints`
            }
            body={
              statusFilter === "all"
                ? "When a customer files a complaint on one of your orders, it will appear here."
                : "Try a different filter to see the rest of the list."
            }
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Status</TableHead>
                  <TableHead className="w-20">Order</TableHead>
                  <TableHead className="w-24">Customer</TableHead>
                  <TableHead className="w-32">Filed</TableHead>
                  <TableHead>Text</TableHead>
                  <TableHead className="w-32 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {complaints.map((c) => (
                  <ComplaintRow
                    key={c.id}
                    complaint={c}
                    onResolve={() => setResolveTarget(c)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {resolveTarget !== null ? (
        <ResolveComplaintDialog
          complaint={resolveTarget}
          onClose={() => setResolveTarget(null)}
          onResolved={() => {
            setResolveTarget(null)
            invalidate()
          }}
        />
      ) : null}
    </section>
  )
}

// --- Complaint row --------------------------------------------------------

function ComplaintRow({
  complaint,
  onResolve,
}: {
  complaint: ComplaintRead
  onResolve: () => void
}) {
  const isOpen = complaint.status === "Open"
  return (
    <TableRow
      // Resolved rows are dimmed so the eye lands on the open
      // complaints first — same muted-row idiom the waiter
      // page uses for Served/Cancelled orders. The data is
      // still readable; the change is "this is not active
      // work," not "this is gone."
      className={isOpen ? undefined : "text-muted-foreground hover:bg-transparent"}
      data-status={complaint.status}
    >
      <TableCell>
        <ComplaintStatusBadge status={complaint.status} />
      </TableCell>
      <TableCell className="font-semibold tabular-nums text-foreground">
        {/* Drill into the order on the new admin detail page.
            The Resolve button on the right handles the
            complaint; the link handles the order. Both are
            independent — admin can resolve without drilling,
            and can drill without resolving. */}
        <Link
          href={`/admin/orders/${complaint.order_id}`}
          aria-label={`View order #${complaint.order_id} details`}
          className="text-foreground outline-none hover:text-amber-700 hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm dark:hover:text-amber-300"
        >
          #{complaint.order_id}
        </Link>
      </TableCell>
      <TableCell>
        {complaint.customer_name}
      </TableCell>
      <TableCell className="text-sm tabular-nums">
        {formatComplaintDate(complaint.complaint_date)}
      </TableCell>
      <TableCell
        className="text-sm"
        // Full text on hover so a truncated row stays informative.
        title={complaint.complaint_text}
      >
        {truncateComplaintText(complaint.complaint_text)}
      </TableCell>
      <TableCell className="text-right">
        {isOpen ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onResolve}
            aria-label={`Resolve complaint on order #${complaint.order_id}`}
          >
            Resolve
          </Button>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        )}
      </TableCell>
    </TableRow>
  )
}

// --- Resolve dialog -------------------------------------------------------

/**
 * ResolveComplaintDialog — confirm before flipping a complaint to
 * Resolved. The dialog is honest about the action: it shows the
 * order id and a snippet of the complaint text so the admin is
 * resolving the right one. No body input — the only legal
 * transition today is Open -> Resolved, and the hook hard-codes
 * the body to { status: "Resolved" }.
 *
 * The 409 race (a second admin resolves the same complaint in
 * another tab) is handled the same way every other dialog in
 * the codebase does: stay open, show the inline error. The
 * backend's 409 message ("Complaint is already Resolved." or
 * "Cannot reopen a resolved complaint.") is user-readable, so
 * describeError surfaces it directly.
 */
function ResolveComplaintDialog({
  complaint,
  onClose,
  onResolved,
}: {
  complaint: ComplaintRead
  onClose: () => void
  onResolved: () => void
}) {
  const resolve = useResolveComplaint()
  const isPending = resolve.isPending
  const errorMessage = describeError(
    resolve.error,
    "Could not resolve the complaint.",
  )

  function onConfirm() {
    resolve.mutate(
      { orderId: complaint.order_id },
      {
        onSuccess: () => onResolved(),
      },
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Resolve complaint on order #{complaint.order_id}?</DialogTitle>
          <DialogDescription>
            Mark this complaint as Resolved. The customer will see the
            updated status on their order page.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-foreground">
          {complaint.complaint_text}
        </div>

        {errorMessage ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2"
          >
            <p className="text-sm text-destructive">{errorMessage}</p>
          </div>
        ) : null}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isPending}
            aria-busy={isPending}
          >
            {isPending ? (
              <>
                <Loader2 aria-hidden="true" className="animate-spin" />
                Resolving…
              </>
            ) : (
              "Resolve"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// --- Complaints skeleton (mirrors TableSkeleton but for the complaints table)

function ComplaintsTableSkeleton() {
  // Eight rows is enough to fill the viewport at typical heights
  // without committing to "the list is exactly this long" — the
  // same pragmatic density the menu-items skeleton uses. Cell
  // widths match the real table headers so the layout doesn't
  // shift on data load.
  return (
    <div
      className="overflow-hidden rounded-lg border border-border bg-card"
      aria-hidden="true"
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-28">Status</TableHead>
            <TableHead className="w-20">Order</TableHead>
            <TableHead className="w-24">Customer</TableHead>
            <TableHead className="w-32">Filed</TableHead>
            <TableHead>Text</TableHead>
            <TableHead className="w-32 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 8 }).map((_, i) => (
            <TableRow key={i}>
              <TableCell>
                <Skeleton className="h-5 w-20 rounded-full" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-12" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-12" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-24" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-72" />
              </TableCell>
              <TableCell className="text-right">
                <Skeleton className="ml-auto h-7 w-20" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/**
 * RecentOrdersAdmin — the latest 10 orders at the admin's
 * restaurant, with links to the new admin order detail page.
 *
 * Why 10 and not the full list: the admin landing on /admin
 * wants operational context — "what's been happening at my
 * restaurant today?" — not a paginated order history. The
 * full list is reachable through the order detail page
 * (which is what an admin would deep-link to from a
 * complaint). 10 is enough to scan a typical shift without
 * committing to a pagination surface.
 *
 * Driven by useOrders (the same hook the waiter page uses,
 * tenant-scoped to the admin via the JWT — the backend's
 * list_orders returns the admin's restaurant's orders, not
 * the admin's own). No status filter: showing every status
 * is the point of an "operational context" section. The
 * OrderStatusBadge in the Status column colors each row
 * per the existing palette (sky/amber/emerald/rose).
 *
 * Sort: most-recent-first by `order_date`. The backend's
 * list endpoint already returns orders in a stable
 * insertion-ish order, so we sort client-side to get the
 * ten most recent regardless of the wire order. The slice
 * is post-sort.
 */
function RecentOrdersAdmin() {
  const { user } = useAuth()
  const restaurantId = user?.rid
  const query = useOrders()

  if (restaurantId === undefined) {
    return (
      <EmptyAdminState
        title="No restaurant on this admin account"
        body="This admin account is not linked to a restaurant. The admin view needs a tenant."
      />
    )
  }

  if (query.isPending) {
    return <RecentOrdersTableSkeleton />
  }

  if (query.isError) {
    return (
      <ErrorState
        error={query.error}
        onRetry={() => query.refetch()}
      />
    )
  }

  // Sort by order_date desc and take the 10 most recent.
  // Empty array while loading keeps the table from flashing.
  const recent: OrderRead[] = (query.data ?? [])
    .slice()
    .sort((a, b) => b.order_date.localeCompare(a.order_date))
    .slice(0, 10)

  return (
    <section>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-[-0.02em] text-foreground sm:text-3xl">
            Recent orders
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {recent.length === 0
              ? "No orders yet."
              : `The ${recent.length} most recent order${recent.length === 1 ? "" : "s"} at this restaurant.`}
          </p>
        </div>
      </header>

      <div className="mt-6">
        {recent.length === 0 ? (
          <EmptyAdminState
            title="No orders yet"
            body="When a customer places an order at this restaurant, it will appear here."
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Order</TableHead>
                  <TableHead className="w-32">Status</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="w-44">Placed</TableHead>
                  <TableHead className="w-28 text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-semibold tabular-nums text-foreground">
                      <Link
                        href={`/admin/orders/${o.id}`}
                        aria-label={`View order #${o.id} details`}
                        className="text-foreground outline-none hover:text-amber-700 hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm dark:hover:text-amber-300"
                      >
                        #{o.id}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <OrderStatusBadge status={o.status} size="sm" />
                    </TableCell>
                    <TableCell>{o.customer_name}</TableCell>
                    <TableCell className="text-sm tabular-nums text-muted-foreground">
                      {formatOrderDateTime(o.order_date)}
                    </TableCell>
                    <TableCell className="text-right text-sm font-semibold tabular-nums text-foreground">
                      {formatPrice(o.total_amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </section>
  )
}

// --- Recent-orders skeleton (mirrors ComplaintsTableSkeleton) -------------

function RecentOrdersTableSkeleton() {
  return (
    <div
      className="overflow-hidden rounded-lg border border-border bg-card"
      aria-hidden="true"
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-20">Order</TableHead>
            <TableHead className="w-32">Status</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead className="w-44">Placed</TableHead>
            <TableHead className="w-28 text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 8 }).map((_, i) => (
            <TableRow key={i}>
              <TableCell>
                <Skeleton className="h-4 w-12" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-5 w-20 rounded-full" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-32" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-32" />
              </TableCell>
              <TableCell className="text-right">
                <Skeleton className="ml-auto h-4 w-16" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/**
 * MenuItemsAdmin — the page body. Renders the menu-items table
 * for the admin's own restaurant and owns the dialog state
 * (create / edit / remove).
 *
 * Why this is a single component rather than a `_components/`
 * file: the dialogs and the table are tightly coupled to the
 * same data source and the same query invalidation, and the
 * page is the only call site. Extracting a shared
 * `MenuItemsAdmin` would create a one-consumer abstraction.
 * Same pattern as the customer page owning its cart Sheet
 * inline.
 */
function MenuItemsAdmin() {
  const { user } = useAuth()
  const restaurantId = user?.rid

  const query = useRestaurant(restaurantId)
  const queryClient = useQueryClient()

  // Flatten menus -> items. Empty array while loading keeps
  // the table from flashing.
  const items = useMemo<MenuItemRead[]>(() => {
    const menus = query.data?.menus ?? []
    const out: MenuItemRead[] = []
    for (const m of menus) {
      for (const i of m.items) out.push(i)
    }
    return out
  }, [query.data])

  // --- Dialog state -----------------------------------------------------
  const [formState, setFormState] = useState<
    { mode: "create" } | { mode: "edit"; item: MenuItemRead } | null
  >(null)
  const [removeTarget, setRemoveTarget] = useState<MenuItemRead | null>(null)

  function invalidate() {
    if (restaurantId !== undefined) {
      queryClient.invalidateQueries({
        queryKey: ["restaurant", restaurantId],
      })
    }
  }

  // --- Guards -----------------------------------------------------------
  // `useRestaurant` is enabled only when `restaurantId` is a
  // number; the `rid === undefined` case below catches the
  // "no tenant" state defensively. The strict role gate in the
  // backend rejects global admins (rid === null) with 403, so
  // our admin1 seed has rid === 1 and this is the only path.
  if (restaurantId === undefined) {
    return (
      <EmptyAdminState
        title="No restaurant on this admin account"
        body="This admin account is not linked to a restaurant. The admin view needs a tenant."
      />
    )
  }

  if (query.isPending) {
    return <TableSkeleton />
  }

  if (query.isError) {
    return (
      <ErrorState
        error={query.error}
        onRetry={() => query.refetch()}
      />
    )
  }

  const restaurantName = query.data?.name ?? "Your restaurant"

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-[-0.02em] text-foreground sm:text-3xl">
            Menu items
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {restaurantName} · {items.length} item
            {items.length === 1 ? "" : "s"}
          </p>
        </div>
        <Button onClick={() => setFormState({ mode: "create" })}>
          <Plus aria-hidden="true" />
          New item
        </Button>
      </header>

      <div className="mt-6">
        {items.length === 0 ? (
          <EmptyAdminState
            title="No menu items yet"
            body="Add your first item to get started. It will appear in your customers' view immediately."
            action={
              <Button onClick={() => setFormState({ mode: "create" })}>
                <Plus aria-hidden="true" />
                New item
              </Button>
            }
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-24">Type</TableHead>
                  <TableHead className="w-28">Price</TableHead>
                  <TableHead className="w-32">Status</TableHead>
                  <TableHead className="w-44 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    onEdit={() => setFormState({ mode: "edit", item })}
                    onRemove={() => setRemoveTarget(item)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Create / edit dialog. A single component handles both modes
          so the form's validation, error slot, and submit lifecycle
          are defined in one place. */}
      {formState !== null ? (
        <MenuItemFormDialog
          state={formState}
          restaurantId={restaurantId}
          onClose={() => setFormState(null)}
          onSaved={() => {
            setFormState(null)
            invalidate()
          }}
        />
      ) : null}

      {/* Remove confirm dialog. PATCHes availability_status to
          "unavailable" — see the file header for the rationale. */}
      {removeTarget !== null ? (
        <RemoveItemDialog
          item={removeTarget}
          restaurantId={restaurantId}
          onClose={() => setRemoveTarget(null)}
          onRemoved={() => {
            setRemoveTarget(null)
            invalidate()
          }}
        />
      ) : null}
    </div>
  )
}

// --- Row ------------------------------------------------------------------

function ItemRow({
  item,
  onEdit,
  onRemove,
}: {
  item: MenuItemRead
  onEdit: () => void
  onRemove: () => void
}) {
  const unavailable = item.availability_status !== "available"

  return (
    <TableRow className={unavailable ? "opacity-60" : undefined}>
      <TableCell>
        <div className="font-medium text-foreground">{item.name}</div>
        {item.description ? (
          <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
            {item.description}
          </div>
        ) : null}
      </TableCell>
      <TableCell>
        <Badge variant="secondary" className="font-normal">
          {item.item_type}
        </Badge>
      </TableCell>
      <TableCell className="text-sm tabular-nums text-foreground">
        {formatPrice(item.price)}
      </TableCell>
      <TableCell>
        {unavailable ? (
          <Badge
            variant="outline"
            className="border-rose-300 bg-rose-100/60 text-rose-800 dark:border-rose-400/40 dark:bg-rose-400/10 dark:text-rose-200"
          >
            Unavailable
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="border-emerald-300 bg-emerald-100/60 text-emerald-800 dark:border-emerald-400/40 dark:bg-emerald-400/10 dark:text-emerald-200"
          >
            Available
          </Badge>
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="inline-flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onEdit}
            aria-label={`Edit ${item.name}`}
          >
            <Pencil aria-hidden="true" />
            Edit
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onRemove}
            disabled={unavailable}
            aria-label={`Remove ${item.name}`}
          >
            <Trash2 aria-hidden="true" />
            Remove
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}

// --- Create / Edit dialog -------------------------------------------------

/**
 * MenuItemFormDialog — the create-and-edit form, in one component.
 *
 * Two modes:
 *   - mode: "create"  — POST /restaurants/{id}/menu-items, all fields
 *     except `description` are required server-side; the form treats
 *     name, item_type, price as required (description is allowed to
 *     be empty).
 *   - mode: "edit"    — PATCH /restaurants/{id}/menu-items/{itemId},
 *     only the fields the user actually changes are sent. We start
 *     from the initial item's values and diff the form against them
 *     at submit time, so the PATCH stays minimal and the backend's
 *     `exclude_unset` behavior is mirrored client-side.
 *
 * Why a single component for both modes: the field set, the
 * validation, and the inline error slot are identical. Branching
 * on mode at the wire layer (create → POST, edit → PATCH) is
 * cheaper than branching on the field set.
 *
 * The price is collected as a string and only converted to a
 * number at submit time so the wire value matches the backend's
 * Decimal-as-string format exactly (`"12.50"`, not `12.5`).
 */
function MenuItemFormDialog({
  state,
  restaurantId,
  onClose,
  onSaved,
}: {
  state: { mode: "create" } | { mode: "edit"; item: MenuItemRead }
  restaurantId: number
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = state.mode === "edit"
  const initial: MenuItemRead | null = isEdit ? state.item : null

  // Form state. `priceString` stays a string so the user can
  // type "10." mid-keystroke without the form reformatting the
  // value under them. It's parsed to a number at submit time.
  const [name, setName] = useState(initial?.name ?? "")
  const [description, setDescription] = useState(initial?.description ?? "")
  const [itemType, setItemType] = useState<ItemType>(
    initial?.item_type ?? "Food",
  )
  const [priceString, setPriceString] = useState<string>(
    initial ? initial.price : "",
  )
  const [availability, setAvailability] = useState<MenuItemAvailability>(
    initial
      ? initial.availability_status === "available"
        ? "available"
        : "unavailable"
      : "available",
  )
  const [clientError, setClientError] = useState<string | null>(null)

  // Reset state when the dialog opens with a different target.
  // Without this, opening Edit on item A then Edit on item B
  // would briefly render A's values for B.
  useEffect(() => {
    setName(initial?.name ?? "")
    setDescription(initial?.description ?? "")
    setItemType(initial?.item_type ?? "Food")
    setPriceString(initial ? initial.price : "")
    setAvailability(
      initial
        ? initial.availability_status === "available"
          ? "available"
          : "unavailable"
        : "available",
    )
    setClientError(null)
  }, [initial])

  const create = useCreateMenuItem()
  const update = useUpdateMenuItem()
  const mutation = isEdit ? update : create
  const isPending = mutation.isPending

  function validate(): { ok: true; price: string } | { ok: false; msg: string } {
    const trimmed = name.trim()
    if (trimmed.length === 0) return { ok: false, msg: "Name is required." }
    if (trimmed.length > 120) {
      return { ok: false, msg: "Name must be 120 characters or fewer." }
    }
    if (description.length > 2000) {
      return {
        ok: false,
        msg: "Description must be 2000 characters or fewer.",
      }
    }
    const priceNum = Number(priceString)
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      return { ok: false, msg: "Price must be a number greater than 0." }
    }
    // Match the backend's max_digits=10, decimal_places=2.
    // 99999999.99 fits; 100000000 would not.
    if (priceNum >= 100_000_000) {
      return { ok: false, msg: "Price is too large." }
    }
    return { ok: true, price: priceNum.toFixed(2) }
  }

  function onSubmit() {
    setClientError(null)
    const v = validate()
    if (!v.ok) {
      setClientError(v.msg)
      return
    }

    if (isEdit && initial) {
      // Build a partial update that only includes fields the
      // user actually changed. Mirrors the backend's
      // `exclude_unset` behavior so the PATCH is minimal and
      // the server doesn't see stale values for fields the
      // user didn't touch.
      const body: Record<string, unknown> = {}
      if (name.trim() !== initial.name) body.name = name.trim()
      if ((description || null) !== (initial.description || null)) {
        body.description = description.length === 0 ? null : description
      }
      if (itemType !== initial.item_type) body.item_type = itemType
      if (v.price !== initial.price) body.price = v.price
      if (availability !== initial.availability_status) {
        body.availability_status = availability
      }
      if (Object.keys(body).length === 0) {
        // Nothing to change — close without a request.
        onSaved()
        return
      }
      update.mutate(
        { restaurantId, itemId: initial.id, body },
        {
          onSuccess: () => onSaved(),
          // Errors render inline below; dialog stays open so
          // the user can retry without losing their changes.
        },
      )
      return
    }

    // Create mode — send all fields. The backend requires
    // name, item_type, price; description and availability
    // are sent as their values (description may be "" — the
    // backend maps that to null via Optional handling).
    const body: MenuItemCreate = {
      name: name.trim(),
      description: description.length === 0 ? null : description,
      item_type: itemType,
      price: v.price,
      availability_status: availability,
    }
    create.mutate(
      { restaurantId, body },
      {
        onSuccess: () => onSaved(),
        // Errors render inline below; dialog stays open.
      },
    )
  }

  const errorMessage = clientError ?? describeError(mutation.error, "Could not save the menu item.")

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit item" : "New item"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Change the fields you want to update. Untouched fields stay as they are."
              : "Add a new item to your menu. Customers will see it immediately after you save."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field
            label="Name"
            htmlFor="menu-item-name"
            error={clientError && !name.trim() ? "Name is required." : null}
          >
            <Input
              id="menu-item-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              aria-invalid={!name.trim()}
              disabled={isPending}
            />
          </Field>

          <Field
            label="Description"
            htmlFor="menu-item-description"
            hint="Optional. Up to 2000 characters."
          >
            <Textarea
              id="menu-item-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              disabled={isPending}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Type" htmlFor="menu-item-type">
              <Select
                value={itemType}
                onValueChange={(v) => setItemType(v as ItemType)}
                disabled={isPending}
              >
                <SelectTrigger id="menu-item-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Food">Food</SelectItem>
                  <SelectItem value="Drink">Drink</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field
              label="Price"
              htmlFor="menu-item-price"
              error={
                clientError &&
                (!Number.isFinite(Number(priceString)) ||
                  Number(priceString) <= 0)
                  ? "Price must be greater than 0."
                  : null
              }
            >
              <Input
                id="menu-item-price"
                type="number"
                step="0.01"
                min="0.01"
                value={priceString}
                onChange={(e) => setPriceString(e.target.value)}
                disabled={isPending}
              />
            </Field>
          </div>

          <Field label="Availability" htmlFor="menu-item-availability">
            <Select
              value={availability}
              onValueChange={(v) => setAvailability(v as MenuItemAvailability)}
              disabled={isPending}
            >
              <SelectTrigger id="menu-item-availability" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="available">Available</SelectItem>
                <SelectItem value="unavailable">Unavailable</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>

        {/*
          Inline error slot. Same shape as the cart Sheet footer
          and the claim dialogs: role="alert" so the change is
          announced, destructive/30 border + destructive/5
          background for the rose tint. The dialog stays open
          so the user can retry without losing context.
        */}
        {errorMessage ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2"
          >
            <p className="text-sm text-destructive">{errorMessage}</p>
          </div>
        ) : null}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={onSubmit}
            disabled={isPending}
            aria-busy={isPending}
          >
            {isPending ? (
              <>
                <Loader2 aria-hidden="true" className="animate-spin" />
                Saving…
              </>
            ) : isEdit ? (
              "Save changes"
            ) : (
              "Create item"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Field — a labelled form row. Wraps the Label + control pair
 * with consistent vertical spacing, optional hint copy under
 * the label, and an inline error slot under the control. Used
 * only by the create/edit dialog, so it lives in this file.
 */
function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  error?: string | null
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>
        {label}
        {hint ? (
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

// --- Remove dialog --------------------------------------------------------

/**
 * RemoveItemDialog — confirm before flipping an item to
 * "unavailable". The dialog is honest about the action: it
 * doesn't say "delete" (no row is actually deleted), it says
 * "remove from the customer view" and offers re-enable via
 * Edit. One sentence of body, one Cancel, one Remove.
 *
 * The Remove button is destructive-styled via the `outline`
 * variant to match the row's outline button — we don't have
 * a true destructive variant, so a red text + a clear
 * "Remove" label does the work.
 */
function RemoveItemDialog({
  item,
  restaurantId,
  onClose,
  onRemoved,
}: {
  item: MenuItemRead
  restaurantId: number
  onClose: () => void
  onRemoved: () => void
}) {
  const setAvailability = useSetMenuItemAvailability()
  const isPending = setAvailability.isPending
  const errorMessage = describeError(
    setAvailability.error,
    "Could not remove the item.",
  )

  function onConfirm() {
    setAvailability.mutate(
      {
        restaurantId,
        itemId: item.id,
        availability: "unavailable",
      },
      {
        onSuccess: () => onRemoved(),
      },
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove &ldquo;{item.name}&rdquo;?</DialogTitle>
          <DialogDescription>
            Customers won&apos;t be able to order this item. You can
            re-enable it later by editing the item.
          </DialogDescription>
        </DialogHeader>

        {errorMessage ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2"
          >
            <p className="text-sm text-destructive">{errorMessage}</p>
          </div>
        ) : null}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isPending}
            aria-busy={isPending}
          >
            {isPending ? (
              <>
                <Loader2 aria-hidden="true" className="animate-spin" />
                Removing…
              </>
            ) : (
              "Remove"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// --- Skeleton / empty / error ---------------------------------------------

function TableSkeleton() {
  // Eight rows is enough to fill the viewport at typical
  // heights without committing to "the list is exactly this
  // long." Cell widths match the real table headers so the
  // layout doesn't shift on data load.
  return (
    <div
      className="overflow-hidden rounded-lg border border-border bg-card"
      aria-hidden="true"
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className="w-24">Type</TableHead>
            <TableHead className="w-28">Price</TableHead>
            <TableHead className="w-32">Status</TableHead>
            <TableHead className="w-44 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 8 }).map((_, i) => (
            <TableRow key={i}>
              <TableCell>
                <Skeleton className="h-4 w-40" />
                <Skeleton className="mt-1.5 h-3 w-56" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-5 w-14 rounded-full" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-16" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-5 w-20 rounded-full" />
              </TableCell>
              <TableCell className="text-right">
                <div className="inline-flex items-center gap-2">
                  <Skeleton className="h-7 w-16" />
                  <Skeleton className="h-7 w-20" />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function ErrorState({
  error,
  onRetry,
}: {
  error: ApiError | Error
  onRetry: () => void
}) {
  const isApi = error instanceof ApiError
  const message = isApi
    ? typeof error.detail === "string"
      ? error.detail
      : "Could not load your menu."
    : error.message || "Could not load your menu."
  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive/30 bg-destructive/5 p-4"
    >
      <p className="text-sm font-medium text-destructive">{message}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {isApi
          ? "Try again in a moment."
          : "Check your connection and try again."}
      </p>
      <div className="mt-3">
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </div>
  )
}

function EmptyAdminState({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action?: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-10 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      {action ? <div className="mt-4 inline-flex">{action}</div> : null}
    </div>
  )
}
