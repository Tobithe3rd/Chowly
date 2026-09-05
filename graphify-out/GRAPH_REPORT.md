# Graph Report - Chowly-app  (2026-09-05)

## Corpus Check
- 98 files · ~61,501 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 751 nodes · 1863 edges · 50 communities (32 shown, 14 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 123 edges (avg confidence: 0.95)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `d4fef115`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- cn
- api-error.ts
- schemas.py
- orders.py
- orders/page.tsx
- dependencies
- cart-button.tsx
- compilerOptions
- devDependencies
- restaurant.ts
- components.json
- models.py
- admin/page.tsx
- User
- Product
- restaurants.py
- customer/page.tsx
- env.py
- eslint.config.mjs
- next.config.ts
- postcss.config.mjs
- customer/orders/[orderId]/page.tsx
- README.md
- AGENTS.md
- CLAUDE.md
- waiter/page.tsx
- index.ts
- api-client.ts
- claim-button.tsx
- package.json
- use-file-rating.ts
- healthcheck
- jwt-decode
- lucide-react
- next-themes
- radix-ui
- tailwind-merge
- @tanstack/react-query-devtools
- tw-animate-css
- main.py
- staff-dashboard.tsx
- order-status-badge.tsx
- register
- auth-provider.tsx
- order.ts
- ._resolve_menu_item_fields

## God Nodes (most connected - your core abstractions)
1. `cn()` - 55 edges
2. `User` - 32 edges
3. `ApiError` - 32 edges
4. `get_db()` - 26 edges
5. `useAuth()` - 26 edges
6. `get_current_user()` - 25 edges
7. `Role` - 22 edges
8. `create_order()` - 21 edges
9. `describeError()` - 20 edges
10. `Button()` - 18 edges

## Surprising Connections (you probably didn't know these)
- `register()` --uses--> `Role`  [INFERRED]
  chowly-backend/app/routers/auth.py → chowly-backend/app/models.py
- `_require()` --uses--> `Role`  [INFERRED]
  chowly-backend/app/routers/auth.py → chowly-backend/app/models.py
- `_require_order_access()` --uses--> `Role`  [INFERRED]
  chowly-backend/app/routers/feedback.py → chowly-backend/app/models.py
- `update_complaint()` --uses--> `Role`  [INFERRED]
  chowly-backend/app/routers/feedback.py → chowly-backend/app/models.py
- `_require_staff_for_restaurant()` --uses--> `Role`  [INFERRED]
  chowly-backend/app/routers/restaurants.py → chowly-backend/app/models.py

## Import Cycles
- None detected.

## Communities (50 total, 14 thin omitted)

### Community 0 - "cn"
Cohesion: 0.23
Nodes (12): Input(), Label(), SelectContent(), SelectGroup(), SelectItem(), SelectLabel(), SelectScrollDownButton(), SelectScrollUpButton() (+4 more)

### Community 1 - "api-error.ts"
Cohesion: 0.15
Nodes (14): ClaimOrderInput, MarkDelayedInput, MarkLineReadyInput, useMarkLineReady(), MarkServedInput, ResolveComplaintInput, useResolveComplaint(), SetMenuItemAvailabilityInput (+6 more)

### Community 2 - "schemas.py"
Cohesion: 0.07
Nodes (47): BaseModel, ItemType, OrderItemStatus, PaymentStatus, OrderItem — per-line preparation state. PREPARING covers both the "unclaimed"…, BartenderRead, ChefRead, ComplaintCreate (+39 more)

### Community 3 - "orders.py"
Cohesion: 0.15
Nodes (32): Order, OrderItem, OrderStatus, Order — a customer's ticket for one or more menu items., OrderItem — a single line item on an order, routed to chef or bartender., Role, claim_order_item(), _compute_all_lines_ready() (+24 more)

### Community 4 - "orders/page.tsx"
Cohesion: 0.15
Nodes (13): CURRENCY, CustomerOrdersDashboard(), formatOrderDate(), formatPrice(), summarizeItems(), Table(), TableBody(), TableCaption() (+5 more)

### Community 5 - "dependencies"
Cohesion: 0.12
Nodes (17): dependencies, class-variance-authority, clsx, next, react, react-dom, shadcn, sonner (+9 more)

### Community 6 - "cart-button.tsx"
Cohesion: 0.08
Nodes (26): CartControls(), geistMono, geistSans, metadata, CartButton(), buildPayload(), onPlaceOrder(), CURRENCY (+18 more)

### Community 7 - "compilerOptions"
Cohesion: 0.07
Nodes (28): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+20 more)

