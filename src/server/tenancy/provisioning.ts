import "server-only";
import { Prisma, type TenantStatus } from "@/generated/prisma/client";
import { createClinicSchema, statusReasonSchema, type CreateClinicInput } from "@/lib/validation";
import { recordAudit } from "../audit";
import type { PlatformPrincipal, RequestMeta } from "../auth/platform-auth";
import { platformCan, type PlatformPermission } from "../authz/platform";
import { ROLE_TEMPLATES, SYSTEM_ROLE_KEYS } from "../authz/permissions";
import { platformDb, withPlatform, type Tx } from "../db";
import { sendEmail } from "../email";
import { DomainError } from "../errors";
import { invitationEmail } from "../email/templates";
import { env } from "../env";
import { MODULES, isModuleKey } from "../modules/catalog";
import { hashIp, randomToken, sha256Hex, uuidv7 } from "../security/crypto";

export const INVITATION_TTL_HOURS = 72;

// Kept here as a re-export: most services import it from this module.
export { DomainError };

function authorize(actor: PlatformPrincipal, permission: PlatformPermission) {
  if (!actor.mfaVerified) throw new DomainError("errors.mfaRequired");
  if (!platformCan(actor.user.role, permission)) throw new DomainError("errors.forbidden");
}

function audit(tx: Tx, actor: PlatformPrincipal, meta: RequestMeta, e: Omit<Parameters<typeof recordAudit>[1], "actorType" | "actorId">) {
  return recordAudit(tx, { ...e, actorType: "PLATFORM_USER", actorId: actor.user.id, ipHash: hashIp(meta.ip), userAgent: meta.userAgent });
}

/**
 * Creates a fully isolated clinic workspace in ONE transaction:
 * tenant → main branch → role set from templates → trial subscription →
 * module flags → owner invitation → audit events. Nothing is partially created.
 * Returns the raw invitation token for delivery; it is never persisted.
 */
