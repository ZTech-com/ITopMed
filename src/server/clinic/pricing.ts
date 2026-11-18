import "server-only";
import { z } from "zod";
import type { ClinicContext } from "../auth/clinic-auth";
import type { RequestMeta } from "../auth/platform-auth";
import { uuidv7 } from "../security/crypto";
import { DomainError } from "../errors";
import { auditClinic, inClinic, requirePermission } from "./context";

/**
 * Clinic pricing setup (Services → Discounts): privileged patient categories,
 * service packages and the free follow-up period. Managed by whoever manages
 * services (owner / administrator); read by the desk.
 */

const uuid = z.uuid();
const name = z.string().trim().min(1, "validation.required").max(80, "validation.tooLong");

export async function listBenefitCategories(ctx: ClinicContext) {
  requirePermission(ctx, "services.read", "services.manage", "patients.read");
  return inClinic(ctx, (tx) => tx.benefitCategory.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, discountPercent: true } }));
}

export const benefitSchema = z.object({ name, discountPercent: z.coerce.number().int("validation.invalid").min(1, "validation.percent").max(100, "validation.percent") });

export async function saveBenefitCategory(ctx: ClinicContext, raw: unknown, meta: RequestMeta) {
  requirePermission(ctx, "services.manage");
  const input = benefitSchema.parse(raw);
  await inClinic(ctx, async (tx) => {
    const existing = await tx.benefitCategory.findFirst({ where: { name: input.name }, select: { id: true } });
    const id = existing?.id ?? uuidv7();
    if (existing) await tx.benefitCategory.update({ where: { id }, data: { discountPercent: input.discountPercent, archivedAt: null } });
    else await tx.benefitCategory.create({ data: { id, tenantId: ctx.tenant.id, ...input } });
    await auditClinic(tx, ctx, meta, { action: "pricing.benefit_saved", entityType: "BenefitCategory", entityId: id, metadata: { discountPercent: input.discountPercent } });
  });
}

export async function archiveBenefitCategory(ctx: ClinicContext, id: string, meta: RequestMeta) {
  requirePermission(ctx, "services.manage");
  await inClinic(ctx, async (tx) => {
    const r = await tx.benefitCategory.updateMany({ where: { id: uuid.parse(id), archivedAt: null }, data: { archivedAt: new Date() } });
    if (!r.count) throw new DomainError("errors.notFound");
    await auditClinic(tx, ctx, meta, { action: "pricing.benefit_archived", entityType: "BenefitCategory", entityId: id });
  });
}

export async function listPackages(ctx: ClinicContext) {
  requirePermission(ctx, "services.read", "services.manage", "billing.invoice");
  return inClinic(ctx, (tx) =>
    tx.servicePackage.findMany({
      where: { archivedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, discountPercent: true, items: { select: { serviceId: true, service: { select: { name: true, priceMinor: true, currency: true } } } } },
    }),
  );
}

export const packageSchema = z.object({
  name,
  discountPercent: z.coerce.number().int("validation.invalid").min(0, "validation.percent").max(100, "validation.percent"),
  serviceIds: z.array(uuid).min(2, "validation.packageTwoServices").max(30),
});

export async function savePackage(ctx: ClinicContext, raw: unknown, meta: RequestMeta) {
  requirePermission(ctx, "services.manage");
  const input = packageSchema.parse(raw);
  await inClinic(ctx, async (tx) => {
    const services = await tx.service.count({ where: { id: { in: input.serviceIds }, archivedAt: null } });
    if (services !== new Set(input.serviceIds).size) throw new DomainError("errors.notFound");
    const existing = await tx.servicePackage.findFirst({ where: { name: input.name }, select: { id: true } });
    const id = existing?.id ?? uuidv7();
    if (existing) {
      await tx.servicePackage.update({ where: { id }, data: { discountPercent: input.discountPercent, archivedAt: null } });
      await tx.servicePackageItem.deleteMany({ where: { packageId: id } });
    } else {
      await tx.servicePackage.create({ data: { id, tenantId: ctx.tenant.id, name: input.name, discountPercent: input.discountPercent } });
    }
    await tx.servicePackageItem.createMany({ data: [...new Set(input.serviceIds)].map((serviceId) => ({ id: uuidv7(), tenantId: ctx.tenant.id, packageId: id, serviceId })) });
    await auditClinic(tx, ctx, meta, { action: "pricing.package_saved", entityType: "ServicePackage", entityId: id, metadata: { discountPercent: input.discountPercent, services: input.serviceIds.length } });
  });
}

export async function archivePackage(ctx: ClinicContext, id: string, meta: RequestMeta) {
  requirePermission(ctx, "services.manage");
  await inClinic(ctx, async (tx) => {
    const r = await tx.servicePackage.updateMany({ where: { id: uuid.parse(id), archivedAt: null }, data: { archivedAt: new Date() } });
    if (!r.count) throw new DomainError("errors.notFound");
    await auditClinic(tx, ctx, meta, { action: "pricing.package_archived", entityType: "ServicePackage", entityId: id });
  });
}

export const followUpSchema = z.object({ freeFollowUpDays: z.coerce.number().int("validation.invalid").min(0, "validation.range").max(90, "validation.range") });

export async function getFreeFollowUpDays(ctx: ClinicContext): Promise<number> {
  requirePermission(ctx, "services.read", "services.manage", "billing.invoice");
  return inClinic(ctx, async (tx) => (await tx.clinicPolicy.findUnique({ where: { tenantId: ctx.tenant.id }, select: { freeFollowUpDays: true } }))?.freeFollowUpDays ?? 10);
}

/** Free follow-up period: the owner only (it is money). */
export async function saveFreeFollowUpDays(ctx: ClinicContext, raw: unknown, meta: RequestMeta) {
  requirePermission(ctx, "clinic.settings.manage");
  if (!ctx.roleKeys.includes("clinic_owner")) throw new DomainError("errors.ownerOnly");
  const { freeFollowUpDays } = followUpSchema.parse(raw);
  await inClinic(ctx, async (tx) => {
    await tx.clinicPolicy.upsert({ where: { tenantId: ctx.tenant.id }, create: { tenantId: ctx.tenant.id, freeFollowUpDays, updatedById: ctx.principal.user.id }, update: { freeFollowUpDays, updatedById: ctx.principal.user.id } });
    await auditClinic(tx, ctx, meta, { action: "pricing.follow_up_days", entityType: "Tenant", entityId: ctx.tenant.id, metadata: { freeFollowUpDays } });
  });
}
