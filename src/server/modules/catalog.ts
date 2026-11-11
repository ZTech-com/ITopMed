/**
 * Product modules that can be enabled per clinic (feature flags).
 * `core` modules are always on. `status` tells the UI and docs honestly
 * whether the module is implemented yet.
 */
export const MODULES = [
  { key: "core", core: true, status: "available" },
  { key: "patients", core: false, status: "available" },
  { key: "appointments", core: false, status: "available" },
  { key: "queue", core: false, status: "available" },
  { key: "emr", core: false, status: "available" },
  { key: "laboratory", core: false, status: "available" },
  { key: "billing", core: false, status: "available" },
  { key: "inventory", core: false, status: "available" },
  { key: "hr", core: false, status: "available" },
  { key: "patient_portal", core: false, status: "available" },
  { key: "reports", core: false, status: "available" },
  { key: "integrations", core: false, status: "planned" },
] as const;

export type ModuleKey = (typeof MODULES)[number]["key"];
export const MODULE_KEYS = MODULES.map((m) => m.key) as ModuleKey[];

export function isModuleKey(v: string): v is ModuleKey {
  return (MODULE_KEYS as string[]).includes(v);
}
