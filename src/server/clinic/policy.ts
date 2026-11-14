import "server-only";
import { z } from "zod";
import type { ClinicContext } from "../auth/clinic-auth";
import type { RequestMeta } from "../auth/platform-auth";
import type { Tx } from "../db";
import { DomainError } from "../errors";
import { auditClinic, inClinic, requirePermission } from "./context";

/** Defaults when the owner has not saved a policy yet (no extra restriction). */
export const DEFAULT_POLICY = { maxDiscountPercent: 100, discountReasonRequired: false } as const;
export type ClinicPolicyValues = { maxDiscountPercent: number; discountReasonRequired: boolean };

export async function policyIn(tx: Tx, tenantId: string): Promise<ClinicPolicyValues> {
  const p = await tx.clinicPolicy.findUnique({ where: { tenantId }, select: { maxDiscountPercent: true, discountReasonRequired: true } });
  return p ?? { ...DEFAULT_POLICY };
}

export async function getClinicPolicy(ctx: ClinicContext): Promise<ClinicPolicyValues> {
  requirePermission(ctx, "clinic.settings.read", "billing.invoice");
  return inClinic(ctx, (tx) => policyIn(tx, ctx.tenant.id));
}

export const policySchema = z.object({
  maxDiscountPercent: z.coerce.number().int("validation.invalid").min(0, "validation.percent").max(100, "validation.percent"),
  discountReasonRequired: z.boolean(),
});

/**
 * Control rules for the staff. Only the clinic OWNER may change them — an
 * administrator must not be able to relax the limits that apply to themself.
 */
export async function updateClinicPolicy(ctx: ClinicContext, raw: unknown, meta: RequestMeta) {
  requirePermission(ctx, "clinic.settings.manage");
  if (!ctx.roleKeys.includes("clinic_owner")) throw new DomainError("errors.ownerOnly");
  const input = policySchema.parse(raw);
  await inClinic(ctx, async (tx) => {
    const before = await policyIn(tx, ctx.tenant.id);
    await tx.clinicPolicy.upsert({
      where: { tenantId: ctx.tenant.id },
      create: { tenantId: ctx.tenant.id, ...input, updatedById: ctx.principal.user.id },
      update: { ...input, updatedById: ctx.principal.user.id },
    });
    await auditClinic(tx, ctx, meta, {
      action: "clinic.policy_updated",
      entityType: "ClinicPolicy",
      entityId: ctx.tenant.id,
      metadata: { maxDiscountPercent: input.maxDiscountPercent, discountReasonRequired: input.discountReasonRequired, previousMaxDiscountPercent: before.maxDiscountPercent },
    });
  });
}
