import "server-only";
import { z } from "zod";
import { passwordSchema, hashPassword } from "../security/password";
import { personNameSchema, usernameSchema } from "@/lib/validation";
import { recordAudit } from "../audit";
import type { RequestMeta } from "../auth/platform-auth";
import type { ClinicPrincipal } from "../auth/clinic-auth";
import { setContext, withAppContext } from "../db";
import { hashIp, sha256Hex, uuidv7 } from "../security/crypto";
import { rateLimit } from "../security/rate-limit";
import { DomainError } from "./provisioning";

const USABLE_TENANT = new Set(["TRIAL", "ACTIVE"]);

export type InvitationPreview =
  | { valid: true; email: string; fullName: string; clinicName: string; accountExists: boolean; expiresAt: Date }
  | { valid: false; reason: "not_found" | "expired" | "used" | "clinic_unavailable" };

/**
 * Reads an invitation using only the presented token. The RLS policy on
 * Invitation exposes exactly the row whose tokenHash matches.
 */
export async function previewInvitation(token: string): Promise<InvitationPreview> {
  if (!/^[a-z2-7]{20,64}$/.test(token)) return { valid: false, reason: "not_found" };
  const tokenHash = sha256Hex(token);
  return withAppContext({ inviteTokenHash: tokenHash }, async (tx) => {
    const inv = await tx.invitation.findUnique({ where: { tokenHash } });
    if (!inv) return { valid: false, reason: "not_found" } as const;
    if (inv.status !== "PENDING") return { valid: false, reason: "used" } as const;
    if (inv.expiresAt <= new Date()) return { valid: false, reason: "expired" } as const;
    await setContext(tx, { tenantId: inv.tenantId, inviteTokenHash: tokenHash });
    const tenant = await tx.tenant.findUnique({ where: { id: inv.tenantId }, select: { name: true, status: true } });
    if (!tenant || !USABLE_TENANT.has(tenant.status)) return { valid: false, reason: "clinic_unavailable" } as const;
    const existing = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM app_auth_lookup_user(${inv.email})`;
    return { valid: true, email: inv.email, fullName: inv.fullName, clinicName: tenant.name, accountExists: existing.length > 0, expiresAt: inv.expiresAt } as const;
  });
}

/**
 * Accepts an invitation for an account that already exists. The user must be
 * signed in (identity proof) as the invited email. Re-invited former members
 * are reactivated with the newly invited roles only.
 */
export async function acceptInvitationAsExistingUser(token: string, principal: ClinicPrincipal, meta: RequestMeta): Promise<{ slug: string }> {
  if (!/^[a-z2-7]{20,64}$/.test(token)) throw new DomainError("errors.invitationInvalid");
  const tokenHash = sha256Hex(token);
  const userId = principal.user.id;
  return withAppContext({ inviteTokenHash: tokenHash, userId, sessionId: principal.sessionId }, async (tx) => {
    const inv = await tx.invitation.findUnique({ where: { tokenHash } });
    if (!inv || inv.status !== "PENDING") throw new DomainError("errors.invitationInvalid");
    if (inv.expiresAt <= new Date()) throw new DomainError("errors.invitationExpired");
    if (inv.email !== principal.user.email) throw new DomainError("errors.wrongAccount");

    await setContext(tx, { tenantId: inv.tenantId, userId, sessionId: principal.sessionId, inviteTokenHash: tokenHash });
    const tenant = await tx.tenant.findUnique({ where: { id: inv.tenantId }, select: { status: true, slug: true } });
    if (!tenant || !USABLE_TENANT.has(tenant.status)) throw new DomainError("errors.clinicUnavailable");

    const claimed = await tx.invitation.updateMany({
      where: { id: inv.id, status: "PENDING" },
      data: { status: "ACCEPTED", acceptedAt: new Date(), acceptedUserId: userId },
    });
    if (claimed.count !== 1) throw new DomainError("errors.invitationInvalid");

    const existing = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId: inv.tenantId, userId } } });
    if (existing?.status === "ACTIVE") throw new DomainError("errors.alreadyMember");
    const membershipId = existing?.id ?? uuidv7();
    if (existing) {
      await tx.membership.update({ where: { id: existing.id }, data: { status: "ACTIVE", allBranches: true } });
      await tx.membershipRole.deleteMany({ where: { membershipId } });
      await tx.membershipBranch.deleteMany({ where: { membershipId } });
    } else {
      await tx.membership.create({ data: { id: membershipId, tenantId: inv.tenantId, userId, status: "ACTIVE" } });
    }
    const roles = await tx.role.findMany({ where: { tenantId: inv.tenantId, key: { in: inv.roleKeys } }, select: { id: true } });
    if (roles.length !== inv.roleKeys.length) throw new DomainError("errors.roleMissing");
    await tx.membershipRole.createMany({ data: roles.map((r) => ({ tenantId: inv.tenantId, membershipId, roleId: r.id })) });

    const ipHash = hashIp(meta.ip);
    await recordAudit(tx, { tenantId: inv.tenantId, actorType: "USER", actorId: userId, action: "invitation.accepted", entityType: "Invitation", entityId: inv.id, ipHash, userAgent: meta.userAgent, metadata: { existingAccount: true } });
    await recordAudit(tx, { tenantId: inv.tenantId, actorType: "USER", actorId: userId, action: existing ? "membership.reactivated" : "membership.created", entityType: "Membership", entityId: membershipId, ipHash, metadata: { roles: inv.roleKeys } });
    return { slug: tenant.slug };
  });
}

export const acceptInvitationSchema = z
  .object({
    fullName: personNameSchema,
    /** Optional for programmatic callers: the invited email then becomes the login. */
    username: z.preprocess((v) => (v === "" || v === null ? undefined : v), usernameSchema.optional()),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, { message: "validation.passwordMismatch", path: ["confirmPassword"] });

/**
 * Accepts an invitation for a NEW account: creates the user with an argon2id
 * password hash, an ACTIVE membership and the invited roles — atomically.
 * Existing accounts must sign in first (identity proof) — handled in Phase 4.
 */
export async function acceptInvitation(token: string, raw: unknown, meta: RequestMeta): Promise<{ tenantId: string }> {
  if (!(await rateLimit(`invite:${hashIp(meta.ip) ?? "noip"}`, 20, 15 * 60_000))) throw new DomainError("errors.rateLimited");
  const input = acceptInvitationSchema.parse(raw);
  const tokenHash = sha256Hex(token);
  const passwordHash = await hashPassword(input.password);

  return withAppContext({ inviteTokenHash: tokenHash }, async (tx) => {
    const inv = await tx.invitation.findUnique({ where: { tokenHash } });
    if (!inv || inv.status !== "PENDING") throw new DomainError("errors.invitationInvalid");
    if (inv.expiresAt <= new Date()) throw new DomainError("errors.invitationExpired");

    const existing = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM app_auth_lookup_user(${inv.email})`;
    if (existing.length > 0) throw new DomainError("errors.accountExistsSignIn");
    const username = input.username ?? inv.email;
    const taken = await tx.$queryRaw<{ taken: boolean }[]>`SELECT app_username_taken(${username}) AS taken`;
    if (taken[0]?.taken) throw new DomainError("errors.usernameTaken");

    const userId = uuidv7();
    await setContext(tx, { tenantId: inv.tenantId, userId, inviteTokenHash: tokenHash });

    const tenant = await tx.tenant.findUnique({ where: { id: inv.tenantId }, select: { status: true } });
    if (!tenant || !USABLE_TENANT.has(tenant.status)) throw new DomainError("errors.clinicUnavailable");

    // Single-use: the conditional update fails if a concurrent request accepted first.
    const claimed = await tx.invitation.updateMany({
      where: { id: inv.id, status: "PENDING" },
      data: { status: "ACCEPTED", acceptedAt: new Date(), acceptedUserId: userId },
    });
    if (claimed.count !== 1) throw new DomainError("errors.invitationInvalid");

    await tx.user.create({ data: { id: userId, username, email: inv.email, fullName: input.fullName, passwordHash, status: "ACTIVE" } });

    const membershipId = uuidv7();
    await tx.membership.create({ data: { id: membershipId, tenantId: inv.tenantId, userId, status: "ACTIVE" } });
    const roles = await tx.role.findMany({ where: { tenantId: inv.tenantId, key: { in: inv.roleKeys } }, select: { id: true } });
    if (roles.length !== inv.roleKeys.length) throw new DomainError("errors.roleMissing");
    await tx.membershipRole.createMany({ data: roles.map((r) => ({ tenantId: inv.tenantId, membershipId, roleId: r.id })) });

    const ipHash = hashIp(meta.ip);
    await recordAudit(tx, { tenantId: inv.tenantId, actorType: "USER", actorId: userId, action: "invitation.accepted", entityType: "Invitation", entityId: inv.id, ipHash, userAgent: meta.userAgent });
    await recordAudit(tx, { tenantId: inv.tenantId, actorType: "USER", actorId: userId, action: "membership.created", entityType: "Membership", entityId: membershipId, ipHash, metadata: { roles: inv.roleKeys } });
    return { tenantId: inv.tenantId };
  });
}
