/**
 * Clinic permission catalog and default role templates.
 *
 * Permissions are coarse capabilities checked server-side (RBAC). Contextual
 * rules (ABAC) — e.g. "a doctor may read the record of a patient with whom
 * they have a care relationship", or branch scoping — are applied on top in
 * the domain services. Deny by default: anything not listed is not allowed.
 */
export const PERMISSIONS = [
  // Clinic administration
  "clinic.settings.read",
  "clinic.settings.manage",
  "clinic.branches.manage",
  "clinic.subscription.read",
  "staff.read",
  "staff.manage",
  "roles.manage",
  "audit.read",
  "support_access.decide",
  // Patients & scheduling
  "patients.read",
  "patients.create",
  "patients.update",
  "patients.merge",
  "appointments.read",
  "appointments.manage",
  "queue.manage",
  // Clinical (EMR)
  "emr.read",
  "emr.read_all",
  "emr.write",
  "emr.sign",
  "emr.amend",
  "vitals.write",
  "nursing.write",
  "orders.create",
  "lab.read",
  "lab.process",
  "lab.verify",
  "documents.read",
  "documents.upload",
  "prescriptions.write",
  // Finance
  "billing.read",
  "billing.invoice",
  "billing.payment",
  "billing.refund",
  "cash.shift",
  "finance.reports",
  "finance.manage",
  // Operations
  "inventory.read",
  "inventory.manage",
  "inventory.dispense",
  "hr.read",
  "hr.manage",
  "reports.operational",
  "services.read",
  "services.manage",
  "schedules.read",
  "schedules.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const SYSTEM_ROLE_KEYS = [
  "clinic_owner",
  "clinic_admin",
  "branch_manager",
  "receptionist",
  "doctor",
  "head_doctor",
  "nurse",
  "lab_staff",
  "cashier",
  "accountant",
  "pharmacist",
  "hr_manager",
] as const;

export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

const ADMIN_BASE: Permission[] = [
  "clinic.settings.read",
  "staff.read",
  "patients.read",
  "appointments.read",
  "reports.operational",
];

/**
 * Templates copied into every new clinic. Clinics may adjust their copies.
 * NOTE: clinic_owner and clinic_admin deliberately do NOT get `emr.read`.
 * Administrative authority does not imply access to medical content; an owner
 * who is also a practising doctor receives the `doctor` role in addition.
 */
export const ROLE_TEMPLATES: Record<SystemRoleKey, Permission[]> = {
  clinic_owner: [
    ...ADMIN_BASE,
    "clinic.settings.manage",
    "clinic.branches.manage",
    "clinic.subscription.read",
    "staff.manage",
    "roles.manage",
    "audit.read",
    "support_access.decide",
    "services.read",
    "services.manage",
    "schedules.read",
    "schedules.manage",
    "billing.read",
    "finance.reports",
    "inventory.read",
    "hr.read",
  ],
  clinic_admin: [
    ...ADMIN_BASE,
    "clinic.settings.manage",
    "clinic.branches.manage",
    "staff.manage",
    "services.read",
    "services.manage",
    "schedules.read",
    "schedules.manage",
    "patients.create",
    "patients.update",
    "patients.merge",
    "appointments.manage",
    "queue.manage",
    "billing.read",
  ],
  branch_manager: [...ADMIN_BASE, "appointments.manage", "queue.manage", "billing.read", "services.read", "schedules.read", "schedules.manage"],
  receptionist: ["patients.read", "patients.create", "patients.update", "appointments.read", "appointments.manage", "queue.manage", "services.read", "schedules.read"],
  doctor: [
    "patients.read",
    "appointments.read",
    "emr.read",
    "emr.write",
    "emr.sign",
    "emr.amend",
    "vitals.write",
    "orders.create",
    "lab.read",
    "documents.read",
    "documents.upload",
    "prescriptions.write",
    "services.read",
  ],
  head_doctor: [
    "patients.read",
    "appointments.read",
    "emr.read",
    "emr.read_all",
    "emr.write",
    "emr.sign",
    "emr.amend",
    "orders.create",
    "lab.read",
    "documents.read",
    "reports.operational",
    "staff.read",
    "services.read",
    "schedules.read",
  ],
  nurse: ["patients.read", "appointments.read", "emr.read", "vitals.write", "nursing.write", "documents.read", "queue.manage", "schedules.read"],
  lab_staff: ["patients.read", "lab.read", "lab.process", "lab.verify"],
  cashier: ["patients.read", "billing.read", "billing.invoice", "billing.payment", "billing.refund", "cash.shift", "services.read"],
  accountant: ["billing.read", "finance.reports", "finance.manage", "reports.operational", "services.read"],
  pharmacist: ["inventory.read", "inventory.manage", "inventory.dispense"],
  hr_manager: ["staff.read", "hr.read", "hr.manage", "schedules.read", "schedules.manage"],
};

export function isPermission(v: string): v is Permission {
  return (PERMISSIONS as readonly string[]).includes(v);
}

export function isSystemRoleKey(v: string): v is SystemRoleKey {
  return (SYSTEM_ROLE_KEYS as readonly string[]).includes(v);
}
