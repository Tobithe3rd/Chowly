/**
 * Single source of truth for "where does a role live in the app?".
 *
 * The home router at `/` and the login page both need this map to
 * decide where to send an authenticated user. Putting it in one
 * place avoids a drift where `/` and `/login` disagree about
 * where a customer should land.
 */

import type { Role } from "@/types"

export const ROLE_HOME: Record<Role, string> = {
  customer: "/customer",
  waiter: "/waiter",
  chef: "/chef",
  bartender: "/bartender",
  admin: "/admin",
}

/** Path a user with the given role should land on after login. */
export function getRoleHome(role: Role): string {
  return ROLE_HOME[role]
}
