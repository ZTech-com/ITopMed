import "server-only";
import { createTranslator } from "use-intl/core";
import { z } from "zod";
import type { PracticeType, ServiceKind } from "@/generated/prisma/client";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";
import type { ClinicContext } from "../auth/clinic-auth";
import type { RequestMeta } from "../auth/platform-auth";
import type { Tx } from "../db";
import { OPTIONAL_MODULES, type ModuleKey } from "../modules/catalog";
import { SPECIALTIES } from "../scheduling/specialties";
import { uuidv7 } from "../security/crypto";
import { DomainError } from "../tenancy/provisioning";
import { auditClinic, inClinic, requirePermission } from "./context";

/**
 * One product for every kind of practice: a 1-doctor office, a dental clinic,
 * a diagnostic centre or a multi-branch hospital. The practice type drives a
 * preset — which optional modules are on and a starter service list — that
 * the owner can change afterwards. Presets never exceed the clinic's plan.
 */
export const PRACTICE_TYPES = ["MULTI_SPECIALTY", "SOLO_PRACTICE", "DENTAL", "DIAGNOSTIC", "OTHER"] as const satisfies readonly PracticeType[];

const ALL_OPTIONAL = OPTIONAL_MODULES;
export const PRESET_MODULES: Record<PracticeType, readonly ModuleKey[]> = {
  MULTI_SPECIALTY: ALL_OPTIONAL.filter((m) => m !== "dental"),
  SOLO_PRACTICE: ["billing", "reports", "patient_portal"],
  DENTAL: ["dental", "billing", "inventory", "reports", "patient_portal"],
  DIAGNOSTIC: ["laboratory", "billing", "inventory", "reports", "patient_portal"],
  OTHER: ALL_OPTIONAL.filter((m) => m !== "dental"),
};

/** Starter services (names translated into the clinic language; prices are left for the clinic to set). */
const STARTER_SERVICES: Record<PracticeType, { code: string; key: string; kind: ServiceKind; minutes: number }[]> = {
  MULTI_SPECIALTY: [
    { code: "CONSULT", key: "consultation", kind: "CONSULTATION", minutes: 20 },
    { code: "CONSULT-R", key: "repeatConsultation", kind: "CONSULTATION", minutes: 15 },
  ],
  SOLO_PRACTICE: [
    { code: "CONSULT", key: "consultation", kind: "CONSULTATION", minutes: 20 },
    { code: "CONSULT-R", key: "repeatConsultation", kind: "CONSULTATION", minutes: 15 },
  ],
  DENTAL: [
    { code: "DENT-EXAM", key: "dentalExam", kind: "CONSULTATION", minutes: 20 },
    { code: "DENT-CLEAN", key: "dentalCleaning", kind: "PROCEDURE", minutes: 45 },
    { code: "DENT-FILL", key: "filling", kind: "PROCEDURE", minutes: 45 },
    { code: "DENT-RCT", key: "rootCanal", kind: "PROCEDURE", minutes: 60 },
    { code: "DENT-EXT", key: "extraction", kind: "PROCEDURE", minutes: 30 },
    { code: "DENT-XRAY", key: "dentalXray", kind: "IMAGING", minutes: 10 },
  ],
  DIAGNOSTIC: [
    { code: "LAB-CBC", key: "bloodCount", kind: "LAB_TEST", minutes: 10 },
    { code: "LAB-GLU", key: "bloodGlucose", kind: "LAB_TEST", minutes: 10 },
    { code: "LAB-URINE", key: "urinalysis", kind: "LAB_TEST", minutes: 10 },
    { code: "US-ABD", key: "ultrasound", kind: "IMAGING", minutes: 20 },
    { code: "ECG", key: "ecg", kind: "PROCEDURE", minutes: 15 },
  ],
  OTHER: [{ code: "CONSULT", key: "consultation", kind: "CONSULTATION", minutes: 20 }],
};

async function planModules(tx: Tx, tenantId: string): Promise<Set<string>> {
  const sub = await tx.subscription.findUnique({ where: { tenantId }, select: { planId: true } });
  const plan = sub ? await tx.plan.findUnique({ where: { id: sub.planId }, select: { modules: true } }) : null;
  return new Set(plan?.modules ?? []);
}

