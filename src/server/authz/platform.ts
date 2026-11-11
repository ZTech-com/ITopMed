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
  ],
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
