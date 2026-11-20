import "server-only";
import { recordAudit } from "../audit";
import { platformDb, withPlatform } from "../db";
import { DomainError } from "../errors";
import { hashIp, randomToken, sha256Hex, uuidv7 } from "../security/crypto";
import { hashPassword, verifyPassword } from "../security/password";
import { rateLimit } from "../security/rate-limit";
import type { PlatformRole } from "@/generated/prisma/client";

export const PLATFORM_SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1000;
export const PLATFORM_SESSION_IDLE_MS = 30 * 60 * 1000;
const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export type LoginResult = { ok: true; token: string; locale: string } | { ok: false; reason: "invalid" | "locked" | "rate_limited" };

/** Signs in with login name + password. */
export async function loginPlatformUser(usernameRaw: string, password: string, meta: RequestMeta): Promise<LoginResult> {
  const username = usernameRaw.trim().toLowerCase();
  const ipHash = hashIp(meta.ip);
  if (!(await rateLimit(`plogin:${ipHash ?? "noip"}`, 20, 15 * 60_000)) || !(await rateLimit(`plogin:u:${username}`, 10, 15 * 60_000))) {
    return { ok: false, reason: "rate_limited" };
  }

  const user = await platformDb().platformUser.findUnique({ where: { username } });
  const now = new Date();

  if (user?.lockedUntil && user.lockedUntil > now) {
    await withPlatform((tx) =>
      recordAudit(tx, { actorType: "PLATFORM_USER", actorId: user.id, action: "platform.login", outcome: "DENIED", ipHash, userAgent: meta.userAgent, metadata: { reason: "locked" } }),
    );
    return { ok: false, reason: "locked" };
  }

  const valid = await verifyPassword(user?.passwordHash, password);
  if (!user || !valid || user.status !== "ACTIVE") {
    await withPlatform(async (tx) => {
      if (user) {
        const failed = user.failedLoginCount + 1;
        await tx.platformUser.update({
          where: { id: user.id },
          data: { failedLoginCount: failed, lockedUntil: failed >= MAX_FAILED ? new Date(now.getTime() + LOCK_MS) : user.lockedUntil },
        });
      }
      await recordAudit(tx, {
        actorType: user ? "PLATFORM_USER" : "ANONYMOUS",
        actorId: user?.id,
        action: "platform.login",
        outcome: "FAILURE",
        ipHash,
        userAgent: meta.userAgent,
        metadata: { reason: user ? (valid ? "inactive" : "bad_credentials") : "unknown_account" },
      });
    });
    return { ok: false, reason: "invalid" };
  }

  return { ok: true, token: await startSession(user.id, "platform.login.password", meta), locale: user.locale };
}

/** Opens a session for an account whose password or Telegram sign-in was just verified. */
async function startSession(userId: string, action: string, meta: RequestMeta): Promise<string> {
  const token = randomToken();
  const now = new Date();
  const ipHash = hashIp(meta.ip);
  await withPlatform(async (tx) => {
    await tx.platformUser.update({ where: { id: userId }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now } });
    await tx.platformSession.create({
      data: { id: sha256Hex(token), platformUserId: userId, expiresAt: new Date(now.getTime() + PLATFORM_SESSION_ABSOLUTE_MS), ipHash, userAgent: meta.userAgent?.slice(0, 256) },
    });
    await recordAudit(tx, { actorType: "PLATFORM_USER", actorId: userId, action, ipHash, userAgent: meta.userAgent });
  });
  return token;
}

export type PlatformTelegramResult = { ok: true; token: string; locale: string } | { ok: false; reason: "not_linked" | "locked" | "rate_limited" };

/** Signs in with a Telegram account linked earlier. `tgId` comes from a verified id_token or Mini App initData. */
export async function loginPlatformWithTelegram(tgId: bigint, meta: RequestMeta): Promise<PlatformTelegramResult> {
  const ipHash = hashIp(meta.ip);
  if (!(await rateLimit(`ptg:${ipHash ?? "noip"}`, 20, 15 * 60_000))) return { ok: false, reason: "rate_limited" };
  const user = await platformDb().platformUser.findUnique({ where: { telegramId: tgId }, select: { id: true, status: true, lockedUntil: true, locale: true } });
  if (!user || user.status !== "ACTIVE") {
    await withPlatform((tx) =>
      recordAudit(tx, {
        actorType: user ? "PLATFORM_USER" : "ANONYMOUS",
        actorId: user?.id,
        action: "platform.login.telegram",
        outcome: "FAILURE",
        ipHash,
        userAgent: meta.userAgent,
        metadata: { reason: user ? "inactive" : "not_linked" },
      }),
    );
    return { ok: false, reason: "not_linked" };
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await withPlatform((tx) =>
      recordAudit(tx, { actorType: "PLATFORM_USER", actorId: user.id, action: "platform.login.telegram", outcome: "DENIED", ipHash, userAgent: meta.userAgent, metadata: { reason: "locked" } }),
    );
    return { ok: false, reason: "locked" };
  }
  return { ok: true, token: await startSession(user.id, "platform.login.telegram", meta), locale: user.locale };
}

