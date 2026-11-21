import "server-only";
import { z } from "zod";
import { passwordSchema, hashPassword } from "../security/password";
import { personNameSchema, usernameSchema } from "@/lib/validation";
import { recordAudit } from "../audit";
import type { RequestMeta } from "../auth/platform-auth";
import { setContext, withAppContext } from "../db";
import { hashIp, sha256Hex, uuidv7 } from "../security/crypto";
import { rateLimit } from "../security/rate-limit";
import { DomainError } from "./provisioning";

const USABLE_TENANT = new Set(["TRIAL", "ACTIVE"]);

export const acceptInvitationSchema = z
  .object({
    fullName: personNameSchema,
    username: usernameSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, { message: "validation.passwordMismatch", path: ["confirmPassword"] });

/**
 * Accepts an internal invitation for a NEW account: creates the user (login,
 * argon2id password hash, no email) with an ACTIVE membership and the invited
 * roles — atomically. Invitations are created and accepted on the server only
 * (clinic creation, "add staff member"); no link is ever sent anywhere.
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

    const username = input.username;
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

    await tx.user.create({ data: { id: userId, username, fullName: input.fullName, passwordHash, status: "ACTIVE" } });

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
