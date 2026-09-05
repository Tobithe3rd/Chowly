/**
 * Restaurant / menu types — mirror chowly-backend/app/schemas.py
 * restaurant + menu sections.
 *
 * Enum values come from app/models.py ItemType enum:
 *   FOOD = "Food", DRINK = "Drink"
 */

/** Mirrors backend `ItemType` enum. */
export type ItemType = "Food" | "Drink"

/**
 * Mirrors backend `RestaurantRead`. NOTE: not currently returned by
 * any route (the public list uses `RestaurantPublic` and the detail
 * uses `RestaurantDetail`). Mirrored anyway in case a future admin
 * route returns it.
 */
export interface RestaurantRead {
  id: number
  name: string
  address: string
  phone: string
  email: string
}

/**
 * Mirrors backend `RestaurantPublic` — minimal shape returned by
 * GET /restaurants for unauthenticated callers (registration flow's
 * restaurant picker). Deliberately omits phone/email.
 */
export interface RestaurantPublic {
  id: number
  name: string
  address: string
}

/**
 * Mirrors backend `MenuItemRead` — read shape for a menu item.
 *
 * `price` is a string on the wire: Pydantic v2's Decimal serializer
 * emits the value as a JSON string (e.g. "12.50") to preserve
 * precision, not as a number. Render code calls `Number(price)`
 * before formatting; do not assume `price` is a `number`.
 */
export interface MenuItemRead {
  id: number
  name: string
  description: string | null
  item_type: ItemType
  price: string
  availability_status: string
  menu_id: number
}

/**
 * Mirrors backend `MenuItemCreate` — input for
 * POST /restaurants/{restaurant_id}/menu-items.
 *
 * `description` and `availability_status` have defaults and are
 * optional. `availability_status` defaults to "available" server-side.
 */
export interface MenuItemCreate {
  name: string
  description?: string | null
  item_type: ItemType
  price: string
  availability_status?: string
}

/**
 * Mirrors backend `MenuItemUpdate` — input for
 * PATCH /restaurants/{restaurant_id}/menu-items/{item_id}.
 * Every field optional; absent fields are left untouched.
 */
export interface MenuItemUpdate {
  name?: string
  description?: string | null
  item_type?: ItemType
  price?: string
  availability_status?: string
}

/**
 * Mirrors backend `MenuRead` — a menu with its items.
 */
export interface MenuRead {
  id: number
  name: string
  description: string | null
  status: string
  restaurant_id: number
  items: MenuItemRead[]
}

/**
 * Mirrors backend `RestaurantDetail` — public detail view returned
 * by GET /restaurants/{id}. Only menus with status='active' are
 * included. Phone and email are hidden for the same reason as
 * RestaurantPublic.
 */
export interface RestaurantDetail {
  id: number
  name: string
  address: string
  menus: MenuRead[]
}

/* ---------- Profile read shapes (mirrors CustomerRead etc.) ---------- */
/* These aren't returned by any current route either, but the
 * schemas are defined; mirror them so the types are complete. */

export interface CustomerRead {
  id: number
  name: string
  phone: string
  email: string
  restaurant_id: number
  user_id: number | null
}

export interface WaiterRead {
  id: number
  name: string
  phone: string
  restaurant_id: number
  user_id: number | null
}

export interface ChefRead {
  id: number
  name: string
  phone: string
  restaurant_id: number
  user_id: number | null
}

export interface BartenderRead {
  id: number
  name: string
  phone: string
  restaurant_id: number
  user_id: number | null
}
