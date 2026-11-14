import type { PlatformRole } from "@/generated/prisma/client";

/** Platform (ITop Med staff) permissions. None of them grants clinical data access. */
export const PLATFORM_PERMISSIONS = [
  "tenants.read",
  "tenants.create",
  "tenants.manage",
  "tenants.lifecycle",
  "subscriptions.manage",
  "modules.manage",
  "staff.read",
  "staff.manage",
  "audit.read",
  "support.request_access",
  "settings.manage",
  /** Create networks (franchises / groups) and appoint their admins. */
  "networks.manage",
] as const;

export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

const MATRIX: Record<PlatformRole, readonly PlatformPermission[]> = {
  SUPER_ADMIN: PLATFORM_PERMISSIONS,
  PLATFORM_ADMIN: [
    "tenants.read",
    "tenants.create",
    "tenants.manage",
    "tenants.lifecycle",
    "subscriptions.manage",
    "modules.manage",
    "staff.read",
    "audit.read",
    "support.request_access",
    "networks.manage",
  ],
  /**
   * Franchise / group owner: creates and runs the clinics of ONE network
   * (scoped in every service by networkId). No plans, staff, platform audit or
   * support access, and - like every platform role - no clinical data.
   */
  NETWORK_ADMIN: ["tenants.read", "tenants.create", "tenants.manage", "tenants.lifecycle", "modules.manage"],
  SUPPORT: ["tenants.read", "support.request_access", "audit.read"],
  BILLING: ["tenants.read", "subscriptions.manage"],
  READ_ONLY: ["tenants.read", "staff.read"],
};

export function platformCan(role: PlatformRole, permission: PlatformPermission): boolean {
  return MATRIX[role].includes(permission);
}

export function platformPermissions(role: PlatformRole): readonly PlatformPermission[] {
  return MATRIX[role];
}
