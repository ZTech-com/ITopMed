import "server-only";
import { z } from "zod";
import { PlatformRole } from "@/generated/prisma/client";
import { emailSchema, personNameSchema } from "@/lib/validation";
import { recordAudit } from "../audit";
import type { PlatformPrincipal, RequestMeta } from "../auth/platform-auth";
import { platformCan } from "../authz/platform";
import { platformDb, withPlatform, type Tx } from "../db";
import { sendEmail } from "../email";
import { platformInvitationEmail } from "../email/templates";
import { env } from "../env";
import { DomainError } from "../errors";
import { hashIp, randomToken, sha256Hex, uuidv7 } from "../security/crypto";
import { hashPassword, passwordSchema } from "../security/password";
import { rateLimit } from "../security/rate-limit";

/** Platform invitations are shorter-lived than clinic ones: they grant console access. */
export const PLATFORM_INVITATION_TTL_HOURS = 48;
const TOKEN_RE = /^[a-z2-7]{20,64}$/;

function authorize(actor: PlatformPrincipal) {
  if (!actor.mfaVerified) throw new DomainError("errors.mfaRequired");
  if (!platformCan(actor.user.role, "staff.manage")) throw new DomainError("errors.forbidden");
}

function audit(tx: Tx, actor: PlatformPrincipal, meta: RequestMeta, e: { action: string; entityType: string; entityId: string; metadata?: Record<string, string | number | boolean> }) {
  return recordAudit(tx, { ...e, actorType: "PLATFORM_USER", actorId: actor.user.id, ipHash: hashIp(meta.ip), userAgent: meta.userAgent });
}

export const platformInviteSchema = z
  .object({
    email: emailSchema,
    fullName: personNameSchema,
    role: z.enum(PlatformRole, "validation.required"),
    /** Required for NETWORK_ADMIN (the one network they manage); never set for other roles. */
    networkId: z.union([z.literal("").transform(() => undefined), z.uuid()]).optional(),
  })
  .refine((v) => (v.role === "NETWORK_ADMIN") === Boolean(v.networkId), { message: "validation.required", path: ["networkId"] });

async function deliver(a: { to: string; name: string; role: PlatformRole; locale: string; token: string }) {
  const msg = await platformInvitationEmail({
    locale: a.locale,
    to: a.to,
    inviteeName: a.name,
    role: a.role,
    link: `${env().APP_URL.replace(/\/$/, "")}/admin/invite/${a.token}`,
    expiresInHours: PLATFORM_INVITATION_TTL_HOURS,
  });
  return sendEmail(msg);
}

/**
 * Invites a new ITop Med employee to the console. The person sets their own
 * password from the emailed single-use link and must enrol two-step
 * verification at the first sign-in. Only SUPER_ADMIN (staff.manage) may do this.
 */
export async function invitePlatformStaff(actor: PlatformPrincipal, raw: unknown, meta: RequestMeta) {
  const inv = await createPlatformInvitation(actor, raw, meta);
  const { delivered } = await deliver({ to: inv.email, name: inv.fullName, role: inv.role, locale: actor.user.locale, token: inv.token });
  return { id: inv.id, delivered };
}

/** Creates the invitation and returns the raw token for delivery. The token is never persisted. */
export async function createPlatformInvitation(actor: PlatformPrincipal, raw: unknown, meta: RequestMeta) {
  authorize(actor);
  const input = platformInviteSchema.parse(raw);
  const token = randomToken();
  const id = uuidv7();
  await withPlatform(async (tx) => {
    const existing = await tx.platformUser.findUnique({ where: { email: input.email }, select: { id: true } });
    if (existing) throw new DomainError("errors.staffExists");
    const pending = await tx.platformInvitation.findFirst({ where: { email: input.email, status: "PENDING", expiresAt: { gt: new Date() } }, select: { id: true } });
    if (pending) throw new DomainError("errors.invitationPending");
    if (input.networkId && !(await tx.network.findFirst({ where: { id: input.networkId, archivedAt: null }, select: { id: true } }))) throw new DomainError("errors.notFound");
    await tx.platformInvitation.create({
      data: {
        id,
        email: input.email,
        fullName: input.fullName,
        role: input.role,
        networkId: input.networkId ?? null,
        tokenHash: sha256Hex(token),
        expiresAt: new Date(Date.now() + PLATFORM_INVITATION_TTL_HOURS * 3_600_000),
        invitedById: actor.user.id,
      },
    });
    await audit(tx, actor, meta, { action: "platform.staff.invited", entityType: "PlatformInvitation", entityId: id, metadata: { role: input.role, ...(input.networkId ? { networkId: input.networkId } : {}) } });
  });
  return { id, token, email: input.email, fullName: input.fullName, role: input.role };
}

/** Rotates the token (the old link stops working), extends expiry and re-sends. */
export async function resendPlatformInvitation(actor: PlatformPrincipal, invitationId: string, meta: RequestMeta) {
  const inv = await rotatePlatformInvitation(actor, invitationId, meta);
  return deliver({ to: inv.email, name: inv.fullName, role: inv.role, locale: actor.user.locale, token: inv.token });
}

