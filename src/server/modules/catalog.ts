import type { Permission } from "../authz/permissions";

/**
 * Product modules. `core` modules are always on (every clinic needs patients,
 * appointments, the queue and the medical record). Optional modules are
 * switched per clinic — by the platform (plan) and by the clinic owner
 * (within the plan) — and are ENFORCED: a disabled module removes its
 * permissions from everyone in that clinic (see resolveClinic), so pages,
 * actions and services deny access without module checks of their own.
 * `status` tells the UI and docs honestly whether the module is implemented.
 */
export const MODULES = [
  { key: "core", core: true, status: "available", defaultOn: true },
  { key: "patients", core: true, status: "available", defaultOn: true },
  { key: "appointments", core: true, status: "available", defaultOn: true },
  { key: "queue", core: true, status: "available", defaultOn: true },
  { key: "emr", core: true, status: "available", defaultOn: true },
  { key: "laboratory", core: false, status: "available", defaultOn: true },
  { key: "billing", core: false, status: "available", defaultOn: true },
  { key: "inventory", core: false, status: "available", defaultOn: true },
  { key: "hr", core: false, status: "available", defaultOn: true },
  { key: "patient_portal", core: false, status: "available", defaultOn: true },
  { key: "reports", core: false, status: "available", defaultOn: true },
  /** Specialty module: on only for practices that need it (setup assistant or owner). */
  { key: "dental", core: false, status: "available", defaultOn: false },
  { key: "integrations", core: false, status: "planned", defaultOn: false },
] as const;

export type ModuleKey = (typeof MODULES)[number]["key"];
export const MODULE_KEYS = MODULES.map((m) => m.key) as ModuleKey[];
/** Modules a clinic owner may switch on or off. */
export const OPTIONAL_MODULES = MODULES.filter((m) => !m.core && m.status === "available").map((m) => m.key) as ModuleKey[];

export function isModuleKey(v: string): v is ModuleKey {
  return (MODULE_KEYS as string[]).includes(v);
}

export function isCoreModule(key: string): boolean {
  return MODULES.some((m) => m.key === key && m.core);
}

/** Permissions that only make sense with a module; they are removed while it is off. */
export const MODULE_PERMISSIONS: Partial<Record<ModuleKey, readonly Permission[]>> = {
  laboratory: ["lab.read", "lab.process", "lab.verify", "lab.collect", "lab.manage", "orders.create"],
  billing: ["billing.read", "billing.invoice", "billing.payment", "billing.refund", "cash.shift", "finance.manage"],
  reports: ["finance.reports", "reports.operational"],
  inventory: ["inventory.read", "inventory.manage", "inventory.dispense"],
  hr: ["hr.read", "hr.manage"],
  patient_portal: ["portal.manage"],
};

/** Removes the permissions of disabled modules. */
export function applyModules(permissions: Set<Permission>, enabled: Set<string>): Set<Permission> {
  const out = new Set(permissions);
  for (const [key, perms] of Object.entries(MODULE_PERMISSIONS)) {
    if (!enabled.has(key)) for (const p of perms ?? []) out.delete(p);
  }
  return out;
}