/** Links a Telegram account to the signed-in employee's own account; the starting session must still be valid. */
export async function linkPlatformTelegram(userId: string, sessionId: string, tgId: bigint, meta: RequestMeta): Promise<void> {
  await withPlatform(async (tx) => {
    const s = await tx.platformSession.findUnique({ where: { id: sessionId }, select: { platformUserId: true, revokedAt: true, expiresAt: true } });
    if (!s || s.platformUserId !== userId || s.revokedAt || s.expiresAt <= new Date()) throw new DomainError("errors.forbidden");
    const taken = await tx.platformUser.findUnique({ where: { telegramId: tgId }, select: { id: true } });
    if (taken && taken.id !== userId) throw new DomainError("errors.telegramTaken");
    await tx.platformUser.update({ where: { id: userId }, data: { telegramId: tgId, telegramLinkedAt: new Date() } });
    await recordAudit(tx, { actorType: "PLATFORM_USER", actorId: userId, action: "platform.telegram.linked", ipHash: hashIp(meta.ip), userAgent: meta.userAgent });
  });
}

export async function unlinkPlatformTelegram(p: PlatformPrincipal, meta: RequestMeta): Promise<void> {
  await withPlatform(async (tx) => {
    await tx.platformUser.update({ where: { id: p.user.id }, data: { telegramId: null, telegramLinkedAt: null } });
    await recordAudit(tx, { actorType: "PLATFORM_USER", actorId: p.user.id, action: "platform.telegram.unlinked", ipHash: hashIp(meta.ip), userAgent: meta.userAgent });
  });
}

export interface PlatformPrincipal {
  sessionId: string;
  user: { id: string; username: string; email: string; fullName: string; role: PlatformRole; locale: string; telegramLinked: boolean; networkId?: string | null };
}

export async function validatePlatformSession(token: string | undefined | null): Promise<PlatformPrincipal | null> {
  if (!token || token.length > 64) return null;
  const id = sha256Hex(token);
  const s = await platformDb().platformSession.findUnique({ where: { id }, include: { user: true } });
  const now = Date.now();
  if (!s || s.revokedAt || s.expiresAt.getTime() <= now || now - s.lastSeenAt.getTime() > PLATFORM_SESSION_IDLE_MS || s.user.status !== "ACTIVE") {
    return null;
  }
  if (now - s.lastSeenAt.getTime() > 60_000) {
    await platformDb().platformSession.update({ where: { id }, data: { lastSeenAt: new Date(now) } });
  }
  return {
    sessionId: id,
    user: {
      id: s.user.id,
      username: s.user.username,
      email: s.user.email,
      fullName: s.user.fullName,
      role: s.user.role,
      locale: s.user.locale,
      telegramLinked: s.user.telegramId !== null,
      networkId: s.user.networkId,
    },
  };
}

export async function logoutPlatform(token: string | undefined | null) {
  if (!token) return;
  const id = sha256Hex(token);
  await withPlatform(async (tx) => {
    const s = await tx.platformSession.findUnique({ where: { id } });
    if (!s || s.revokedAt) return;
    await tx.platformSession.update({ where: { id }, data: { revokedAt: new Date() } });
    await recordAudit(tx, { actorType: "PLATFORM_USER", actorId: s.platformUserId, action: "platform.logout" });
  });
}

/** Bootstrap / CLI / first run only: creates an ACTIVE platform user. Without a login name the email is the login. */
export async function createPlatformUser(input: { email: string; username?: string; fullName: string; password: string; role: PlatformRole }) {
  const id = uuidv7();
  const email = input.email.trim().toLowerCase();
  const username = (input.username ?? email).trim().toLowerCase();
  const passwordHash = await hashPassword(input.password);
  await withPlatform(async (tx) => {
    if (await tx.platformUser.findUnique({ where: { username }, select: { id: true } })) throw new DomainError("errors.usernameTaken");
    await tx.platformUser.create({ data: { id, username, email, fullName: input.fullName.trim(), passwordHash, role: input.role, status: "ACTIVE" } });
    await recordAudit(tx, { actorType: "SYSTEM", action: "platform.staff.created", entityType: "PlatformUser", entityId: id, metadata: { role: input.role, via: "cli" } });
  });
  return id;
}