export async function rotatePlatformInvitation(actor: PlatformPrincipal, invitationId: string, meta: RequestMeta) {
  authorize(actor);
  if (!z.uuid().safeParse(invitationId).success) throw new DomainError("errors.notFound");
  const token = randomToken();
  const inv = await withPlatform(async (tx) => {
    const inv = await tx.platformInvitation.findUnique({ where: { id: invitationId } });
    if (!inv || inv.status !== "PENDING") throw new DomainError("errors.invitationNotPending");
    await tx.platformInvitation.update({
      where: { id: inv.id },
      data: { tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + PLATFORM_INVITATION_TTL_HOURS * 3_600_000) },
    });
    await audit(tx, actor, meta, { action: "platform.staff.invitation_resent", entityType: "PlatformInvitation", entityId: inv.id });
    return inv;
  });
  return { ...inv, token };
}

export async function revokePlatformInvitation(actor: PlatformPrincipal, invitationId: string, meta: RequestMeta) {
  authorize(actor);
  if (!z.uuid().safeParse(invitationId).success) throw new DomainError("errors.notFound");
  await withPlatform(async (tx) => {
    const r = await tx.platformInvitation.updateMany({ where: { id: invitationId, status: "PENDING" }, data: { status: "REVOKED", revokedAt: new Date() } });
    if (r.count !== 1) throw new DomainError("errors.invitationNotPending");
    await audit(tx, actor, meta, { action: "platform.staff.invitation_revoked", entityType: "PlatformInvitation", entityId: invitationId });
  });
}

export async function listPendingPlatformInvitations(actor: PlatformPrincipal) {
  if (!platformCan(actor.user.role, "staff.read")) throw new DomainError("errors.forbidden");
  return platformDb().platformInvitation.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, fullName: true, role: true, expiresAt: true, createdAt: true, invitedBy: { select: { fullName: true } } },
  });
}

export type PlatformInvitationPreview =
  | { valid: true; email: string; fullName: string; role: PlatformRole }
  | { valid: false; reason: "not_found" | "expired" | "used" };

/** Reads an invitation using only the presented token. */
export async function previewPlatformInvitation(token: string): Promise<PlatformInvitationPreview> {
  if (!TOKEN_RE.test(token)) return { valid: false, reason: "not_found" };
  const inv = await platformDb().platformInvitation.findUnique({ where: { tokenHash: sha256Hex(token) } });
  if (!inv) return { valid: false, reason: "not_found" };
  if (inv.status !== "PENDING") return { valid: false, reason: "used" };
  if (inv.expiresAt <= new Date()) return { valid: false, reason: "expired" };
  return { valid: true, email: inv.email, fullName: inv.fullName, role: inv.role };
}

export const acceptPlatformInvitationSchema = z
  .object({ fullName: personNameSchema, password: passwordSchema, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, { message: "validation.passwordMismatch", path: ["confirmPassword"] });

/**
 * Creates the staff account from a valid invitation — single use, atomic.
 * The new account has no second factor yet: the first sign-in forces enrolment.
 */
export async function acceptPlatformInvitation(token: string, raw: unknown, meta: RequestMeta) {
  if (!(await rateLimit(`pinvite:${hashIp(meta.ip) ?? "noip"}`, 20, 15 * 60_000))) throw new DomainError("errors.rateLimited");
  if (!TOKEN_RE.test(token)) throw new DomainError("errors.invitationInvalid");
  const input = acceptPlatformInvitationSchema.parse(raw);
  const passwordHash = await hashPassword(input.password);
  const tokenHash = sha256Hex(token);
  await withPlatform(async (tx) => {
    const inv = await tx.platformInvitation.findUnique({ where: { tokenHash } });
    if (!inv || inv.status !== "PENDING") throw new DomainError("errors.invitationInvalid");
    if (inv.expiresAt <= new Date()) throw new DomainError("errors.invitationExpired");
    if (await tx.platformUser.findUnique({ where: { email: inv.email }, select: { id: true } })) throw new DomainError("errors.staffExists");
    const claimed = await tx.platformInvitation.updateMany({ where: { id: inv.id, status: "PENDING" }, data: { status: "ACCEPTED", acceptedAt: new Date() } });
    if (claimed.count !== 1) throw new DomainError("errors.invitationInvalid");
    const userId = uuidv7();
    await tx.platformUser.create({ data: { id: userId, email: inv.email, fullName: input.fullName, passwordHash, role: inv.role, networkId: inv.networkId, status: "ACTIVE" } });
    await recordAudit(tx, {
      actorType: "PLATFORM_USER",
      actorId: userId,
      action: "platform.staff.created",
      entityType: "PlatformUser",
      entityId: userId,
      ipHash: hashIp(meta.ip),
      userAgent: meta.userAgent,
      metadata: { role: inv.role, via: "invitation", invitationId: inv.id },
    });
  });
}

/**
 * Creates a console account (e.g. a network admin) the way the super admin
 * chose: with a password they set now and hand over in person, or by emailed
 * invitation. The password path is the same single-use invitation accepted at
 * once on the server; the person still enrols two-step verification at the
 * first sign-in. The password is never stored in plain text, logged or put in a URL.
 */
export async function createPlatformAccount(actor: PlatformPrincipal, raw: unknown, meta: RequestMeta): Promise<{ mode: "password" | "invite"; delivered: boolean }> {
  const r = raw as { ownerMode?: unknown; password?: unknown };
  if (r?.ownerMode === "password") {
    const password = passwordSchema.parse(r.password);
    const inv = await createPlatformInvitation(actor, raw, meta);
    await acceptPlatformInvitation(inv.token, { fullName: inv.fullName, password, confirmPassword: password }, meta);
    return { mode: "password", delivered: false };
  }
  const { delivered } = await invitePlatformStaff(actor, raw, meta);
  return { mode: "invite", delivered };
}
