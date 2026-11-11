import "server-only";
import { z } from "zod";
import { emailSchema } from "@/lib/validation";
import { recordAudit } from "../audit";
import { setContext, withAppContext } from "../db";
import { sendEmail } from "../email";
import { passwordResetEmail } from "../email/templates";
import { env } from "../env";
import { hashIp, randomToken, sha256Hex, uuidv7 } from "../security/crypto";
import { hashPassword, passwordSchema } from "../security/password";
import { rateLimit } from "../security/rate-limit";
import { DomainError } from "../tenancy/provisioning";
import type { RequestMeta } from "./platform-auth";

export const RESET_TTL_MINUTES = 30;

/**
 * Issues a reset token for an ACTIVE clinic account. Returns null for unknown
 * or inactive accounts; callers must respond identically in both cases so the
 * endpoint cannot be used to discover which emails have accounts.
 * Platform staff are reset by a SUPER_ADMIN, not by self-service.
 */
export async function issuePasswordReset(emailRaw: string, meta: RequestMeta) {
  const parsed = emailSchema.safeParse(emailRaw);
  if (!parsed.success) return null;
  const email = parsed.data;
  const ipHash = hashIp(meta.ip);
  if (!(await rateLimit(`reset:${ipHash ?? "noip"}`, 10, 60 * 60_000)) || !(await rateLimit(`reset:e:${email}`, 3, 60 * 60_000))) return null;

  const found = await withAppContext({}, (tx) =>
    tx.$queryRaw<{ id: string; status: string }[]>`SELECT id, status::text AS status FROM app_auth_lookup_user(${email})`,
  );
  const user = found[0];
  if (!user || user.status !== "ACTIVE") return null;

  const token = randomToken();
  const profile = await withAppContext({ userId: user.id }, async (tx) => {
    const now = new Date();
    // Only the newest link works.
    await tx.passwordReset.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } });
    await tx.passwordReset.create({
      data: { id: uuidv7(), userId: user.id, tokenHash: sha256Hex(token), expiresAt: new Date(now.getTime() + RESET_TTL_MINUTES * 60_000), ipHash },
    });
    await recordAudit(tx, { actorType: "ANONYMOUS", action: "password_reset.requested", entityType: "User", entityId: user.id, ipHash, userAgent: meta.userAgent });
    const u = await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: { fullName: true, locale: true } });
    const m = await tx.membership.findFirst({ where: { userId: user.id, status: "ACTIVE" }, include: { tenant: { select: { defaultLocale: true } } } });
    return { fullName: u.fullName, locale: u.locale ?? m?.tenant.defaultLocale ?? "uz-Latn" };
  });
  return { token, email, ...profile };
}

/** Public entry point: always resolves the same way, whether or not the account exists. */
export async function requestPasswordReset(emailRaw: string, meta: RequestMeta): Promise<void> {
  const r = await issuePasswordReset(emailRaw, meta);
  if (!r) return;
  const link = `${env().APP_URL.replace(/\/$/, "")}/reset-password/${r.token}`;
  await sendEmail(await passwordResetEmail({ locale: r.locale, to: r.email, name: r.fullName, link, expiresInMinutes: RESET_TTL_MINUTES }));
}

export async function isResetTokenValid(token: string): Promise<boolean> {
  if (!/^[a-z2-7]{20,64}$/.test(token)) return false;
  const tokenHash = sha256Hex(token);
  return withAppContext({ resetTokenHash: tokenHash }, async (tx) => {
    const r = await tx.passwordReset.findUnique({ where: { tokenHash } });
    return Boolean(r && !r.usedAt && r.expiresAt > new Date());
  });
}

export const resetPasswordSchema = z
  .object({ password: passwordSchema, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, { message: "validation.passwordMismatch", path: ["confirmPassword"] });

/** Sets the new password, clears lockout, consumes the token and signs out every session. */
export async function resetPassword(token: string, raw: unknown, meta: RequestMeta): Promise<void> {
  const input = resetPasswordSchema.parse(raw);
  if (!/^[a-z2-7]{20,64}$/.test(token)) throw new DomainError("errors.resetInvalid");
  const tokenHash = sha256Hex(token);
  const passwordHash = await hashPassword(input.password);
  await withAppContext({ resetTokenHash: tokenHash }, async (tx) => {
    const r = await tx.passwordReset.findUnique({ where: { tokenHash } });
    if (!r || r.usedAt || r.expiresAt <= new Date()) throw new DomainError("errors.resetInvalid");
    await setContext(tx, { userId: r.userId, resetTokenHash: tokenHash });
    const claimed = await tx.passwordReset.updateMany({ where: { id: r.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) throw new DomainError("errors.resetInvalid");
    const user = await tx.user.findUniqueOrThrow({ where: { id: r.userId } });
    if (user.status !== "ACTIVE") throw new DomainError("errors.resetInvalid");
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, failedLoginCount: 0, lockedUntil: null } });
    await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await recordAudit(tx, { actorType: "USER", actorId: user.id, action: "password_reset.completed", entityType: "User", entityId: user.id, ipHash: hashIp(meta.ip), userAgent: meta.userAgent });
  });
}
