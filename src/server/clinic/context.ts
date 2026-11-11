import "server-only";
import { recordAudit } from "../audit";
import type { ClinicContext } from "../auth/clinic-auth";
import type { RequestMeta } from "../auth/platform-auth";
import type { Permission } from "../authz/permissions";
import { withAppContext, type Tx } from "../db";
import { hashIp } from "../security/crypto";
import { DomainError } from "../tenancy/provisioning";

/** Shared helpers for clinic-side services. */

export function requirePermission(ctx: ClinicContext, ...anyOf: Permission[]) {
  if (!anyOf.some((p) => ctx.permissions.has(p))) throw new DomainError("errors.forbidden");
}

export function inClinic<T>(ctx: ClinicContext, fn: (tx: Tx) => Promise<T>) {
  return withAppContext({ tenantId: ctx.tenant.id, userId: ctx.principal.user.id, sessionId: ctx.principal.sessionId }, fn);
}

export function auditClinic(
  tx: Tx,
  ctx: ClinicContext,
  meta: RequestMeta,
  e: { action: string; entityType: string; entityId: string; metadata?: Record<string, string | number | boolean | null | string[]> },
) {
  return recordAudit(tx, { ...e, tenantId: ctx.tenant.id, actorType: "USER", actorId: ctx.principal.user.id, ipHash: hashIp(meta.ip), userAgent: meta.userAgent });
}

/**
 * Branch scope (ABAC). Members with `allBranches = false` may only see and
 * change resources of their assigned branches. RLS guarantees the tenant;
 * this guarantees the branch.
 */
export function branchWhere(ctx: ClinicContext): { branchId?: { in: string[] } } {
  return ctx.branchIds ? { branchId: { in: ctx.branchIds } } : {};
}

export function canUseBranch(ctx: ClinicContext, branchId: string) {
  return ctx.branchIds === null || ctx.branchIds.includes(branchId);
}

export function assertBranch(ctx: ClinicContext, branchId: string) {
  if (!canUseBranch(ctx, branchId)) throw new DomainError("errors.branchScope");
}
