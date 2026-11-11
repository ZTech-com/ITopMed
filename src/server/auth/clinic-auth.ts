import "server-only";
import { encodeBase32UpperCaseNoPadding } from "@oslojs/encoding";
import { recordAudit } from "../audit";
import { isPermission, type Permission } from "../authz/permissions";
import { setContext, withAppContext } from "../db";
import { hashIp, randomToken, sha256Hex } from "../security/crypto";
import { verifyPassword } from "../security/password";
import { rateLimit } from "../security/rate-limit";
import { decryptTotpSecret, encryptTotpSecret, newTotpSecret, totpUri, verifyTotp } from "../security/totp";
import type { RequestMeta } from "./platform-auth";

export const CLINIC_SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000;
export const CLINIC_SESSION_IDLE_MS = 60 * 60 * 1000;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
/** Roles that must use MFA (privileged clinic accounts). */
export const MFA_REQUIRED_ROLES = new Set(["clinic_owner", "clinic_admin", "accountant"]);

export type ClinicLoginResult =
  | { ok: true; token: string; locale: string | null }
  | { ok: false; reason: "invalid" | "locked" | "rate_limited" };

export async function loginClinicUser(emailRaw: string, password: string, meta: RequestMeta): Promise<ClinicLoginResult> {
  const email = emailRaw.trim().toLowerCase();
  const ipHash = hashIp(meta.ip);
  if (!(await rateLimit(`clogin:${ipHash ?? "noip"}`, 30, 15 * 60_000)) || !(await rateLimit(`clogin:e:${email}`, 10, 15 * 60_000))) {
    return { ok: false, reason: "rate_limited" };
  }

  const found = await withAppContext({}, (tx) =>
    tx.$queryRaw<{ id: string; passwordHash: string | null; status: string; lockedUntil: Date | null }[]>`
      SELECT id, "passwordHash", status::text AS status, "lockedUntil" FROM app_auth_lookup_user(${email})`,
  );
  const user = found[0];

  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    await withAppContext({}, (tx) =>
      recordAudit(tx, { actorType: "USER", actorId: user.id, action: "clinic.login", outcome: "DENIED", ipHash, userAgent: meta.userAgent, metadata: { reason: "locked" } }),
    );
    return { ok: false, reason: "locked" };
  }

  const valid = await verifyPassword(user?.passwordHash, password);
  if (!user || !valid || user.status !== "ACTIVE") {
    await withAppContext({}, async (tx) => {
      if (user) await tx.$executeRaw`SELECT app_auth_record_failure(${user.id}::uuid, ${MAX_FAILED}::int, ${LOCK_MINUTES}::int)`;
      await recordAudit(tx, {
        actorType: user ? "USER" : "ANONYMOUS",
        actorId: user?.id,
        action: "clinic.login",
        outcome: "FAILURE",
        ipHash,
        userAgent: meta.userAgent,
        metadata: { reason: user ? (valid ? "inactive" : "bad_credentials") : "unknown_account" },
      });
    });
    return { ok: false, reason: "invalid" };
  }

  const token = randomToken();
  const locale = await withAppContext({ userId: user.id }, async (tx) => {
    const u = await tx.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
    await tx.session.create({
      data: {
        id: sha256Hex(token),
        userId: user.id,
        expiresAt: new Date(Date.now() + CLINIC_SESSION_ABSOLUTE_MS),
        ipHash,
        userAgent: meta.userAgent?.slice(0, 256),
      },
    });
    await recordAudit(tx, { actorType: "USER", actorId: user.id, action: "clinic.login.password", ipHash, userAgent: meta.userAgent });
    return u.locale;
  });
  return { ok: true, token, locale };
}

export interface ClinicPrincipal {
  sessionId: string;
  mfaVerified: boolean;
  /** True when the user holds a role that requires MFA in any clinic, or has enrolled. */
  mfaRequired: boolean;
  user: { id: string; email: string; fullName: string; locale: string | null; mfaEnrolled: boolean };
  clinics: { tenantId: string; slug: string; name: string; status: string; defaultLocale: string }[];
}

export async function validateClinicSession(token: string | undefined | null): Promise<ClinicPrincipal | null> {
  if (!token || token.length > 64) return null;
  const sessionId = sha256Hex(token);
  return withAppContext({ sessionId }, async (tx) => {
    const s = await tx.session.findUnique({ where: { id: sessionId } });
    const now = Date.now();
    if (!s || s.revokedAt || s.expiresAt.getTime() <= now || now - s.lastSeenAt.getTime() > CLINIC_SESSION_IDLE_MS) return null;
    await setContext(tx, { sessionId, userId: s.userId });
    const user = await tx.user.findUnique({ where: { id: s.userId } });
    if (!user || user.status !== "ACTIVE") return null;
    if (now - s.lastSeenAt.getTime() > 60_000) await tx.session.update({ where: { id: sessionId }, data: { lastSeenAt: new Date(now) } });

    const memberships = await tx.membership.findMany({
      where: { userId: user.id, status: "ACTIVE" },
      include: { tenant: { select: { id: true, slug: true, name: true, status: true, defaultLocale: true } } },
    });
    // One query across all clinics (SECURITY DEFINER, limited to the current user).
    const privileged = (await tx.$queryRaw<{ privileged: boolean }[]>`SELECT app_current_user_has_role(${[...MFA_REQUIRED_ROLES]}::text[]) AS privileged`)[0]?.privileged ?? false;
    return {
      sessionId,
      mfaVerified: Boolean(s.mfaVerifiedAt),
      mfaRequired: privileged || Boolean(user.mfaEnabledAt),
      user: { id: user.id, email: user.email, fullName: user.fullName, locale: user.locale, mfaEnrolled: Boolean(user.mfaEnabledAt) },
      clinics: memberships.map((m) => ({ tenantId: m.tenant.id, slug: m.tenant.slug, name: m.tenant.name, status: m.tenant.status, defaultLocale: m.tenant.defaultLocale })),
    };
  });
}

