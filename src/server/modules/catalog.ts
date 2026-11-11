/**
 * Product modules that can be enabled per clinic (feature flags).
 * `core` modules are always on. `status` tells the UI and docs honestly
 * whether the module is implemented yet.
 */
export const MODULES = [
  { key: "core", core: true, status: "available" },
  { key: "patients", core: false, status: "planned" },
  { key: "appointments", core: false, status: "planned" },
  { key: "queue", core: false, status: "planned" },
  { key: "emr", core: false, status: "planned" },
  { key: "laboratory", core: false, status: "planned" },
  { key: "billing", core: false, status: "planned" },
  { key: "inventory", core: false, status: "planned" },
  { key: "hr", core: false, status: "planned" },
  { key: "patient_portal", core: false, status: "planned" },
  { key: "reports", core: false, status: "planned" },
  { key: "integrations", core: false, status: "planned" },
] as const;

export type ModuleKey = (typeof MODULES)[number]["key"];
export const MODULE_KEYS = MODULES.map((m) => m.key) as ModuleKey[];

export function isModuleKey(v: string): v is ModuleKey {
  return (MODULE_KEYS as string[]).includes(v);
}
