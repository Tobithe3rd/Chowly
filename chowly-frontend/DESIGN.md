# Design

<!-- impeccable:design-schema 1 -->

This document captures the visual system for Chowly. It is written at the level of detail needed for the design to stay sticky across future steps: tokens that resolve to Tailwind utilities, components that read from those tokens, and the semantic mappings that must not move.

## Brand voice

Bold and vibrant. Cobalt-blue primary, citrus-yellow accent, a 32px dual-color brand mark, and a display-weight wordmark. The chrome carries the energy; the data on the cards still reads as a restaurant dashboard, not a marketing surface. No aggressive marketing voice; no jokes in error states. The warmth is gone; the new voice earns trust through clarity, not through color softness.

## Palette

### Neutral ground (unchanged from the shadcn `radix-nova` base)

- `--background` / `--foreground` — page ground and ink (light: pure white / near-black, dark: near-black / near-white)
- `--card` / `--card-foreground` — surface ground (sits one step above `--background` in light, one step below in dark)
- `--muted` / `--muted-foreground` — secondary text and soft surfaces
- `--border` / `--input` / `--ring` — hairlines and focus
- `--primary` / `--primary-foreground` — the "ink" tone (high-contrast text/button, NOT the brand). Default-variant buttons that want brand color use `--brand` instead.
- `--destructive` — error and terminal-error states (rose)
- `--accent` (neutral) — for the shadcn `accent` UI slot (hover backgrounds, etc.). Distinct from the brand `--accent` token (citrus yellow) — the shadcn `bg-accent` utility now resolves to the citrus brand color, which is intentional. Pages that want the neutral hover surface can use `bg-muted` instead.

### Brand (new in this pass)

- `--brand` — cobalt blue, the primary brand surface. Light: `oklch(0.55 0.22 262)`. Dark: `oklch(0.62 0.2 262)`. Used as the fill on the brand mark's gradient start, the default primary button, the Place order CTA, and the active/hover state on tab/row interactions.
- `--brand-foreground` — near-white, the readable text on a `--brand` fill.
- `--brand-soft` — the soft surface tint for "in this brand color" but at low saturation. Light: `oklch(0.96 0.04 262)`. Dark: `oklch(0.28 0.08 262)`. Used for the "Claimed by you" pill, the section rules on the customer menu, the table-row hover background.
- `--brand-soft-foreground` — the readable text on a `--brand-soft` fill. Light: cobalt-800. Dark: cobalt-200. Used for the "Claimed by you" pill text, the back-link text on order detail pages, the brand-soft outline button label, the brand-soft ring on the menu's "Add to cart" button.
- `--accent` (brand slot, also called the "citrus" accent) — citrus yellow. Light: `oklch(0.88 0.18 95)`. Dark: `oklch(0.82 0.16 95)`. Used as the gradient end on the brand mark, the section-rule accent on the customer menu, and the high-energy highlight when both brand saturation and a second hue are needed.
- `--accent-foreground` — citrus-900 / dark citrus-200, for text on a `--accent` fill.

### Semantic status palette (LOCKED — does not move with rebrand passes)

| Semantic                | Light                                              | Dark                                                   | Used by                            |
|-------------------------|----------------------------------------------------|--------------------------------------------------------|------------------------------------|
| In-flight (In Prep)     | `bg-sky-200 text-sky-900 ring-sky-300`             | `dark:bg-sky-400/20 dark:text-sky-100 dark:ring-sky-400/40` | `OrderStatusBadge` — "In Preparation" |
| Warning (Delayed / Open complaint) | `bg-amber-200 text-amber-900 ring-amber-300` | `dark:bg-amber-400/20 dark:text-amber-100 dark:ring-amber-400/40` | `OrderStatusBadge` — "Delayed"; `ComplaintStatusBadge` — "Open"; `OrderStepper` delayed accent |
| Done (Served / Resolved / Line Ready) | `bg-emerald-200 text-emerald-900 ring-emerald-300` | `dark:bg-emerald-400/20 dark:text-emerald-100 dark:ring-emerald-400/40` | `OrderStatusBadge` — "Served"; `ComplaintStatusBadge` — "Resolved"; `LineReadyBadge` |
| Terminal-error (Cancelled) | `bg-rose-200 text-rose-900 ring-rose-300`       | `dark:bg-rose-400/20 dark:text-rose-100 dark:ring-rose-400/40` | `OrderStatusBadge` — "Cancelled"; unavailable menu items |
| Rating (stars only)     | `fill-amber-400 text-amber-500`                   | same                                                    | customer order detail — star ratings |

Do not change the hue family on any of these mappings. If a future rebrand shifts the brand color, these stay.

### Role chip palette (per-role identity, preserved with bumped weight)

- customer → amber
- waiter → sky
- chef → rose
- bartender → violet
- admin → emerald

Each chip uses the 300/90 fill + 400 ring with a `ring-2 ring-inset` and `font-bold tracking-tight`. The hue family is the per-role identity signal; the weight is the "vibrant" cascade. Both are locked; if a new role is added, the hue follows the same 200→300/90 + 400 ring pattern from this list.

## Typography

