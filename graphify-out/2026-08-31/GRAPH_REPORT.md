# Graph Report - Chowly-app  (2026-08-31)

## Corpus Check
- Corpus is ~28,984 words - fits in a single context window. You may not need a graph.

## Summary
- 556 nodes · 1188 edges · 23 communities (18 shown, 3 thin omitted)
- Extraction: 92% EXTRACTED · 8% INFERRED · 0% AMBIGUOUS · INFERRED: 93 edges (avg confidence: 0.95)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Backend Auth Utilities
- Waiter Dashboard UI
- Auth Dependencies & Session
- Pydantic Schemas
- Admin/Chef/Bartender Pages
- npm Dependencies
- App Shell & Providers
- TypeScript Config
- package.json Config
- Select Component
- shadcn Component Aliases
- Customer Dashboard
- Cart Sheet UI
- Order Detail Page
- Login Page & Card
- Dialog Component
- Feedback Types & Enums
- Alembic Migration Env
- ESLint Config
- Next.js Config
- PostCSS Config

## God Nodes (most connected - your core abstractions)
1. `cn()` - 53 edges
2. `User` - 28 edges
3. `get_db()` - 23 edges
4. `get_current_user()` - 22 edges
5. `Role` - 20 edges
6. `create_order()` - 19 edges
7. `useAuth()` - 19 edges
8. `seed()` - 17 edges
9. `Restaurant` - 16 edges
10. `list_orders()` - 16 edges

## Surprising Connections (you probably didn't know these)
- `get_current_user()` --uses--> `User`  [INFERRED]
  chowly-backend/app/auth.py → chowly-backend/app/models.py
- `_require_order_owning_customer()` --uses--> `Role`  [INFERRED]
  chowly-backend/app/routers/feedback.py → chowly-backend/app/models.py
- `_require_admin_for_restaurant()` --uses--> `Role`  [INFERRED]
  chowly-backend/app/routers/restaurants.py → chowly-backend/app/models.py
- `RegisterRequest` --uses--> `Role`  [INFERRED]
  chowly-backend/app/schemas.py → chowly-backend/app/models.py
- `UserRead` --uses--> `Role`  [INFERRED]
  chowly-backend/app/schemas.py → chowly-backend/app/models.py

## Import Cycles
- None detected.

## Communities (23 total, 3 thin omitted)

### Community 0 - "Backend Auth Utilities"
Cohesion: 0.05
Nodes (89): alias, Base, create_access_token(), hash_password(), Authentication helpers for the Chowly backend. Password hashing/verification…, Return a bcrypt hash for the given plaintext password., Return True if `plain` matches the stored bcrypt `hashed` value., Issue a signed JWT for the given subject (typically the user id).… (+81 more)

### Community 1 - "Waiter Dashboard UI"
Cohesion: 0.06
Nodes (41): OrderDashboard(), CURRENCY, formatOrderDateTime(), formatPrice(), formatRelative(), isTerminal(), OrderRow(), RTF (+33 more)

### Community 2 - "Auth Dependencies & Session"
Cohesion: 0.07
Nodes (49): decode_access_token(), get_current_user(), Depends, Session, Decode the bearer token from the Authorization header and load the…, Decode and validate a JWT, raising HTTP 401 on any failure., get_db(), FastAPI dependency that yields a SQLAlchemy session and ensures it is closed… (+41 more)

### Community 3 - "Pydantic Schemas"
Cohesion: 0.07
Nodes (43): Any, BaseModel, BartenderRead, ChefRead, ComplaintCreate, ComplaintRead, CustomerRead, LoginRequest (+35 more)

### Community 4 - "Admin/Chef/Bartender Pages"
Cohesion: 0.09
Nodes (26): AppLayout(), ROLE_CHIP, LoginPage(), Home(), CartButton(), buildPayload(), onPlaceOrder(), formatPrice() (+18 more)

### Community 5 - "npm Dependencies"
Cohesion: 0.06
Nodes (31): dependencies, class-variance-authority, clsx, jwt-decode, lucide-react, next, next-themes, radix-ui (+23 more)

