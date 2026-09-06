# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Chowly serves five distinct user roles within a single restaurant tenant:

- **Customer** — sits at a table, browses the menu, places an order, tracks it through to "served," and afterwards can file a complaint or leave a rating. Largest user base, broadest reach, and the only role a guest ever sees directly.
- **Waiter** — picks up unclaimed orders, assigns them to a chef or bartender (per item type), updates the order's `status` (In Preparation / Delayed / Served / Cancelled), and updates the ETA. Floor-facing, time-pressured.
- **Chef** — sees the food lines of open orders, claims individual lines to start working on them. Kitchen-facing, claim-many, see-many.
- **Bartender** — same as chef but for drink lines. Bar-facing.
- **Admin** — tenant-scoped manager of the restaurant. Manages menu items at their restaurant (create, edit, price, availability).

All five land in different dashboards under the same app shell.

## Product Purpose

Chowly is a restaurant digital dining platform that replaces the back-of-house paper-and-shout workflow with a single shared order state. One order flows from the customer's phone through the waiter's pickup, splits to the chef and bartender for parallel preparation, and returns to the customer as a served meal they can rate.

Success means: the customer sees the same truth the staff does; the waiter never has to ask the kitchen where a dish is; the chef and bartender never see each other's lines; and the admin can change a menu item's price without calling anyone.

## Positioning

Chowly's meaningfully different mechanism is *item-level* claim: a single order is parallelized to the kitchen and the bar by menu item type, so a drink doesn't wait behind a stew, and either station can claim and progress its own work without coordinating with the other. The customer watches a unified timeline; the staff each see only their lane.

## Operating Context

- **Tenancy:** each restaurant is a tenant. Menu items, orders, complaints, and ratings are scoped to a restaurant (`restaurant_id`). The JWT carries `rid`; the staff and admin roles are tenant-scoped.
- **Lifecycle states (order):** `Pending` → `In Preparation` (or `Delayed` from any non-terminal state) → `Served` (terminal happy path) or `Cancelled` (terminal sad path).
- **Lifecycle states (order item):** `unclaimed` → `claimed` (by a chef or bartender) → prepared (implicit on the order-level status change).
- **Devices:** customers on a phone browser at the table; staff on a tablet or a workstation at the bar/kitchen/floor. Both are "web" — no native app yet.
- **Demo data:** a single tenant, "Mama Put Kitchen," is seeded with five demo accounts (one per role) all sharing password `chowly123`. Login and the role dashboards are fully exercisable from the seed alone.

## Capabilities and Constraints

**Confirmed functionality (already in the backend, exposed via REST):**
- JWT auth (login + register), 24-hour expiry, no refresh.
- Public restaurant listing; per-restaurant menu detail.
- Order create (customer), order read (owner), order PATCH (waiter/admin for status, ETA, and assignment).
- Order-item claim (chef/bartender), one per item, returns 409 on double-claim.
- Complaint file (customer, on a served order); rating file (customer, 1–5 stars + optional comment).
- Menu item CRUD (admin only, tenant-scoped).
- CORS is configured at the backend; the frontend reads `NEXT_PUBLIC_API_BASE_URL`.

**Confirmed technical constraints:**
- Next.js 16 App Router, TypeScript strict, React 19, Turbopack.
- shadcn/ui on the `radix-nova` preset; Tailwind CSS with CSS variables.
- React Query v5 for server state; React Context for auth state.
- LocalStorage token persistence (acceptable for a demo; backend JWT TTL is 24h).

**Out of scope (explicit):** payment (no backend routes), WebSocket / live updates (manual refresh), super-admin / cross-tenant views, image uploads on menu items, internationalization, automated tests on the frontend.

**Open decisions to surface in the design system, not PRODUCT.md:** color palette, type pairings, the specific role badge taxonomy, iconography. These are visual decisions; init does not set them.

## Brand Commitments

- **Name:** "Chowly." No other name has been requested. The wordmark is the brand.
- **Voice:** bold and vibrant. Cobalt-blue primary, citrus-yellow accent, a 32px dual-color brand mark, and a display-weight wordmark. The chrome carries the energy; the data on the cards still reads as a restaurant dashboard, not a marketing surface. The semantic status palette (sky/amber/emerald/rose for in-flight/warning/done/terminal) is locked and does not move with rebrand passes.
- **Primary audience for design decisions:** the customer. Customer-facing tone carries through to staff dashboards. Staff dashboards do not become more utilitarian at the cost of customer warmth.
- **No formal brand book yet.** No fixed palette, no committed typeface, no logo. Future work establishes these; init captures that they are open.

## Evidence on Hand

- Backend seed: a single tenant "Mama Put Kitchen" with seeded menu items, orders in multiple lifecycle states, one delayed order with a complaint and a 3-star rating, and one fully-served order eligible for rating.
- Demo accounts (all `chowly123`): `customer1@chowlydemo.com`, `customer2@chowlydemo.com`, `waiter1@chowlydemo.com`, `chef1@chowlydemo.com`, `bartender1@chowlydemo.com`, `admin1@chowlydemo.com` — all linked to Mama Put Kitchen.
- The live app boots, all five dashboards render placeholders behind a `RouteGuard`, login redirects by role, and the build is clean.

## Product Principles

1. **One order, many views.** The customer, the waiter, the chef, and the bartender should never disagree about what state an order is in. If they do, the system is wrong.
2. **Show the lane, not the load.** The chef sees food; the bartender sees drinks. Neither needs the other to do their job.
3. **Optimize for the customer, never at the staff's expense.** A warm wordmark and a hint of color don't make a kitchen slower; they make a customer more comfortable.
4. **The role badge is the navigation.** Five different roles, five different jobs, one shared shell. The badge tells you whose dashboard you are on.
5. **Failure is visible, never silent.** A 401, a 403, a missing restaurant, a stale order — these surface as state, not as a blank page. The frontend treats them as design material, not as edge cases to handle quietly.

## Accessibility & Inclusion

No formal standard (WCAG 2.1 AA) has been committed yet, but the design should hold itself to AA in practice: sufficient color contrast for any accent color chosen in the visual system, semantic HTML for the role badge and wordmark (not just a styled span), focusable interactive elements, and an `aria-live` polite region for any future toast / notification system. No commitment to a specific standard is recorded until the user asks.
