# Graph Report - Chowly-app  (2026-09-04)

## Corpus Check
- 92 files · ~53,098 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 714 nodes · 1700 edges · 47 communities (31 shown, 12 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 123 edges (avg confidence: 0.95)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `9d630c6a`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- cn
- api-error.ts
- schemas.py
- orders.py
- login/page.tsx
- dependencies
- app/layout.tsx
- compilerOptions
- devDependencies
- restaurant.ts
- components.json
- models.py
- admin/page.tsx
- get_db
- Product
- restaurants.py
- customer/page.tsx
- env.py
- eslint.config.mjs
- next.config.ts
- postcss.config.mjs
- [orderId]/page.tsx
- README.md
- AGENTS.md
- CLAUDE.md
- waiter/page.tsx
- use-login.ts
- index.ts
- cart-button.tsx
- package.json
- api-client.ts
- healthcheck
- jwt-decode
- lucide-react
- next-themes
- radix-ui
- tailwind-merge
- @tanstack/react-query-devtools
- tw-animate-css
- User
- staff-dashboard.tsx
- complaint-status-badge.tsx
- use-order.ts

## God Nodes (most connected - your core abstractions)
1. `cn()` - 55 edges
2. `User` - 32 edges
3. `ApiError` - 28 edges
4. `get_db()` - 26 edges
5. `get_current_user()` - 25 edges
6. `useAuth()` - 24 edges
7. `Role` - 22 edges
8. `create_order()` - 21 edges
9. `Restaurant` - 17 edges
10. `list_orders()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `get_current_user()` --uses--> `User`  [INFERRED]
  chowly-backend/app/auth.py → chowly-backend/app/models.py
- `register()` --uses--> `Role`  [INFERRED]
  chowly-backend/app/routers/auth.py → chowly-backend/app/models.py
- `_require()` --uses--> `Role`  [INFERRED]
  chowly-backend/app/routers/auth.py → chowly-backend/app/models.py
- `_require_order_access()` --uses--> `Role`  [INFERRED]
  chowly-backend/app/routers/feedback.py → chowly-backend/app/models.py
- `update_complaint()` --uses--> `Role`  [INFERRED]
  chowly-backend/app/routers/feedback.py → chowly-backend/app/models.py

## Import Cycles
- None detected.

## Communities (47 total, 12 thin omitted)

### Community 0 - "cn"
Cohesion: 0.17
Nodes (19): Select(), SelectContent(), SelectGroup(), SelectItem(), SelectLabel(), SelectScrollDownButton(), SelectScrollUpButton(), SelectSeparator() (+11 more)

### Community 1 - "api-error.ts"
Cohesion: 0.15
Nodes (15): ClaimOrderInput, useClaimOrder(), MarkServedInput, useMarkServed(), ResolveComplaintInput, useResolveComplaint(), SetMenuItemAvailabilityInput, useSetMenuItemAvailability() (+7 more)

### Community 2 - "schemas.py"
Cohesion: 0.05
Nodes (56): Any, BaseModel, login(), Depends, post, Role, Session, Raise HTTP 400 if a required field is missing for the given role. (+48 more)

### Community 3 - "orders.py"
Cohesion: 0.14
Nodes (36): ItemType, Order, OrderItemStatus, OrderStatus, Order — a customer's ticket for one or more menu items., OrderItem — per-line preparation state. PREPARING covers both the "unclaimed"…, Role, claim_order_item() (+28 more)

### Community 4 - "login/page.tsx"
Cohesion: 0.24
Nodes (9): Card(), CardAction(), CardContent(), CardDescription(), CardFooter(), CardHeader(), CardTitle(), Input() (+1 more)

### Community 5 - "dependencies"
Cohesion: 0.12
Nodes (17): dependencies, class-variance-authority, clsx, next, react, react-dom, shadcn, sonner (+9 more)

### Community 6 - "app/layout.tsx"
Cohesion: 0.17
Nodes (11): geistMono, geistSans, metadata, Toaster(), CartContext, CartContextValue, CartLine, CartProvider() (+3 more)

### Community 7 - "compilerOptions"
Cohesion: 0.07
Nodes (28): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+20 more)

### Community 8 - "devDependencies"
Cohesion: 0.12
Nodes (17): devDependencies, eslint, eslint-config-next, tailwindcss, @tailwindcss/postcss, @types/node, @types/react, @types/react-dom (+9 more)

### Community 9 - "restaurant.ts"
Cohesion: 0.18
Nodes (12): OrderItemClaimResponse, OrderItemRead, OrderItemStatus, OrderUpdate, BartenderRead, ChefRead, CustomerRead, ItemType (+4 more)

### Community 10 - "components.json"
Cohesion: 0.09
Nodes (21): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+13 more)

### Community 11 - "models.py"
Cohesion: 0.15
Nodes (27): Base, Bartender, Chef, Customer, Menu, MenuItem, OrderItem, Payment (+19 more)

### Community 12 - "admin/page.tsx"
Cohesion: 0.11
Nodes (14): ComplaintRow(), CURRENCY, formatComplaintDate(), formatPrice(), ItemRow(), truncateComplaintText(), Dialog(), DialogContent() (+6 more)

### Community 13 - "get_db"
Cohesion: 0.16
Nodes (28): get_current_user(), Depends, Session, Decode the bearer token from the Authorization header and load the…, get_db(), FastAPI dependency that yields a SQLAlchemy session and ensures it is closed…, Complaint, ComplaintStatus (+20 more)

### Community 14 - "Product"
Cohesion: 0.17
Nodes (11): Accessibility & Inclusion, Brand Commitments, Capabilities and Constraints, Evidence on Hand, Operating Context, Platform, Positioning, Product (+3 more)

### Community 15 - "restaurants.py"
Cohesion: 0.12
Nodes (27): create_menu_item(), get_restaurant(), _get_single_menu_for_restaurant(), list_restaurant_complaints(), list_restaurants(), alias, ComplaintRead, Depends (+19 more)

### Community 16 - "customer/page.tsx"
Cohesion: 0.06
Nodes (43): ComplaintsAdmin(), MenuItemsAdmin(), invalidate(), StaffDashboard(), useNow(), CartControls(), CURRENCY, CustomerDashboard() (+35 more)

### Community 17 - "env.py"
Cohesion: 0.33
Nodes (5): Alembic environment configuration for the Chowly backend. Loads DATABASE_URL…, Run migrations in 'offline' mode. This configures the context with just a URL…, Run migrations in 'online' mode. In this scenario we need to create an Engine…, run_migrations_offline(), run_migrations_online()

### Community 23 - "[orderId]/page.tsx"
Cohesion: 0.09
Nodes (18): CancelledCard(), ComplaintBody(), CURRENCY, formatFeedbackDate(), formatOrderDate(), formatPrice(), OrderLineRow(), OrderView() (+10 more)

### Community 24 - "README.md"
Cohesion: 0.50
Nodes (3): Deploy on Vercel, Getting Started, Learn More

### Community 28 - "waiter/page.tsx"
Cohesion: 0.06
Nodes (29): MenuItemFormDialog(), onSubmit(), validate(), RemoveItemDialog(), ResolveComplaintDialog(), ComplaintSubSection(), FeedbackCard(), FileComplaintDialog() (+21 more)

### Community 29 - "use-login.ts"
Cohesion: 0.33
Nodes (5): useLogin(), LoginRequest, RegisterRequest, TokenResponse, UserRead

### Community 30 - "index.ts"
Cohesion: 0.14
Nodes (13): STATUS_CHIP, useOrders(), useRating(), useRestaurantComplaints(), apiGet(), ComplaintCreate, ComplaintRead, PaymentRead (+5 more)

### Community 31 - "cart-button.tsx"
Cohesion: 0.20
Nodes (12): CURRENCY, Button(), buttonVariants, Sheet(), SheetContent(), SheetDescription(), SheetFooter(), SheetHeader() (+4 more)

### Community 32 - "package.json"
Cohesion: 0.22
Nodes (8): name, private, scripts, build, dev, lint, start, version

### Community 33 - "api-client.ts"
Cohesion: 0.15
Nodes (16): CreateMenuItemInput, useCreateMenuItem(), FileComplaintInput, useFileComplaint(), FileRatingInput, useFileRating(), usePlaceOrder(), apiDelete() (+8 more)

### Community 34 - "healthcheck"
Cohesion: 0.67
Nodes (3): healthcheck(), get, Liveness probe. No DB hit — used by load balancers and uptime checks.

### Community 42 - "User"
Cohesion: 0.11
Nodes (21): create_access_token(), decode_access_token(), hash_password(), Authentication helpers for the Chowly backend. Password hashing/verification…, Return a bcrypt hash for the given plaintext password., Return True if `plain` matches the stored bcrypt `hashed` value., Issue a signed JWT for the given subject (typically the user id).…, Decode and validate a JWT, raising HTTP 401 on any failure. (+13 more)

### Community 43 - "staff-dashboard.tsx"
Cohesion: 0.13
Nodes (12): formatOrderDateTime(), formatRelative(), LineRow(), RTF, StaffDashboardProps, StaffLine, UpdatedHint(), OrderStatusBadge() (+4 more)

### Community 44 - "complaint-status-badge.tsx"
Cohesion: 0.38
Nodes (5): ComplaintStatusBadge(), STATUS_CHIP, Badge(), badgeVariants, ComplaintStatus

### Community 45 - "use-order.ts"
Cohesion: 0.67
Nodes (3): OrderDashboard(), isTerminalOrder(), useOrder()

## Knowledge Gaps
- **140 isolated node(s):** `$schema`, `style`, `rsc`, `tsx`, `config` (+135 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 297 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **12 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `cn()` connect `cn` to `login/page.tsx`, `admin/page.tsx`, `complaint-status-badge.tsx`, `customer/page.tsx`, `[orderId]/page.tsx`, `cart-button.tsx`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **Why does `describeError()` connect `waiter/page.tsx` to `api-error.ts`, `staff-dashboard.tsx`, `admin/page.tsx`, `customer/page.tsx`, `[orderId]/page.tsx`, `cart-button.tsx`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Why does `useAuth()` connect `customer/page.tsx` to `login/page.tsx`, `staff-dashboard.tsx`, `admin/page.tsx`, `waiter/page.tsx`, `use-login.ts`, `cart-button.tsx`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **Are the 22 inferred relationships involving `User` (e.g. with `get_current_user()` and `login()`) actually correct?**
  _`User` has 22 INFERRED edges - model-reasoned connections that need verification._
- **What connects `$schema`, `style`, `rsc` to the rest of the system?**
  _140 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `api-error.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.14761904761904762 - nodes in this community are weakly interconnected._
- **Should `schemas.py` be split into smaller, more focused modules?**
  _Cohesion score 0.05143191116306254 - nodes in this community are weakly interconnected._