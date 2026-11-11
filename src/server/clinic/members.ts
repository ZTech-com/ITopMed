import "server-only";
import { z } from "zod";
import { recordAudit } from "../audit";
import type { ClinicContext } from "../auth/clinic-auth";
import type { RequestMeta } from "../auth/platform-auth";
import { withAppContext, type Tx } from "../db";
import { hashIp } from "../security/crypto";
import { DomainError } from "../tenancy/provisioning";

const OWNER = "clinic_owner";
const uuid = z.uuid();

function inClinic<T>(ctx: ClinicContext, fn: (tx: Tx) => Promise<T>) {
  return withAppContext({ tenantId: ctx.tenant.id, userId: ctx.principal.user.id, sessionId: ctx.principal.sessionId }, fn);
}

function audit(tx: Tx, ctx: ClinicContext, meta: RequestMeta, action: string, membershipId: string, metadata: Record<string, string | number | boolean | string[]> = {}) {
  return recordAudit(tx, { tenantId: ctx.tenant.id, actorType: "USER", actorId: ctx.principal.user.id, action, entityType: "Membership", entityId: membershipId, ipHash: hashIp(meta.ip), userAgent: meta.userAgent, metadata });
}

async function loadTarget(tx: Tx, ctx: ClinicContext, membershipId: string) {
  if (!uuid.safeParse(membershipId).success) throw new DomainError("errors.notFound");
  // Explicit tenant filter: the Membership policy also exposes the caller's own memberships in other clinics.
  const m = await tx.membership.findFirst({
    where: { id: membershipId, tenantId: ctx.tenant.id },
    include: { roles: { include: { role: true } }, branches: true },
  });
  if (!m) throw new DomainError("errors.notFound");
  return m;
}

/** Guardrails shared by every change to someone's access. */
function assertCanModify(ctx: ClinicContext, target: { userId: string; roles: { role: { key: string } }[] }) {
  if (!ctx.permissions.has("staff.manage")) throw new DomainError("errors.forbidden");
  if (target.userId === ctx.principal.user.id) throw new DomainError("errors.selfChange");
  const targetIsOwner = target.roles.some((r) => r.role.key === OWNER);
  if (targetIsOwner && !ctx.roleKeys.includes(OWNER)) throw new DomainError("errors.ownerOnly");
}

async function activeOwnerCount(tx: Tx, ctx: ClinicContext, excludingMembershipId: string) {
  return tx.membership.count({
    where: { tenantId: ctx.tenant.id, status: "ACTIVE", id: { not: excludingMembershipId }, roles: { some: { role: { key: OWNER } } } },
  });
}

export async function getMember(ctx: ClinicContext, membershipId: string) {
  if (!ctx.permissions.has("staff.read")) throw new DomainError("errors.forbidden");
  return inClinic(ctx, async (tx) => {
    const m = await loadTarget(tx, ctx, membershipId);
    const user = await tx.user.findUniqueOrThrow({ where: { id: m.userId }, select: { id: true, fullName: true, email: true, lastLoginAt: true, mfaEnabledAt: true } });
    return { ...m, user };
  });
}

export const memberAccessSchema = z
  .object({
    roleIds: z.array(uuid).min(1, "validation.roleRequired").max(6),
    allBranches: z.boolean(),
    branchIds: z.array(uuid).max(100),
  })
  .refine((v) => v.allBranches || v.branchIds.length > 0, { message: "validation.branchRequired", path: ["branchIds"] });

/** Replaces roles and branch scope of another member. */
export async function updateMemberAccess(ctx: ClinicContext, membershipId: string, raw: unknown, meta: RequestMeta) {
  const input = memberAccessSchema.parse(raw);
  await inClinic(ctx, async (tx) => {
    const target = await loadTarget(tx, ctx, membershipId);
    assertCanModify(ctx, target);

    const roles = await tx.role.findMany({ where: { id: { in: input.roleIds } } });
    if (roles.length !== new Set(input.roleIds).size) throw new DomainError("errors.invalidInput");
    const grantsOwner = roles.some((r) => r.key === OWNER);
    if (grantsOwner && !ctx.roleKeys.includes(OWNER)) throw new DomainError("errors.ownerOnly");
    const wasOwner = target.roles.some((r) => r.role.key === OWNER);
    if (wasOwner && !grantsOwner && target.status === "ACTIVE" && (await activeOwnerCount(tx, ctx, target.id)) === 0) throw new DomainError("errors.lastOwner");

    if (!input.allBranches) {
      const n = await tx.branch.count({ where: { id: { in: input.branchIds }, archivedAt: null } });
      if (n !== new Set(input.branchIds).size) throw new DomainError("errors.invalidInput");
    }

    await tx.membershipRole.deleteMany({ where: { membershipId } });
    await tx.membershipRole.createMany({ data: roles.map((r) => ({ tenantId: ctx.tenant.id, membershipId, roleId: r.id })) });
    await tx.membershipBranch.deleteMany({ where: { membershipId } });
    if (!input.allBranches) {
      await tx.membershipBranch.createMany({ data: [...new Set(input.branchIds)].map((branchId) => ({ tenantId: ctx.tenant.id, membershipId, branchId })) });
    }
    await tx.membership.update({ where: { id: membershipId }, data: { allBranches: input.allBranches } });
    await audit(tx, ctx, meta, "membership.access_changed", membershipId, {
      roles: roles.map((r) => r.key),
      allBranches: input.allBranches,
      branchCount: input.allBranches ? 0 : input.branchIds.length,
    });
  });
}

export type MemberStatusAction = "suspend" | "reactivate" | "remove";

/**
 * Suspension/removal takes effect on the member's next request: every clinic
 * request re-checks membership status. Removal keeps the record (audit history);
 * it never deletes the user's account, which may belong to other clinics.
 */
export async function setMemberStatus(ctx: ClinicContext, membershipId: string, action: MemberStatusAction, meta: RequestMeta) {
  await inClinic(ctx, async (tx) => {
    const target = await loadTarget(tx, ctx, membershipId);
    assertCanModify(ctx, target);
    const next = action === "reactivate" ? "ACTIVE" : action === "suspend" ? "SUSPENDED" : "REMOVED";
    const allowed = { suspend: ["ACTIVE"], reactivate: ["SUSPENDED"], remove: ["ACTIVE", "SUSPENDED", "INVITED"] }[action];
    if (!allowed.includes(target.status)) throw new DomainError("errors.invalidTransition");
    const isOwner = target.roles.some((r) => r.role.key === OWNER);
    if (isOwner && action !== "reactivate" && (await activeOwnerCount(tx, ctx, target.id)) === 0) throw new DomainError("errors.lastOwner");
    await tx.membership.update({ where: { id: membershipId }, data: { status: next } });
    await audit(tx, ctx, meta, `membership.${action}`, membershipId, { from: target.status, to: next });
  });
}