### Community 6 - "App Shell & Providers"
Cohesion: 0.09
Nodes (22): geistMono, geistSans, metadata, Toaster(), CartContext, CartContextValue, CartLine, CartProvider() (+14 more)

### Community 7 - "TypeScript Config"
Cohesion: 0.07
Nodes (28): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+20 more)

### Community 8 - "package.json Config"
Cohesion: 0.08
Nodes (25): devDependencies, eslint, eslint-config-next, tailwindcss, @tailwindcss/postcss, @types/node, @types/react, @types/react-dom (+17 more)

### Community 9 - "Select Component"
Cohesion: 0.16
Nodes (18): SelectContent(), SelectGroup(), SelectItem(), SelectLabel(), SelectScrollDownButton(), SelectScrollUpButton(), SelectSeparator(), SelectTrigger() (+10 more)

### Community 10 - "shadcn Component Aliases"
Cohesion: 0.09
Nodes (21): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+13 more)

### Community 11 - "Customer Dashboard"
Cohesion: 0.14
Nodes (12): CartControls(), CURRENCY, CustomerDashboard(), formatPrice(), groupByType(), isAvailable(), ITEM_TYPE_LABEL, ITEM_TYPE_ORDER (+4 more)

### Community 12 - "Cart Sheet UI"
Cohesion: 0.22
Nodes (11): CURRENCY, Button(), buttonVariants, Sheet(), SheetContent(), SheetDescription(), SheetFooter(), SheetHeader() (+3 more)

### Community 13 - "Order Detail Page"
Cohesion: 0.19
Nodes (7): CURRENCY, formatOrderDate(), formatPrice(), OrderLineRow(), OrderView(), STATUS_VERB, Skeleton()

### Community 14 - "Login Page & Card"
Cohesion: 0.24
Nodes (9): Card(), CardAction(), CardContent(), CardDescription(), CardFooter(), CardHeader(), CardTitle(), Input() (+1 more)

### Community 15 - "Dialog Component"
Cohesion: 0.18
Nodes (6): DialogContent(), DialogDescription(), DialogFooter(), DialogHeader(), DialogOverlay(), DialogTitle()

### Community 16 - "Feedback Types & Enums"
Cohesion: 0.25
Nodes (7): ComplaintCreate, ComplaintRead, ComplaintStatus, PaymentRead, PaymentStatus, RatingCreate, RatingRead

### Community 17 - "Alembic Migration Env"
Cohesion: 0.33
Nodes (5): Alembic environment configuration for the Chowly backend. Loads DATABASE_URL…, Run migrations in 'offline' mode. This configures the context with just a URL…, Run migrations in 'online' mode. In this scenario we need to create an Engine…, run_migrations_offline(), run_migrations_online()

## Knowledge Gaps
- **114 isolated node(s):** `$schema`, `style`, `rsc`, `tsx`, `config` (+109 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 236 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `cn()` connect `Select Component` to `Waiter Dashboard UI`, `Cart Sheet UI`, `Order Detail Page`, `Login Page & Card`, `Dialog Component`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **Why does `User` connect `Backend Auth Utilities` to `Auth Dependencies & Session`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Why does `useAuth()` connect `Admin/Chef/Bartender Pages` to `Waiter Dashboard UI`, `Customer Dashboard`, `Cart Sheet UI`, `Login Page & Card`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **Are the 18 inferred relationships involving `User` (e.g. with `get_current_user()` and `login()`) actually correct?**
  _`User` has 18 INFERRED edges - model-reasoned connections that need verification._
- **What connects `$schema`, `style`, `rsc` to the rest of the system?**
  _114 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Backend Auth Utilities` be split into smaller, more focused modules?**
  _Cohesion score 0.054553264604811 - nodes in this community are weakly interconnected._
- **Should `Waiter Dashboard UI` be split into smaller, more focused modules?**
  _Cohesion score 0.06497175141242938 - nodes in this community are weakly interconnected._