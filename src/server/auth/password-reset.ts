import "server-only";
import { z } from "zod";
import { emailSchema } from "@/lib/validation";
import { recordAudit } from "../audit";
import { setContext, withAppContext } from "../db";
import { env } from "../env";
import { createTranslator } from "use-intl/core";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/config";
import { sendBotMessage } from "../notifications/telegram";
import { clinicBot } from "../telegram/clinic-bot";
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
export async function issuePasswordReset(emailRaw: string, meta: RequestMeta, opts: { ttlMinutes?: number } = {}) {
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

  const r = await createResetToken(user.id, meta, opts.ttlMinutes ?? RESET_TTL_MINUTES, "email");
  return { token: r.token, email, fullName: r.fullName, locale: r.locale };
}

/** A new single-use reset token for this account (only the newest one works). */
async function createResetToken(userId: string, meta: RequestMeta, ttlMinutes: number, channel: "email" | "telegram") {
  const ipHash = hashIp(meta.ip);
  const token = randomToken();
  const profile = await withAppContext({ userId }, async (tx) => {
    const now = new Date();
    await tx.passwordReset.updateMany({ where: { userId, usedAt: null }, data: { usedAt: now } });
    await tx.passwordReset.create({
      data: { id: uuidv7(), userId, tokenHash: sha256Hex(token), expiresAt: new Date(now.getTime() + ttlMinutes * 60_000), ipHash },
    });
    await recordAudit(tx, { actorType: "ANONYMOUS", action: "password_reset.requested", entityType: "User", entityId: userId, ipHash, userAgent: meta.userAgent, metadata: { channel } });
    const u = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { fullName: true, locale: true, telegramId: true } });
    const m = await tx.membership.findFirst({ where: { userId, status: "ACTIVE" }, include: { tenant: { select: { defaultLocale: true } } } });
    return { fullName: u.fullName, telegramId: u.telegramId, locale: u.locale ?? m?.tenant.defaultLocale ?? "uz-Latn" };
  });
  return { token, ...profile };
}

/**
 * Self-service reset WITHOUT email: the person gives their clinic and login; if
 * that login belongs to an active member of the clinic who linked Telegram, the
 * clinic's own bot sends the reset link to that Telegram chat. Always answers the
 * same way (no account discovery). Otherwise the clinic's Administrator sets a
 * new password (Staff page).
 */
export async function requestTelegramPasswordReset(slugRaw: string, usernameRaw: string, meta: RequestMeta): Promise<void> {
  const slug = slugRaw.trim().toLowerCase();
  const username = usernameRaw.trim().toLowerCase();
  if (!/^[a-z0-9-]{3,48}$/.test(slug) || !username || username.length > 120) return;
  const ipHash = hashIp(meta.ip);
  if (!(await rateLimit(`reset:${ipHash ?? "noip"}`, 10, 60 * 60_000)) || !(await rateLimit(`reset:u:${username}`, 3, 60 * 60_000))) return;

  const bot = await clinicBot(slug);
  if (!bot) return;
  const found = await withAppContext({}, (tx) => tx.$queryRaw<{ id: string; status: string }[]>`SELECT id, status::text AS status FROM app_auth_lookup_login(${username})`);
  const user = found[0];
  if (!user || user.status !== "ACTIVE") return;
  const tg = await withAppContext({ userId: user.id }, (tx) => tx.user.findUnique({ where: { id: user.id }, select: { telegramId: true } }));
  if (!tg?.telegramId) return;
  // Only this clinic's active member, through this clinic's bot.
  const member = await withAppContext({}, (tx) => tx.$queryRaw<{ id: string | null }[]>`SELECT app_telegram_member(${tg.telegramId}::bigint, ${bot.tenantId}::uuid) AS id`);
  if (member[0]?.id !== user.id) return;

  const r = await createResetToken(user.id, meta, RESET_TTL_MINUTES, "telegram");
  const link = `${env().APP_URL.replace(/\/$/, "")}/reset-password/${r.token}`;
  const locale = isLocale(r.locale) ? r.locale : DEFAULT_LOCALE;
  const messages = (await import(`../../../messages/${locale}.json`)).default;
  const t = createTranslator({ locale, messages, namespace: "auth" });
  await sendBotMessage(bot.token, tg.telegramId, t("resetTelegramMessage", { clinic: bot.name, minutes: RESET_TTL_MINUTES }), { text: t("resetTelegramButton"), url: link });
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
