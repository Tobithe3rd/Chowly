"use client"

/**
 * Chef view — food lines only, claimable by the signed-in chef.
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

export default function ChefPage() {
  return (
    <RouteGuard allowedRoles={["chef"]}>
      <StaffDashboard
        role="chef"
        relevantItemType="Food"
        claimField="chef_id"
      />
    </RouteGuard>
  )
}