- **Body** — Geist Sans (`--font-sans`, already on the app). Used for paragraphs, table cells, dialog body, button labels, card descriptions.
- **Display** — Space Grotesk (`--font-display`, new in this pass). Used for the wordmark, page H1s, and any chrome text that wants the bolder voice. Wired through `--font-heading` so anything that uses `font-heading` automatically picks it up.
- **Mono** — Geist Mono (`--font-geist-mono`). Unchanged, used for tabular numerals and code.

### Weight scale

- `font-extrabold` — H1s and the wordmark ("Chowly"). H1 scale is `text-3xl sm:text-4xl tracking-[-0.03em]`; wordmark is `text-xl tracking-[-0.04em]`.
- `font-bold` — H2s, role chips, the "Claimed by you" pill, button labels on outline/destructive variants, the wordmark emphasis.
- `font-semibold` — H3s, card titles, table headers, badge text.
- `font-medium` — body text, dialog descriptions, links.
- `font-normal` — secondary copy, captions, muted text.

Card titles (CardTitle component) stay at their current `font-medium` weight — they are body-scale, not display-scale; doubling them down would crowd the card body.

## Component character

### Topbar (`src/app/(app)/layout.tsx`)

- Height: `h-18` (72px) to give the 32px mark and the larger wordmark breathing room.
- Brand mark: `size-8 rounded-full` with `bg-gradient-to-br from-brand to-accent` and a stronger inset shadow (`shadow-[0_2px_8px_rgba(28,73,210,0.35),inset_0_-3px_6px_rgba(0,0,0,0.18)]`). The `ring-2 ring-background/40` lifts the mark off the page.
- Wordmark: `text-xl font-extrabold tracking-[-0.04em] font-heading` — the display face + heavier weight + tighter tracking is the single largest visual change in the topbar.
- Right-hand cluster: email, divider, role chip, "My orders" link (customer only), cart (customer only), logout. Same vertical rhythm as before (h-7 across the cluster).
- Role chips: `h-7 rounded-full px-2.5 text-xs font-bold tracking-tight ring-2 ring-inset` with the role-hue 300/90 fill + 400 ring. Locked per-role hue list above.

### Button (`src/components/ui/button.tsx`)

- **default** variant: `bg-brand text-brand-foreground hover:bg-brand/90 shadow-sm` — the primary CTA fill cascades to every page that uses the default variant (Place order, Claim order, Mark served confirm, Mark delayed confirm). One-step elevation; the shadow disappears on `active:translate-y-px`.
- **outline** variant: unchanged. Used for Claim, Mark served, Mark delayed, Resolve complaint, Cancel in dialogs.
- **secondary** / **ghost** / **destructive** / **link**: unchanged. They keep their shadcn neutral character so the brand only shouts on the default variant.

### Card (`src/components/ui/card.tsx`)

- Default size: `rounded-xl bg-card ring-1 ring-foreground/15 shadow-sm` — one step of elevation + a slightly stronger hairline so the card sits clearly off the page ground.
- `size="sm"`: same ring contrast, no shadow (smaller cards shouldn't carry the same elevation; the ring is enough).
- CardHeader / CardTitle / CardDescription / CardContent / CardFooter: unchanged. CardTitle stays at `font-medium` to keep the body-scale hierarchy.

### Badge (`src/components/ui/badge.tsx`)

- Unchanged. The semantic status badges (OrderStatusBadge, LineReadyBadge, ComplaintStatusBadge) compose Badge and override the chip with their own className; the base Badge is the neutral carrier.

## Tokens (Tailwind utility → CSS variable)

The new brand tokens resolve through `@theme inline` in `src/app/globals.css` so they work as standard Tailwind utilities:

- `bg-brand` / `text-brand` → `var(--brand)`
- `bg-brand-foreground` / `text-brand-foreground` → `var(--brand-foreground)`
- `bg-brand-soft` / `text-brand-soft` → `var(--brand-soft)`
- `bg-brand-soft-foreground` / `text-brand-soft-foreground` → `var(--brand-soft-foreground)`
- `bg-accent` / `text-accent` → `var(--accent)` (citrus, in the brand slot)
- `bg-accent-foreground` / `text-accent-foreground` → `var(--accent-foreground)` (citrus-900)
- `font-heading` → `var(--font-display)` (Space Grotesk)
- `font-sans` → `var(--font-geist-sans)` (Geist Sans)
- `font-mono` → `var(--font-geist-mono)` (Geist Mono)

## Locked semantics (do not change)

- The semantic status palette (sky/amber/emerald/rose) — see the table above. These carry meaning consistently across all 5 role views.
- The role chip hues (per-role identity).
- The star rating amber on the customer order page (a rating semantic, not a brand surface).
- The cart count chip on the customer cart trigger — a "your attention" notification, amber is correct there.
- The delayed stepper accent (`text-amber-700` in `OrderStepper`) — coupled to the Delayed status badge; stays amber.

## What this doc does not cover

- Per-page layouts. Page H1s, page-level content, and the customer menu's section rules inherit from the foundation above; they aren't repeated here.
- Image / asset direction. The new direction is a foundation, not a visual identity at the image level — the brand mark is a CSS gradient circle, not a logo asset. If a logo asset is later introduced, it inherits the cobalt→citrus gradient.
- Motion and interaction grammar. Out of scope for this pass; the existing shadcn transitions (active translate, hover background) are unchanged.
