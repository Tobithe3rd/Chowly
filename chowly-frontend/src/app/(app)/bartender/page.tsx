"use client"

/**
 * Bartender view — drink lines only, claimable by the signed-in
 * bartender.
 *
 * Thin wrapper around the shared StaffDashboard: the dashboard
 * owns the table, the polling, the per-line claim dialog, the
 * skeleton, and the error state. This page only declares which
 * role, which item_type, and which claim-id field apply. The
 * shared component lives at
 * src/app/(app)/_components/staff-dashboard.tsx.
 */

import { StaffDashboard } from "@/app/(app)/_components/staff-dashboard"
import { RouteGuard } from "@/components/shared/route-guard"

export default function BartenderPage() {
  return (
    <RouteGuard allowedRoles={["bartender"]}>
      <StaffDashboard
        role="bartender"
        relevantItemType="Drink"
        claimField="bartender_id"
      />
    </RouteGuard>
  )
}
