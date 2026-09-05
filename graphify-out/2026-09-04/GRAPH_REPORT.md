# Graph Report - Chowly-app  (2026-09-04)

## Corpus Check
- 91 files · ~50,680 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 703 nodes · 1680 edges · 46 communities (29 shown, 13 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 123 edges (avg confidence: 0.95)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `9d630c6a`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- describeError
- api-client.ts
- schemas.py
- orders.py
- cn
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
- User
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
- index.ts
- api-error.ts
- button.tsx
- package.json
- apiPost
- healthcheck
- jwt-decode
- lucide-react
- next-themes
- radix-ui
- tailwind-merge
- @tanstack/react-query-devtools
- tw-animate-css
- Restaurant
- staff-dashboard.tsx
- complaint-status-badge.tsx

## God Nodes (most connected - your core abstractions)
1. `cn()` - 53 edges
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

## Communities (46 total, 13 thin omitted)

### Community 0 - "describeError"
Cohesion: 0.13
Nodes (14): MenuItemFormDialog(), onSubmit(), validate(), RemoveItemDialog(), ResolveComplaintDialog(), ComplaintSubSection(), FileComplaintDialog(), onSubmit() (+6 more)

### Community 1 - "api-client.ts"
Cohesion: 0.13
Nodes (19): ClaimOrderInput, useClaimOrder(), MarkLineReadyInput, MarkServedInput, useMarkServed(), ResolveComplaintInput, useResolveComplaint(), SetMenuItemAvailabilityInput (+11 more)

### Community 2 - "schemas.py"
Cohesion: 0.05
Nodes (54): Any, BaseModel, login(), Depends, post, Role, Session, Raise HTTP 400 if a required field is missing for the given role. (+46 more)

### Community 3 - "orders.py"
Cohesion: 0.13
Nodes (38): ItemType, Order, OrderItemStatus, OrderStatus, Order — a customer's ticket for one or more menu items., OrderItem — per-line preparation state. PREPARING covers both the "unclaimed"…, Role, claim_order_item() (+30 more)

### Community 4 - "cn"
Cohesion: 0.18
Nodes (19): Card(), CardAction(), CardContent(), CardDescription(), CardFooter(), CardHeader(), CardTitle(), Input() (+11 more)

### Community 5 - "dependencies"
Cohesion: 0.12
Nodes (17): dependencies, class-variance-authority, clsx, next, react, react-dom, shadcn, sonner (+9 more)

### Community 6 - "app/layout.tsx"
Cohesion: 0.12
Nodes (20): geistMono, geistSans, metadata, Toaster(), DecodedTokenPayload, decodeToken(), clearToken(), getToken() (+12 more)

### Community 7 - "compilerOptions"
Cohesion: 0.07
Nodes (28): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+20 more)

### Community 8 - "devDependencies"
Cohesion: 0.12
Nodes (17): devDependencies, eslint, eslint-config-next, tailwindcss, @tailwindcss/postcss, @types/node, @types/react, @types/react-dom (+9 more)

### Community 9 - "restaurant.ts"
Cohesion: 0.16
Nodes (13): OrderItemClaimResponse, OrderItemCreate, OrderItemRead, OrderItemStatus, OrderUpdate, BartenderRead, ChefRead, CustomerRead (+5 more)

### Community 10 - "components.json"
Cohesion: 0.09
Nodes (21): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+13 more)

### Community 11 - "models.py"
Cohesion: 0.14
Nodes (27): Base, Database configuration for Chowly backend. Sets up the SQLAlchemy engine,…, Bartender, Chef, Customer, Menu, MenuItem, OrderItem (+19 more)

### Community 12 - "admin/page.tsx"
Cohesion: 0.11
Nodes (17): ComplaintRow(), CURRENCY, formatComplaintDate(), formatPrice(), ItemRow(), truncateComplaintText(), Select(), SelectValue() (+9 more)

### Community 13 - "get_db"
Cohesion: 0.16
Nodes (28): get_current_user(), Depends, Session, Decode the bearer token from the Authorization header and load the…, get_db(), FastAPI dependency that yields a SQLAlchemy session and ensures it is closed…, Complaint, ComplaintStatus (+20 more)

### Community 14 - "Product"
Cohesion: 0.17
Nodes (11): Accessibility & Inclusion, Brand Commitments, Capabilities and Constraints, Evidence on Hand, Operating Context, Platform, Positioning, Product (+3 more)

### Community 15 - "User"
Cohesion: 0.10
Nodes (30): FastAPI application entry point for the Chowly backend. Wires together routers,…, User — authentication record for anyone who can log in to Chowly., User, create_menu_item(), get_restaurant(), _get_single_menu_for_restaurant(), list_restaurant_complaints(), list_restaurants() (+22 more)