export interface ClinicContext {
  principal: ClinicPrincipal;
  tenant: { id: string; slug: string; name: string; status: string; defaultLocale: string; timezone: string; currency: string };
  membershipId: string;
  roleKeys: string[];
  permissions: Set<Permission>;
  modules: Set<string>;
  /** null = all branches; otherwise the only branches this member may operate in. */
  branchIds: string[] | null;
}

const USABLE = new Set(["TRIAL", "ACTIVE"]);

/** Resolves the clinic by slug for an authenticated user. Returns null when not a member or clinic unusable. */
export async function resolveClinic(principal: ClinicPrincipal, slug: string): Promise<ClinicContext | null> {
  const clinic = principal.clinics.find((c) => c.slug === slug);
  if (!clinic || !USABLE.has(clinic.status)) return null;
  return withAppContext({ userId: principal.user.id, tenantId: clinic.tenantId, sessionId: principal.sessionId }, async (tx) => {
    const tenant = await tx.tenant.findUnique({ where: { id: clinic.tenantId } });
    const membership = await tx.membership.findUnique({
      where: { tenantId_userId: { tenantId: clinic.tenantId, userId: principal.user.id } },
      include: { roles: { include: { role: { include: { permissions: true } } } }, branches: { select: { branchId: true } } },
    });
    if (!tenant || !membership || membership.status !== "ACTIVE" || !USABLE.has(tenant.status)) return null;
    const permissions = new Set<Permission>();
    for (const mr of membership.roles) for (const p of mr.role.permissions) if (isPermission(p.permission)) permissions.add(p.permission);
    const modules = await tx.tenantModule.findMany({ where: { tenantId: tenant.id, enabled: true }, select: { moduleKey: true } });
    return {
      principal,
      tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name, status: tenant.status, defaultLocale: tenant.defaultLocale, timezone: tenant.timezone, currency: tenant.currency },
      membershipId: membership.id,
      roleKeys: membership.roles.map((r) => r.role.key),
      permissions,
      modules: new Set(modules.map((m) => m.moduleKey)),
      branchIds: membership.allBranches ? null : membership.branches.map((b) => b.branchId),
    };
  });
}

export async function beginClinicMfaEnrollment(p: ClinicPrincipal) {
  if (p.user.mfaEnrolled) throw new Error("MFA already enrolled");
  return withAppContext({ userId: p.user.id, sessionId: p.sessionId }, async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: p.user.id } });
    let secret: Uint8Array;
    if (user.mfaSecretEnc) secret = decryptTotpSecret(user.mfaSecretEnc, user.id);
    else {
      secret = newTotpSecret();
      await tx.user.update({ where: { id: user.id }, data: { mfaSecretEnc: encryptTotpSecret(secret, user.id) } });
    }
    return { uri: totpUri(secret, user.email), secretBase32: encodeBase32UpperCaseNoPadding(secret) };
  });
}

export async function verifyClinicMfa(token: string, code: string, meta: RequestMeta): Promise<{ ok: true; token: string } | { ok: false; reason: "invalid" | "rate_limited" }> {
  const p = await validateClinicSession(token);
  if (!p) return { ok: false, reason: "invalid" };
  if (!(await rateLimit(`cmfa:${p.sessionId}`, 5, 5 * 60_000))) return { ok: false, reason: "rate_limited" };
  const ipHash = hashIp(meta.ip);
  const newToken = randomToken();
  const ok = await withAppContext({ userId: p.user.id, sessionId: p.sessionId }, async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: p.user.id } });
    const valid = Boolean(user.mfaSecretEnc) && verifyTotp(decryptTotpSecret(user.mfaSecretEnc!, user.id), code.trim());
    if (!valid) {
      await recordAudit(tx, { actorType: "USER", actorId: user.id, action: "clinic.login.mfa", outcome: "FAILURE", ipHash });
      return false;
    }
    const now = new Date();
    if (!user.mfaEnabledAt) {
      await tx.user.update({ where: { id: user.id }, data: { mfaEnabledAt: now } });
      await recordAudit(tx, { actorType: "USER", actorId: user.id, action: "clinic.mfa.enrolled", ipHash });
    }
    await tx.session.update({ where: { id: p.sessionId }, data: { revokedAt: now } });
    await tx.session.create({
      data: { id: sha256Hex(newToken), userId: user.id, expiresAt: new Date(now.getTime() + CLINIC_SESSION_ABSOLUTE_MS), mfaVerifiedAt: now, ipHash, userAgent: meta.userAgent?.slice(0, 256) },
    });
    await recordAudit(tx, { actorType: "USER", actorId: user.id, action: "clinic.login.mfa", ipHash });
    return true;
  });
  return ok ? { ok: true, token: newToken } : { ok: false, reason: "invalid" };
}

export async function logoutClinic(token: string | undefined | null) {
  if (!token) return;
  const sessionId = sha256Hex(token);
  await withAppContext({ sessionId }, async (tx) => {
    const s = await tx.session.findUnique({ where: { id: sessionId } });
    if (!s || s.revokedAt) return;
    await setContext(tx, { sessionId, userId: s.userId });
    await tx.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
    await recordAudit(tx, { actorType: "USER", actorId: s.userId, action: "clinic.logout" });
  });
}
