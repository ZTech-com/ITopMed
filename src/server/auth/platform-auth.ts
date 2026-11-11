import "server-only";
import { recordAudit } from "../audit";
import { platformDb, withPlatform } from "../db";
import { hashIp, randomToken, sha256Hex, uuidv7 } from "../security/crypto";
import { hashPassword, verifyPassword } from "../security/password";
import { rateLimit } from "../security/rate-limit";
import { decryptTotpSecret, encryptTotpSecret, newTotpSecret, totpUri, verifyTotp } from "../security/totp";
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

export type LoginResult =
  | { ok: true; token: string; mfaEnrolled: boolean }
  | { ok: false; reason: "invalid" | "locked" | "rate_limited" };

export async function loginPlatformUser(emailRaw: string, password: string, meta: RequestMeta): Promise<LoginResult> {
  const email = emailRaw.trim().toLowerCase();
  const ipHash = hashIp(meta.ip);
  if (!(await rateLimit(`plogin:${ipHash ?? "noip"}`, 20, 15 * 60_000)) || !(await rateLimit(`plogin:e:${email}`, 10, 15 * 60_000))) {
    return { ok: false, reason: "rate_limited" };
  }

  const user = await platformDb().platformUser.findUnique({ where: { email } });
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

  const token = randomToken();
  await withPlatform(async (tx) => {
    await tx.platformUser.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
    await tx.platformSession.create({
      data: {
        id: sha256Hex(token),
        platformUserId: user.id,
        expiresAt: new Date(now.getTime() + PLATFORM_SESSION_ABSOLUTE_MS),
        ipHash,
        userAgent: meta.userAgent?.slice(0, 256),
      },
    });
    await recordAudit(tx, { actorType: "PLATFORM_USER", actorId: user.id, action: "platform.login.password", ipHash, userAgent: meta.userAgent });
  });
  return { ok: true, token, mfaEnrolled: Boolean(user.mfaEnabledAt) };
}

export interface PlatformPrincipal {
  sessionId: string;
  mfaVerified: boolean;
  user: { id: string; email: string; fullName: string; role: PlatformRole; locale: string; mfaEnrolled: boolean };
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
    mfaVerified: Boolean(s.mfaVerifiedAt),
    user: {
      id: s.user.id,
      email: s.user.email,
      fullName: s.user.fullName,
      role: s.user.role,
      locale: s.user.locale,
      mfaEnrolled: Boolean(s.user.mfaEnabledAt),
    },
  };
}

/** Creates (or re-reads a pending) TOTP secret for a user who has not finished enrolment. */
export async function beginPlatformMfaEnrollment(p: PlatformPrincipal): Promise<{ uri: string; secretBase32: string }> {
  if (p.user.mfaEnrolled) throw new Error("MFA already enrolled");
  const user = await platformDb().platformUser.findUniqueOrThrow({ where: { id: p.user.id } });
  let secret: Uint8Array;
  if (user.mfaSecretEnc) {
    secret = decryptTotpSecret(user.mfaSecretEnc, user.id);
  } else {
    secret = newTotpSecret();
    await platformDb().platformUser.update({ where: { id: user.id }, data: { mfaSecretEnc: encryptTotpSecret(secret, user.id) } });
  }
  const { encodeBase32UpperCaseNoPadding } = await import("@oslojs/encoding");
  return { uri: totpUri(secret, user.email), secretBase32: encodeBase32UpperCaseNoPadding(secret) };
}

export type MfaResult = { ok: true; token: string } | { ok: false; reason: "invalid" | "rate_limited" };

/** Verifies a TOTP code, completes enrolment if pending, and rotates the session token. */
export async function verifyPlatformMfa(token: string, code: string, meta: RequestMeta): Promise<MfaResult> {
  const p = await validatePlatformSession(token);
  if (!p) return { ok: false, reason: "invalid" };
  if (!(await rateLimit(`pmfa:${p.sessionId}`, 5, 5 * 60_000))) return { ok: false, reason: "rate_limited" };

  const user = await platformDb().platformUser.findUniqueOrThrow({ where: { id: p.user.id } });
  const ipHash = hashIp(meta.ip);
  const ok = Boolean(user.mfaSecretEnc) && verifyTotp(decryptTotpSecret(user.mfaSecretEnc!, user.id), code.trim());
  if (!ok) {
    await withPlatform((tx) =>
      recordAudit(tx, { actorType: "PLATFORM_USER", actorId: user.id, action: "platform.login.mfa", outcome: "FAILURE", ipHash, userAgent: meta.userAgent }),
    );
    return { ok: false, reason: "invalid" };
  }

  const newToken = randomToken();
  const now = new Date();
  await withPlatform(async (tx) => {
    if (!user.mfaEnabledAt) {
      await tx.platformUser.update({ where: { id: user.id }, data: { mfaEnabledAt: now } });
      await recordAudit(tx, { actorType: "PLATFORM_USER", actorId: user.id, action: "platform.mfa.enrolled", ipHash });
    }
    await tx.platformSession.update({ where: { id: p.sessionId }, data: { revokedAt: now } });
    await tx.platformSession.create({
      data: {
        id: sha256Hex(newToken),
        platformUserId: user.id,
        expiresAt: new Date(now.getTime() + PLATFORM_SESSION_ABSOLUTE_MS),
        mfaVerifiedAt: now,
        ipHash,
        userAgent: meta.userAgent?.slice(0, 256),
      },
    });
    await tx.platformUser.update({ where: { id: user.id }, data: { lastLoginAt: now } });
    await recordAudit(tx, { actorType: "PLATFORM_USER", actorId: user.id, action: "platform.login.mfa", ipHash, userAgent: meta.userAgent });
  });
  return { ok: true, token: newToken };
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

/** Bootstrap / CLI only: creates an ACTIVE platform user who must enrol MFA at first login. */
export async function createPlatformUser(input: { email: string; fullName: string; password: string; role: PlatformRole }) {
  const id = uuidv7();
  const passwordHash = await hashPassword(input.password);
  await withPlatform(async (tx) => {
    await tx.platformUser.create({
      data: { id, email: input.email.trim().toLowerCase(), fullName: input.fullName.trim(), passwordHash, role: input.role, status: "ACTIVE" },
    });
    await recordAudit(tx, { actorType: "SYSTEM", action: "platform.staff.created", entityType: "PlatformUser", entityId: id, metadata: { role: input.role, via: "cli" } });
  });
  return id;
}