### Community 16 - "customer/page.tsx"
Cohesion: 0.05
Nodes (43): ComplaintsAdmin(), MenuItemsAdmin(), invalidate(), CartControls(), CURRENCY, CustomerDashboard(), formatPrice(), groupByType() (+35 more)

### Community 17 - "env.py"
Cohesion: 0.33
Nodes (5): Alembic environment configuration for the Chowly backend. Loads DATABASE_URL…, Run migrations in 'offline' mode. This configures the context with just a URL…, Run migrations in 'online' mode. In this scenario we need to create an Engine…, run_migrations_offline(), run_migrations_online()

### Community 23 - "[orderId]/page.tsx"
Cohesion: 0.09
Nodes (18): ComplaintBody(), CURRENCY, formatFeedbackDate(), formatOrderDate(), formatPrice(), OrderDashboard(), OrderLineRow(), OrderView() (+10 more)

### Community 24 - "README.md"
Cohesion: 0.50
Nodes (3): Deploy on Vercel, Getting Started, Learn More

### Community 28 - "waiter/page.tsx"
Cohesion: 0.11
Nodes (13): FeedbackCard(), canClaim(), CURRENCY, formatOrderDateTime(), formatPrice(), formatRelative(), OrderComplaintIndicator(), OrderRow() (+5 more)

### Community 29 - "index.ts"
Cohesion: 0.23
Nodes (6): STATUS_CHIP, LoginRequest, RegisterRequest, TokenResponse, UserRead, OrderStatus

### Community 30 - "api-error.ts"
Cohesion: 0.19
Nodes (10): usePlaceOrder(), useRating(), useRestaurantComplaints(), apiGet(), ApiError, ValidationErrorItem, ComplaintRead, OrderCreate (+2 more)

### Community 32 - "package.json"
Cohesion: 0.22
Nodes (8): name, private, scripts, build, dev, lint, start, version

### Community 33 - "apiPost"
Cohesion: 0.15
Nodes (13): CreateMenuItemInput, useCreateMenuItem(), FileComplaintInput, useFileComplaint(), FileRatingInput, useFileRating(), apiPost(), ComplaintCreate (+5 more)

### Community 34 - "healthcheck"
Cohesion: 0.67
Nodes (3): healthcheck(), get, Liveness probe. No DB hit — used by load balancers and uptime checks.

### Community 42 - "Restaurant"
Cohesion: 0.13
Nodes (18): create_access_token(), decode_access_token(), hash_password(), Authentication helpers for the Chowly backend. Password hashing/verification…, Return a bcrypt hash for the given plaintext password., Return True if `plain` matches the stored bcrypt `hashed` value., Issue a signed JWT for the given subject (typically the user id).…, Decode and validate a JWT, raising HTTP 401 on any failure. (+10 more)

### Community 43 - "staff-dashboard.tsx"
Cohesion: 0.11
Nodes (16): formatOrderDateTime(), formatRelative(), LineRow(), RTF, StaffDashboard(), StaffDashboardProps, StaffLine, UpdatedHint() (+8 more)

### Community 44 - "complaint-status-badge.tsx"
Cohesion: 0.38
Nodes (5): ComplaintStatusBadge(), STATUS_CHIP, Badge(), badgeVariants, ComplaintStatus

## Knowledge Gaps
- **137 isolated node(s):** `$schema`, `style`, `rsc`, `tsx`, `config` (+132 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 292 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **13 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `cn()` connect `cn` to `complaint-status-badge.tsx`, `admin/page.tsx`, `customer/page.tsx`, `[orderId]/page.tsx`, `waiter/page.tsx`, `button.tsx`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Why does `describeError()` connect `describeError` to `staff-dashboard.tsx`, `admin/page.tsx`, `customer/page.tsx`, `[orderId]/page.tsx`, `waiter/page.tsx`, `api-error.ts`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Why does `useAuth()` connect `customer/page.tsx` to `cn`, `staff-dashboard.tsx`, `admin/page.tsx`, `waiter/page.tsx`, `index.ts`, `button.tsx`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **Are the 22 inferred relationships involving `User` (e.g. with `get_current_user()` and `login()`) actually correct?**
  _`User` has 22 INFERRED edges - model-reasoned connections that need verification._
- **What connects `$schema`, `style`, `rsc` to the rest of the system?**
  _137 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `describeError` be split into smaller, more focused modules?**
  _Cohesion score 0.13071895424836602 - nodes in this community are weakly interconnected._
- **Should `api-client.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.12615384615384614 - nodes in this community are weakly interconnected._