/** Optional modules with their state for the owner's settings screen. */
export async function listClinicModules(ctx: ClinicContext) {
  requirePermission(ctx, "clinic.settings.read");
  return inClinic(ctx, async (tx) => {
    const inPlan = await planModules(tx, ctx.tenant.id);
    const rows = await tx.tenantModule.findMany({ where: { tenantId: ctx.tenant.id }, select: { moduleKey: true, enabled: true } });
    const on = new Map(rows.map((r) => [r.moduleKey, r.enabled]));
    return ALL_OPTIONAL.map((key) => ({ key, enabled: on.get(key) ?? false, inPlan: inPlan.has(key) }));
  });
}

async function writeModule(tx: Tx, ctx: ClinicContext, key: ModuleKey, enabled: boolean) {
  await tx.tenantModule.upsert({
    where: { tenantId_moduleKey: { tenantId: ctx.tenant.id, moduleKey: key } },
    create: { tenantId: ctx.tenant.id, moduleKey: key, enabled, updatedById: ctx.principal.user.id },
    update: { enabled, updatedById: ctx.principal.user.id },
  });
}

/** The owner turns optional modules on (within the plan) or off. Turning off hides the module for everyone at once. */
export async function setClinicModule(ctx: ClinicContext, keyRaw: string, enabled: boolean, meta: RequestMeta) {
  requirePermission(ctx, "clinic.settings.manage");
  const key = z.enum(ALL_OPTIONAL as [ModuleKey, ...ModuleKey[]]).safeParse(keyRaw);
  if (!key.success) throw new DomainError("errors.invalidInput");
  await inClinic(ctx, async (tx) => {
    if (enabled && !(await planModules(tx, ctx.tenant.id)).has(key.data)) throw new DomainError("errors.moduleNotInPlan");
    await writeModule(tx, ctx, key.data, enabled);
    await auditClinic(tx, ctx, meta, { action: enabled ? "clinic.module_enabled" : "clinic.module_disabled", entityType: "TenantModule", entityId: key.data });
  });
}

export const setupSchema = z
  .object({
    practiceType: z.enum(PRACTICE_TYPES),
    applyModules: z.boolean(),
    addStarterServices: z.boolean(),
    ownerIsDoctor: z.boolean(),
    /** Small practices without a receptionist: the owner also registers, books and takes payments. */
    ownerFrontDesk: z.boolean().default(false),
    specialty: z.union([z.literal("").transform(() => undefined), z.enum(SPECIALTIES)]).optional(),
    weekdaySchedule: z.boolean(),
  })
  .refine((v) => !v.ownerIsDoctor || Boolean(v.specialty), { message: "validation.required", path: ["specialty"] });

async function serviceNames(locale: string) {
  const l: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const messages = (await import(`../../../messages/${l}.json`)).default;
  return createTranslator({ locale: l, messages, namespace: "practice.services" });
}

export interface SetupResult {
  modulesOn: string[];
  servicesAdded: number;
  ownerDoctorProfileId: string | null;
}

/**
 * Setup assistant (clinic owner). Applies the practice preset in one
 * transaction. A solo owner who also treats patients receives the doctor role
 * here — the only place where someone changes their own roles, restricted to
 * the owner, explicit and audited. Clinical access then still follows the
 * care-relationship rules like for any doctor.
 */
