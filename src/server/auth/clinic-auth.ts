import "server-only";
import { recordAudit } from "../audit";
import { isPermission, type Permission } from "../authz/permissions";
import { MODULES, applyModules } from "../modules/catalog";
import { setContext, withAppContext } from "../db";
import { DomainError } from "../errors";
import { hashIp, randomToken, sha256Hex } from "../security/crypto";
import { verifyPassword } from "../security/password";
import { rateLimit } from "../security/rate-limit";
import type { RequestMeta } from "./platform-auth";

export const CLINIC_SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000;
export const CLINIC_SESSION_IDLE_MS = 60 * 60 * 1000;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export type ClinicLoginResult =
  | { ok: true; token: string; locale: string | null }
  | { ok: false; reason: "invalid" | "locked" | "rate_limited" };

/** Signs in with login name + password. */
export async function loginClinicUser(usernameRaw: string, password: string, meta: RequestMeta): Promise<ClinicLoginResult> {
  const username = usernameRaw.trim().toLowerCase();
  const ipHash = hashIp(meta.ip);
  if (!(await rateLimit(`clogin:${ipHash ?? "noip"}`, 30, 15 * 60_000)) || !(await rateLimit(`clogin:u:${username}`, 10, 15 * 60_000))) {
    return { ok: false, reason: "rate_limited" };
  }

  const found = await withAppContext({}, (tx) =>
    tx.$queryRaw<{ id: string; passwordHash: string | null; status: string; lockedUntil: Date | null }[]>`
      SELECT id, "passwordHash", status::text AS status, "lockedUntil" FROM app_auth_lookup_login(${username})`,
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

  return { ok: true, ...(await startSession(user.id, "clinic.login.password", meta)) };
}

/** Opens a session for an account whose password or Telegram sign-in was just verified. */
async function startSession(userId: string, action: string, meta: RequestMeta): Promise<{ token: string; locale: string | null }> {
  const token = randomToken();
  const ipHash = hashIp(meta.ip);
  const locale = await withAppContext({ userId }, async (tx) => {
    const u = await tx.user.update({ where: { id: userId }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
    await tx.session.create({
      data: { id: sha256Hex(token), userId, expiresAt: new Date(Date.now() + CLINIC_SESSION_ABSOLUTE_MS), ipHash, userAgent: meta.userAgent?.slice(0, 256) },
    });
    await recordAudit(tx, { actorType: "USER", actorId: userId, action, ipHash, userAgent: meta.userAgent });
    return u.locale;
  });
  return { token, locale };
}

export type TelegramSignInResult = { ok: true; token: string; locale: string | null } | { ok: false; reason: "not_linked" | "locked" | "rate_limited" };

/**
 * Signs in with a Telegram account the person linked to their ITop Med account
 * earlier. `tgId` is the Telegram user id from a verified id_token or Mini App initData.
 */
export async function loginClinicWithTelegram(tgId: bigint, meta: RequestMeta): Promise<TelegramSignInResult> {
  const ipHash = hashIp(meta.ip);
  if (!(await rateLimit(`ctg:${ipHash ?? "noip"}`, 30, 15 * 60_000))) return { ok: false, reason: "rate_limited" };
  const rows = await withAppContext({}, (tx) =>
    tx.$queryRaw<{ id: string; status: string; lockedUntil: Date | null }[]>`SELECT id, status::text AS status, "lockedUntil" FROM app_auth_lookup_telegram(${tgId}::bigint)`,
  );
  const user = rows[0];
  if (!user || user.status !== "ACTIVE") {
    await withAppContext({}, (tx) =>
      recordAudit(tx, {
        actorType: user ? "USER" : "ANONYMOUS",
        actorId: user?.id,
        action: "clinic.login.telegram",
        outcome: "FAILURE",
        ipHash,
        userAgent: meta.userAgent,
        metadata: { reason: user ? "inactive" : "not_linked" },
      }),
    );
    return { ok: false, reason: "not_linked" };
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await withAppContext({}, (tx) =>
      recordAudit(tx, { actorType: "USER", actorId: user.id, action: "clinic.login.telegram", outcome: "DENIED", ipHash, userAgent: meta.userAgent, metadata: { reason: "locked" } }),
    );
    return { ok: false, reason: "locked" };
  }
  return { ok: true, ...(await startSession(user.id, "clinic.login.telegram", meta)) };
}

/**
 * Links a Telegram account to the signed-in person's own account. The session
 * that started the flow must still be valid. One Telegram account can belong to
 * one ITop Med account only.
 */
export async function linkClinicTelegram(userId: string, sessionId: string, tgId: bigint, meta: RequestMeta): Promise<void> {
  await withAppContext({ userId, sessionId }, async (tx) => {
    const s = await tx.session.findUnique({ where: { id: sessionId }, select: { userId: true, revokedAt: true, expiresAt: true } });
    if (!s || s.userId !== userId || s.revokedAt || s.expiresAt <= new Date()) throw new DomainError("errors.forbidden");
    const taken = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM app_auth_lookup_telegram(${tgId}::bigint)`;
    if (taken[0] && taken[0].id !== userId) throw new DomainError("errors.telegramTaken");
    await tx.user.update({ where: { id: userId }, data: { telegramId: tgId, telegramLinkedAt: new Date() } });
    await recordAudit(tx, { actorType: "USER", actorId: userId, action: "clinic.telegram.linked", ipHash: hashIp(meta.ip), userAgent: meta.userAgent });
  });
}

export async function unlinkClinicTelegram(p: ClinicPrincipal, meta: RequestMeta): Promise<void> {
  await withAppContext({ userId: p.user.id, sessionId: p.sessionId }, async (tx) => {
    await tx.user.update({ where: { id: p.user.id }, data: { telegramId: null, telegramLinkedAt: null } });
    await recordAudit(tx, { actorType: "USER", actorId: p.user.id, action: "clinic.telegram.unlinked", ipHash: hashIp(meta.ip), userAgent: meta.userAgent });
  });
}

export interface ClinicPrincipal {
  sessionId: string;
  user: { id: string; username: string; email: string; fullName: string; locale: string | null; telegramLinked: boolean };
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
    return {
      sessionId,
      user: { id: user.id, username: user.username, email: user.email, fullName: user.fullName, locale: user.locale, telegramLinked: user.telegramId !== null },
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
    const rows = await tx.tenantModule.findMany({ where: { tenantId: tenant.id, enabled: true }, select: { moduleKey: true } });
    // Core modules are always on; optional ones only when enabled. Disabled modules take their permissions with them.
    const modules = new Set<string>([...MODULES.filter((m) => m.core).map((m) => m.key), ...rows.map((m) => m.moduleKey)]);
    return {
      principal,
      tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name, status: tenant.status, defaultLocale: tenant.defaultLocale, timezone: tenant.timezone, currency: tenant.currency },
      membershipId: membership.id,
      roleKeys: membership.roles.map((r) => r.role.key),
      permissions: applyModules(permissions, modules),
      modules,
      branchIds: membership.allBranches ? null : membership.branches.map((b) => b.branchId),
    };
  });
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