### Community 8 - "devDependencies"
Cohesion: 0.12
Nodes (17): devDependencies, eslint, eslint-config-next, tailwindcss, @tailwindcss/postcss, @types/node, @types/react, @types/react-dom (+9 more)

### Community 9 - "restaurant.ts"
Cohesion: 0.12
Nodes (17): MenuItemFormDialog(), onSubmit(), validate(), CreateMenuItemInput, useCreateMenuItem(), UpdateMenuItemInput, useUpdateMenuItem(), BartenderRead (+9 more)

### Community 10 - "components.json"
Cohesion: 0.09
Nodes (21): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+13 more)

### Community 11 - "models.py"
Cohesion: 0.10
Nodes (36): Base, create_access_token(), hash_password(), Authentication helpers for the Chowly backend. Password hashing/verification…, Return a bcrypt hash for the given plaintext password., Return True if `plain` matches the stored bcrypt `hashed` value., Issue a signed JWT for the given subject (typically the user id).…, verify_password() (+28 more)

### Community 12 - "admin/page.tsx"
Cohesion: 0.12
Nodes (11): ComplaintRow(), CURRENCY, formatComplaintDate(), formatPrice(), ItemRow(), RemoveItemDialog(), ResolveComplaintDialog(), truncateComplaintText() (+3 more)

### Community 13 - "User"
Cohesion: 0.15
Nodes (31): decode_access_token(), get_current_user(), Depends, Session, Decode the bearer token from the Authorization header and load the…, Decode and validate a JWT, raising HTTP 401 on any failure., get_db(), FastAPI dependency that yields a SQLAlchemy session and ensures it is closed… (+23 more)

### Community 14 - "Product"
Cohesion: 0.17
Nodes (11): Accessibility & Inclusion, Brand Commitments, Capabilities and Constraints, Evidence on Hand, Operating Context, Platform, Positioning, Product (+3 more)

### Community 15 - "restaurants.py"
Cohesion: 0.11
Nodes (34): Menu, MenuItem, Restaurant — keeps records of restaurants using Chowly., Menu — a curated list of items a restaurant offers., MenuItem — a single dish or drink on a menu, priced and bookable., Restaurant, create_menu_item(), get_restaurant() (+26 more)

### Community 16 - "customer/page.tsx"
Cohesion: 0.07
Nodes (34): ComplaintsAdmin(), MenuItemsAdmin(), invalidate(), StaffDashboard(), useNow(), CURRENCY, CustomerDashboard(), formatPrice() (+26 more)

### Community 17 - "env.py"
Cohesion: 0.33
Nodes (5): Alembic environment configuration for the Chowly backend. Loads DATABASE_URL…, Run migrations in 'offline' mode. This configures the context with just a URL…, Run migrations in 'online' mode. In this scenario we need to create an Engine…, run_migrations_offline(), run_migrations_online()

### Community 23 - "customer/orders/[orderId]/page.tsx"
Cohesion: 0.05
Nodes (36): CancelledCard(), ComplaintBody(), ComplaintSubSection(), CURRENCY, FileComplaintDialog(), onSubmit(), FileRatingDialog(), onSubmit() (+28 more)

### Community 24 - "README.md"
Cohesion: 0.50
Nodes (3): Deploy on Vercel, Getting Started, Learn More

### Community 28 - "waiter/page.tsx"
Cohesion: 0.11
Nodes (19): FeedbackCard(), ActionGroup(), OrderComplaintBadge(), CURRENCY, formatOrderDateTime(), formatPrice(), formatRelative(), OrderComplaintIndicator() (+11 more)

