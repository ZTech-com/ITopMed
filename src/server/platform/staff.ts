import "server-only";
import { z } from "zod";
import { PlatformRole } from "@/generated/prisma/client";
import { personNameSchema, usernameSchema } from "@/lib/validation";
import { recordAudit } from "../audit";
import type { PlatformPrincipal, RequestMeta } from "../auth/platform-auth";
import { platformCan } from "../authz/platform";
import { withPlatform, type Tx } from "../db";
import { DomainError } from "../errors";
import { hashIp, uuidv7 } from "../security/crypto";
import { hashPassword, passwordSchema } from "../security/password";

function authorize(actor: PlatformPrincipal) {
  if (!platformCan(actor.user.role, "staff.manage")) throw new DomainError("errors.forbidden");
}

function audit(tx: Tx, actor: PlatformPrincipal, meta: RequestMeta, e: { action: string; entityType: string; entityId: string; metadata?: Record<string, string | number | boolean> }) {
  return recordAudit(tx, { ...e, actorType: "PLATFORM_USER", actorId: actor.user.id, ipHash: hashIp(meta.ip), userAgent: meta.userAgent });
}

export const platformAccountSchema = z
  .object({
    fullName: personNameSchema,
    username: usernameSchema,
    password: passwordSchema,
    role: z.enum(PlatformRole, "validation.required"),
    /** Required for NETWORK_ADMIN (the one network they manage); never set for other roles. */
    networkId: z.union([z.literal("").transform(() => undefined), z.uuid()]).optional(),
  })
  .refine((v) => (v.role === "NETWORK_ADMIN") === Boolean(v.networkId), { message: "validation.required", path: ["networkId"] });

/**
 * Creates a console account (an ITop Med employee or a network admin). The
 * super admin sets the login and first password and hands them over in person;
 * the person then links Telegram (@ITopMedBot) for sign-in. No email anywhere.
 * Only SUPER_ADMIN (staff.manage). The password is never stored in plain text,
 * logged or put in a URL.
 */
export async function createPlatformAccount(actor: PlatformPrincipal, raw: unknown, meta: RequestMeta): Promise<{ id: string; username: string }> {
  authorize(actor);
  const input = platformAccountSchema.parse(raw);
  const passwordHash = await hashPassword(input.password);
  const id = uuidv7();
  await withPlatform(async (tx) => {
    if (await tx.platformUser.findUnique({ where: { username: input.username }, select: { id: true } })) throw new DomainError("errors.usernameTaken");
    if (input.networkId && !(await tx.network.findFirst({ where: { id: input.networkId, archivedAt: null }, select: { id: true } }))) throw new DomainError("errors.notFound");
    await tx.platformUser.create({
      data: { id, username: input.username, fullName: input.fullName, passwordHash, role: input.role, networkId: input.networkId ?? null, status: "ACTIVE" },
    });
    await audit(tx, actor, meta, {
      action: "platform.staff.created",
      entityType: "PlatformUser",
      entityId: id,
      metadata: { role: input.role, via: "console", ...(input.networkId ? { networkId: input.networkId } : {}) },
    });
  });
  return { id, username: input.username };
}
