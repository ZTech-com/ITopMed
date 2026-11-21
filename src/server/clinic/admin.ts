import "server-only";
import { z } from "zod";
import { branchSchema, clinicSettingsSchema, personNameSchema, usernameSchema } from "@/lib/validation";
import { recordAudit } from "../audit";
import type { ClinicContext } from "../auth/clinic-auth";
import type { RequestMeta } from "../auth/platform-auth";
import type { Permission } from "../authz/permissions";
import { withAppContext, type Tx } from "../db";
import { hashIp, randomToken, sha256Hex, uuidv7 } from "../security/crypto";
import { passwordSchema } from "../security/password";
import { acceptInvitation } from "../tenancy/invitations";
import { DomainError } from "../tenancy/provisioning";

export function can(ctx: ClinicContext, permission: Permission) {
  return ctx.permissions.has(permission);
}

function require(ctx: ClinicContext, permission: Permission) {
  if (!can(ctx, permission)) throw new DomainError("errors.forbidden");
}

/** Every clinic-side query goes through here: tenant + user context bound for RLS. */
function inClinic<T>(ctx: ClinicContext, fn: (tx: Tx) => Promise<T>) {
  return withAppContext({ tenantId: ctx.tenant.id, userId: ctx.principal.user.id, sessionId: ctx.principal.sessionId }, fn);
}

function audit(tx: Tx, ctx: ClinicContext, meta: RequestMeta, e: { action: string; entityType?: string; entityId?: string; metadata?: Record<string, string | number | boolean | null | string[]> }) {
  return recordAudit(tx, { ...e, tenantId: ctx.tenant.id, actorType: "USER", actorId: ctx.principal.user.id, ipHash: hashIp(meta.ip), userAgent: meta.userAgent });
}

export async function getClinicSettings(ctx: ClinicContext) {
  require(ctx, "clinic.settings.read");
  return inClinic(ctx, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenant.id } }));
}

export async function updateClinicSettings(ctx: ClinicContext, raw: unknown, meta: RequestMeta) {
  require(ctx, "clinic.settings.manage");
  const input = clinicSettingsSchema.parse(raw);
  await inClinic(ctx, async (tx) => {
    await tx.tenant.update({
      where: { id: ctx.tenant.id },
      data: {
        name: input.name,
        legalName: input.legalName ?? null,
        contactPhone: input.contactPhone ?? null,
        address: input.address ?? null,
        defaultLocale: input.defaultLocale,
        timezone: input.timezone,
      },
    });
    await audit(tx, ctx, meta, { action: "clinic.settings.updated", entityType: "Tenant", entityId: ctx.tenant.id });
  });
}

export async function listBranches(ctx: ClinicContext) {
  require(ctx, "clinic.settings.read");
  return inClinic(ctx, (tx) => tx.branch.findMany({ where: { archivedAt: null }, orderBy: [{ isMain: "desc" }, { name: "asc" }] }));
}

export async function createBranch(ctx: ClinicContext, raw: unknown, meta: RequestMeta) {
  require(ctx, "clinic.branches.manage");
  const input = branchSchema.parse(raw);
  const id = uuidv7();
  await inClinic(ctx, async (tx) => {
    const exists = await tx.branch.findFirst({ where: { name: input.name } });
    if (exists) throw new DomainError("errors.branchExists");
    await tx.branch.create({ data: { id, tenantId: ctx.tenant.id, name: input.name, address: input.address, phone: input.phone } });
    await audit(tx, ctx, meta, { action: "branch.created", entityType: "Branch", entityId: id });
  });
  return id;
}

export async function listStaff(ctx: ClinicContext) {
  require(ctx, "staff.read");
  return inClinic(ctx, async (tx) => {
    const members = await tx.membership.findMany({
      where: { tenantId: ctx.tenant.id },
      include: { user: { select: { id: true, fullName: true, username: true, status: true, lastLoginAt: true } }, roles: { include: { role: { select: { key: true, name: true } } } } },
      orderBy: { createdAt: "asc" },
    });
    return { members };
  });
}

export const addStaffSchema = z.object({
  fullName: personNameSchema,
  username: usernameSchema,
  password: passwordSchema,
  roleKeys: z.array(z.string().regex(/^[a-z0-9_]{3,48}$/)).min(1, "validation.roleRequired").max(4),
});

/**
 * Creates a staff account right away: the administrator sets the person's
 * login and first password and hands them over in person; the person then
 * links Telegram (sign-in and password reset through the clinic's bot). No
 * email anywhere. Internally an invitation accepted at once on the server, so
 * RLS and audit are the same as before. The password is never stored in clear
 * and never shown again.
 */
export async function addStaffMember(ctx: ClinicContext, raw: unknown, meta: RequestMeta) {
  require(ctx, "staff.manage");
  const input = addStaffSchema.parse(raw);
  if (input.roleKeys.includes("clinic_owner") && !ctx.roleKeys.includes("clinic_owner")) throw new DomainError("errors.forbidden");
  const taken = await inClinic(ctx, (tx) => tx.$queryRaw<{ taken: boolean }[]>`SELECT app_username_taken(${input.username}) AS taken`);
  if (taken[0]?.taken) throw new DomainError("errors.usernameTaken");
  const token = randomToken();
  const id = uuidv7();
  await inClinic(ctx, async (tx) => {
    const roles = await tx.role.count({ where: { key: { in: input.roleKeys } } });
    if (roles !== new Set(input.roleKeys).size) throw new DomainError("errors.invalidInput");
    await tx.invitation.create({
      data: {
        id,
        tenantId: ctx.tenant.id,
        fullName: input.fullName,
        roleKeys: input.roleKeys,
        tokenHash: sha256Hex(token),
        expiresAt: new Date(Date.now() + 10 * 60_000),
        invitedByUserId: ctx.principal.user.id,
      },
    });
    await audit(tx, ctx, meta, { action: "invitation.created", entityType: "Invitation", entityId: id, metadata: { roles: input.roleKeys } });
  });
  await acceptInvitation(token, { fullName: input.fullName, username: input.username, password: input.password, confirmPassword: input.password }, meta);
  return input.username;
}

export async function listClinicAudit(ctx: ClinicContext, take = 100) {
  require(ctx, "audit.read");
  return inClinic(ctx, async (tx) => {
    const events = await tx.auditEvent.findMany({ orderBy: { seq: "desc" }, take });
    // Names of this clinic's own users (RLS exposes only co-members, incl. former ones).
    // ITop Med staff are never named to clinics: they appear as "ITop Med".
    const userIds = [...new Set(events.filter((e) => e.actorType === "USER" && e.actorId).map((e) => e.actorId!))];
    const users = userIds.length ? await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } }) : [];
    const names = new Map(users.map((u) => [u.id, u.fullName]));
    return events.map((e) => ({ ...e, actorName: e.actorType === "USER" && e.actorId ? (names.get(e.actorId) ?? null) : null }));
  });
}