### Community 29 - "index.ts"
Cohesion: 0.16
Nodes (13): ClaimOrderItemInput, useClaimOrderItem(), FileComplaintInput, useFileComplaint(), useLogin(), usePlaceOrder(), apiPost(), LoginRequest (+5 more)

### Community 30 - "api-client.ts"
Cohesion: 0.22
Nodes (11): useRating(), useRestaurantComplaints(), apiDelete(), apiFetch(), ApiFetchOptions, apiGet(), getBaseUrl(), safeJsonParse() (+3 more)

### Community 31 - "claim-button.tsx"
Cohesion: 0.17
Nodes (16): ClaimButton(), MarkDelayedButton(), MarkServedButton(), Button(), buttonVariants, Dialog(), DialogContent(), DialogDescription() (+8 more)

### Community 32 - "package.json"
Cohesion: 0.22
Nodes (8): name, private, scripts, build, dev, lint, start, version

### Community 33 - "use-file-rating.ts"
Cohesion: 0.29
Nodes (6): FileRatingInput, useFileRating(), PaymentRead, PaymentStatus, RatingCreate, RatingRead

### Community 34 - "healthcheck"
Cohesion: 0.67
Nodes (3): healthcheck(), get, Liveness probe. No DB hit — used by load balancers and uptime checks.

### Community 43 - "staff-dashboard.tsx"
Cohesion: 0.16
Nodes (8): formatOrderDateTime(), formatRelative(), LineRow(), RTF, StaffDashboardProps, StaffLine, UpdatedHint(), Skeleton()

### Community 44 - "order-status-badge.tsx"
Cohesion: 0.47
Nodes (4): OrderStatusBadge(), STATUS_CHIP, Badge(), badgeVariants

### Community 45 - "register"
Cohesion: 0.20
Nodes (12): login(), Depends, post, Role, Session, Raise HTTP 400 if a required field is missing for the given role., register(), _require() (+4 more)

### Community 46 - "auth-provider.tsx"
Cohesion: 0.35
Nodes (9): DecodedTokenPayload, decodeToken(), clearToken(), getToken(), hasWindow(), setToken(), TOKEN_STORAGE_KEY, AuthProvider() (+1 more)

### Community 48 - "order.ts"
Cohesion: 0.38
Nodes (6): OrderItemClaimResponse, OrderItemCreate, OrderItemRead, OrderItemStatus, OrderUpdate, ItemType

## Knowledge Gaps
- **143 isolated node(s):** `$schema`, `style`, `rsc`, `tsx`, `config` (+138 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 312 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **14 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `cn()` connect `cn` to `orders/page.tsx`, `cart-button.tsx`, `staff-dashboard.tsx`, `order-status-badge.tsx`, `customer/page.tsx`, `customer/orders/[orderId]/page.tsx`, `claim-button.tsx`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **Why does `ApiError` connect `api-error.ts` to `use-file-rating.ts`, `orders/page.tsx`, `restaurant.ts`, `staff-dashboard.tsx`, `admin/page.tsx`, `customer/page.tsx`, `customer/orders/[orderId]/page.tsx`, `waiter/page.tsx`, `index.ts`, `api-client.ts`, `claim-button.tsx`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Why does `useAuth()` connect `customer/page.tsx` to `cart-button.tsx`, `staff-dashboard.tsx`, `admin/page.tsx`, `customer/orders/[orderId]/page.tsx`, `waiter/page.tsx`, `index.ts`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Are the 22 inferred relationships involving `User` (e.g. with `get_current_user()` and `login()`) actually correct?**
  _`User` has 22 INFERRED edges - model-reasoned connections that need verification._
- **What connects `$schema`, `style`, `rsc` to the rest of the system?**
  _143 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `schemas.py` be split into smaller, more focused modules?**
  _Cohesion score 0.07092198581560284 - nodes in this community are weakly interconnected._
- **Should `orders/page.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.14736842105263157 - nodes in this community are weakly interconnected._