export async function completeSetup(ctx: ClinicContext, raw: unknown, meta: RequestMeta): Promise<SetupResult> {
  requirePermission(ctx, "clinic.settings.manage");
  if (!ctx.roleKeys.includes("clinic_owner")) throw new DomainError("errors.forbidden");
  const input = setupSchema.parse(raw);
  const t = input.addStarterServices ? await serviceNames(ctx.tenant.defaultLocale) : null;

  return inClinic(ctx, async (tx) => {
    await tx.tenant.update({ where: { id: ctx.tenant.id }, data: { practiceType: input.practiceType, setupCompletedAt: new Date() } });
    const result: SetupResult = { modulesOn: [], servicesAdded: 0, ownerDoctorProfileId: null };

    if (input.applyModules) {
      const inPlan = await planModules(tx, ctx.tenant.id);
      const want = new Set<string>(PRESET_MODULES[input.practiceType]);
      for (const key of ALL_OPTIONAL) {
        const on = want.has(key) && inPlan.has(key);
        await writeModule(tx, ctx, key, on);
        if (on) result.modulesOn.push(key);
      }
    }

    if (t) {
      const existing = new Set((await tx.service.findMany({ select: { code: true } })).map((s) => s.code));
      const fresh = STARTER_SERVICES[input.practiceType].filter((s) => !existing.has(s.code));
      if (fresh.length > 0) {
        // Price 0 = "not set yet": invoicing refuses such services until the clinic sets a price.
        await tx.service.createMany({
          data: fresh.map((s) => ({ id: uuidv7(), tenantId: ctx.tenant.id, code: s.code, name: t(s.key as never), kind: s.kind, durationMinutes: s.minutes, priceMinor: 0n, currency: ctx.tenant.currency })),
        });
      }
      result.servicesAdded = fresh.length;
    }

    if (input.ownerFrontDesk) {
      const roles = await tx.role.findMany({ where: { tenantId: ctx.tenant.id, key: { in: ["receptionist", "cashier"] } }, select: { id: true } });
      await tx.membershipRole.createMany({ data: roles.map((r) => ({ tenantId: ctx.tenant.id, membershipId: ctx.membershipId, roleId: r.id })), skipDuplicates: true });
      await auditClinic(tx, ctx, meta, { action: "clinic.owner_front_desk_role", entityType: "Membership", entityId: ctx.membershipId, metadata: { roles: ["receptionist", "cashier"] } });
    }

    if (input.ownerIsDoctor && input.specialty) {
      const doctorRole = await tx.role.findFirst({ where: { tenantId: ctx.tenant.id, key: "doctor" }, select: { id: true } });
      if (!doctorRole) throw new DomainError("errors.notFound");
      await tx.membershipRole.createMany({ data: [{ tenantId: ctx.tenant.id, membershipId: ctx.membershipId, roleId: doctorRole.id }], skipDuplicates: true });
      const existing = await tx.doctorProfile.findUnique({ where: { membershipId: ctx.membershipId }, select: { id: true } });
      const profileId = existing?.id ?? uuidv7();
      if (!existing) await tx.doctorProfile.create({ data: { id: profileId, tenantId: ctx.tenant.id, membershipId: ctx.membershipId, specialty: input.specialty } });
      result.ownerDoctorProfileId = profileId;
      await auditClinic(tx, ctx, meta, { action: "clinic.owner_clinical_role", entityType: "Membership", entityId: ctx.membershipId, metadata: { role: "doctor", clinical: true } });

      if (input.weekdaySchedule && (await tx.workSchedule.count({ where: { doctorProfileId: profileId } })) === 0) {
        const branch = await tx.branch.findFirst({ where: { archivedAt: null }, orderBy: [{ isMain: "desc" }, { createdAt: "asc" }], select: { id: true } });
        if (branch) {
          await tx.workSchedule.createMany({
            data: [1, 2, 3, 4, 5].map((weekday) => ({ id: uuidv7(), tenantId: ctx.tenant.id, doctorProfileId: profileId, branchId: branch.id, weekday, startMinute: 9 * 60, endMinute: 18 * 60 })),
          });
        }
      }
    }

    await auditClinic(tx, ctx, meta, {
      action: "clinic.setup_completed",
      entityType: "Tenant",
      entityId: ctx.tenant.id,
      metadata: { practiceType: input.practiceType, modules: result.modulesOn, servicesAdded: result.servicesAdded },
    });
    return result;
  });
}

/** For the dashboard: has the owner been through the assistant yet? */
export async function practiceProfile(ctx: ClinicContext) {
  return inClinic(ctx, (tx) => tx.tenant.findUnique({ where: { id: ctx.tenant.id }, select: { practiceType: true, setupCompletedAt: true } }));
}