export async function provisionClinic(actor: PlatformPrincipal, raw: unknown, meta: RequestMeta) {
  authorize(actor, "tenants.create");
  const input: CreateClinicInput = createClinicSchema.parse(raw);
  const token = randomToken();
  const tenantId = uuidv7();
  const now = new Date();

  try {
    await withPlatform(async (tx) => {
      const plan = await tx.plan.findFirst({ where: { code: input.planCode, isActive: true } });
      if (!plan) throw new DomainError("errors.planNotFound");

      const trial = plan.trialDays > 0;
      await tx.tenant.create({
        data: {
          id: tenantId,
          slug: input.slug,
          name: input.name,
          legalName: input.legalName,
          taxId: input.taxId,
          status: trial ? "TRIAL" : "ACTIVE",
          defaultLocale: input.defaultLocale,
          timezone: input.timezone,
          contactEmail: input.contactEmail,
          contactPhone: input.contactPhone,
          address: input.address,
          createdById: actor.user.id,
          activatedAt: trial ? null : now,
        },
      });

      await tx.branch.create({
        data: { id: uuidv7(), tenantId, name: input.name, address: input.address, phone: input.contactPhone, isMain: true },
      });

      for (const key of SYSTEM_ROLE_KEYS) {
        const roleId = uuidv7();
        await tx.role.create({ data: { id: roleId, tenantId, key, isSystem: true } });
        await tx.rolePermission.createMany({ data: ROLE_TEMPLATES[key].map((permission) => ({ tenantId, roleId, permission })) });
      }

      await tx.subscription.create({
        data: {
          id: uuidv7(),
          tenantId,
          planId: plan.id,
          status: trial ? "TRIALING" : "ACTIVE",
          trialEndsAt: trial ? new Date(now.getTime() + plan.trialDays * 86_400_000) : null,
          currentPeriodStart: now,
        },
      });

      await tx.tenantModule.createMany({
        data: MODULES.map((m) => ({ tenantId, moduleKey: m.key, enabled: m.core || (m.defaultOn && plan.modules.includes(m.key)), updatedById: actor.user.id })),
      });

      const invitationId = uuidv7();
      await tx.invitation.create({
        data: {
          id: invitationId,
          tenantId,
          email: input.ownerEmail,
          fullName: input.ownerFullName,
          roleKeys: ["clinic_owner"],
          tokenHash: sha256Hex(token),
          expiresAt: new Date(now.getTime() + INVITATION_TTL_HOURS * 3_600_000),
          invitedByPlatformUserId: actor.user.id,
        },
      });

      await audit(tx, actor, meta, { tenantId, action: "tenant.created", entityType: "Tenant", entityId: tenantId, metadata: { slug: input.slug, plan: plan.code } });
      await audit(tx, actor, meta, { tenantId, action: "invitation.created", entityType: "Invitation", entityId: invitationId, metadata: { roles: ["clinic_owner"] } });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new DomainError("errors.slugTaken");
    throw e;
  }

  return { tenantId, slug: input.slug, inviteToken: token, ownerEmail: input.ownerEmail, ownerFullName: input.ownerFullName, locale: input.defaultLocale, clinicName: input.name };
}

export function invitationLink(token: string) {
  return `${env().APP_URL.replace(/\/$/, "")}/invite/${token}`;
}

export async function deliverInvitation(a: { to: string; name: string; clinicName: string; locale: string; token: string }) {
  const msg = await invitationEmail({
    locale: a.locale,
    to: a.to,
    inviteeName: a.name,
    clinicName: a.clinicName,
    link: invitationLink(a.token),
    expiresInHours: INVITATION_TTL_HOURS,
  });
  return sendEmail(msg);
}

/** Provision + send the owner invitation. The token never leaves the server. */
export async function createClinicAndInvite(actor: PlatformPrincipal, raw: unknown, meta: RequestMeta) {
  const r = await provisionClinic(actor, raw, meta);
  const { delivered } = await deliverInvitation({ to: r.ownerEmail, name: r.ownerFullName, clinicName: r.clinicName, locale: r.locale, token: r.inviteToken });
  return { tenantId: r.tenantId, slug: r.slug, invitationDelivered: delivered };
}

/** Rotates the token (old link stops working), extends expiry and re-sends. */
export async function resendInvitation(actor: PlatformPrincipal, invitationId: string, meta: RequestMeta) {
  authorize(actor, "tenants.manage");
  const token = randomToken();
  const inv = await withPlatform(async (tx) => {
    const inv = await tx.invitation.findUnique({ where: { id: invitationId }, include: { tenant: true } });
    if (!inv || inv.status !== "PENDING") throw new DomainError("errors.invitationNotPending");
    await tx.invitation.update({
      where: { id: inv.id },
      data: {
        tokenHash: sha256Hex(token),
        expiresAt: new Date(Date.now() + INVITATION_TTL_HOURS * 3_600_000),
        sendCount: { increment: 1 },
        lastSentAt: new Date(),
      },
    });
    await audit(tx, actor, meta, { tenantId: inv.tenantId, action: "invitation.resent", entityType: "Invitation", entityId: inv.id });
    return inv;
  });
  return deliverInvitation({ to: inv.email, name: inv.fullName, clinicName: inv.tenant.name, locale: inv.tenant.defaultLocale, token });
}

export async function revokeInvitation(actor: PlatformPrincipal, invitationId: string, meta: RequestMeta) {
  authorize(actor, "tenants.manage");
  await withPlatform(async (tx) => {
    const inv = await tx.invitation.findUnique({ where: { id: invitationId } });
    if (!inv || inv.status !== "PENDING") throw new DomainError("errors.invitationNotPending");
    await tx.invitation.update({ where: { id: inv.id }, data: { status: "REVOKED", revokedAt: new Date() } });
    await audit(tx, actor, meta, { tenantId: inv.tenantId, action: "invitation.revoked", entityType: "Invitation", entityId: inv.id });
  });
}

export type LifecycleAction = "activate" | "suspend" | "reactivate" | "archive";

const TRANSITIONS: Record<LifecycleAction, { from: TenantStatus[]; to: TenantStatus; needsReason: boolean }> = {
  activate: { from: ["TRIAL"], to: "ACTIVE", needsReason: false },
  suspend: { from: ["TRIAL", "ACTIVE"], to: "SUSPENDED", needsReason: true },
  reactivate: { from: ["SUSPENDED"], to: "ACTIVE", needsReason: false },
  archive: { from: ["TRIAL", "ACTIVE", "SUSPENDED"], to: "ARCHIVED", needsReason: true },
};

/**
 * Tenant lifecycle. Suspension and archival take effect on the very next
 * request of every clinic user, because the clinic guard checks tenant status.
 * Archival never deletes data: retention rules apply (docs/SECURITY-AND-PRIVACY.md).
 */
export async function changeTenantStatus(actor: PlatformPrincipal, tenantId: string, action: LifecycleAction, reasonRaw: string | undefined, meta: RequestMeta) {
  authorize(actor, "tenants.lifecycle");
  const rule = TRANSITIONS[action];
  const reason = rule.needsReason ? statusReasonSchema.parse(reasonRaw ?? "") : undefined;
  await withPlatform(async (tx) => {
    const t = await tx.tenant.findUnique({ where: { id: tenantId } });
    if (!t) throw new DomainError("errors.notFound");
    if (!rule.from.includes(t.status)) throw new DomainError("errors.invalidTransition");
    const now = new Date();
    await tx.tenant.update({
      where: { id: tenantId },
      data: {
        status: rule.to,
        ...(action === "activate" || action === "reactivate" ? { activatedAt: t.activatedAt ?? now, suspendedAt: null, suspensionReason: null } : {}),
        ...(action === "suspend" ? { suspendedAt: now, suspensionReason: reason } : {}),
        ...(action === "archive" ? { archivedAt: now } : {}),
      },
    });
    if (action === "suspend") await tx.subscription.updateMany({ where: { tenantId }, data: { status: "SUSPENDED" } });
    if (action === "reactivate") await tx.subscription.updateMany({ where: { tenantId, status: "SUSPENDED" }, data: { status: "ACTIVE" } });
    // The reason is free text written by staff; it is kept on the tenant record, not in audit metadata.
    await audit(tx, actor, meta, { tenantId, action: `tenant.${action}`, entityType: "Tenant", entityId: tenantId, metadata: { from: t.status, to: rule.to } });
  });
}

export async function setTenantModule(actor: PlatformPrincipal, tenantId: string, moduleKey: string, enabled: boolean, meta: RequestMeta) {
  authorize(actor, "modules.manage");
  if (!isModuleKey(moduleKey)) throw new DomainError("errors.invalidInput");
  if (MODULES.find((m) => m.key === moduleKey)?.core && !enabled) throw new DomainError("errors.coreModule");
  await withPlatform(async (tx) => {
    await tx.tenantModule.upsert({
      where: { tenantId_moduleKey: { tenantId, moduleKey } },
      create: { tenantId, moduleKey, enabled, updatedById: actor.user.id },
      update: { enabled, updatedById: actor.user.id },
    });
    await audit(tx, actor, meta, { tenantId, action: enabled ? "module.enabled" : "module.disabled", entityType: "TenantModule", entityId: moduleKey });
  });
}

export async function changeSubscriptionPlan(actor: PlatformPrincipal, tenantId: string, planCode: string, meta: RequestMeta) {
  authorize(actor, "subscriptions.manage");
  await withPlatform(async (tx) => {
    const plan = await tx.plan.findFirst({ where: { code: planCode, isActive: true } });
    if (!plan) throw new DomainError("errors.planNotFound");
    const sub = await tx.subscription.findUnique({ where: { tenantId } });
    if (!sub) throw new DomainError("errors.notFound");
    await tx.subscription.update({ where: { tenantId }, data: { planId: plan.id } });
    await audit(tx, actor, meta, { tenantId, action: "subscription.plan_changed", entityType: "Subscription", entityId: sub.id, metadata: { plan: plan.code } });
  });
}

/** Read models for the platform console. Only non-clinical, aggregate data. */
export async function listTenants(actor: PlatformPrincipal, opts: { q?: string; status?: TenantStatus } = {}) {
  authorize(actor, "tenants.read");
  const q = opts.q?.trim();
  return platformDb().tenant.findMany({
    where: {
      ...(opts.status ? { status: opts.status } : {}),
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { slug: { contains: q.toLowerCase() } }] } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      subscription: { include: { plan: { select: { code: true, name: true } } } },
      _count: { select: { memberships: true, branches: true } },
    },
  });
}

export async function getTenantDetail(actor: PlatformPrincipal, tenantId: string) {
  authorize(actor, "tenants.read");
  const db = platformDb();
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    include: {
      subscription: { include: { plan: true } },
      modules: true,
      branches: { orderBy: { createdAt: "asc" } },
      invitations: { orderBy: { createdAt: "desc" }, take: 20 },
      _count: { select: { memberships: true, branches: true, roles: true } },
    },
  });
  return tenant;
}

export async function platformOverview(actor: PlatformPrincipal) {
  authorize(actor, "tenants.read");
  const db = platformDb();
  const [byStatus, users, branches, pendingInvites] = await Promise.all([
    db.tenant.groupBy({ by: ["status"], _count: { _all: true } }),
    db.membership.count({ where: { status: "ACTIVE" } }),
    db.branch.count({ where: { archivedAt: null } }),
    db.invitation.count({ where: { status: "PENDING", expiresAt: { gt: new Date() } } }),
  ]);
  const counts = Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])) as Partial<Record<TenantStatus, number>>;
  return { counts, users, branches, pendingInvites };
}
