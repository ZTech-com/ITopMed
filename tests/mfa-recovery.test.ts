import { decodeBase32IgnorePadding } from "@oslojs/encoding";
import { generateTOTP } from "@oslojs/otp";
import pg from "pg";
import { describe, expect, it } from "vitest";
import {
  beginClinicMfaEnrollment,
  generateClinicRecoveryCodes,
  loginClinicUser,
  resolveClinic,
  validateClinicSession,
  verifyClinicMfa,
  verifyClinicRecoveryCode,
  type ClinicPrincipal,
} from "@/server/auth/clinic-auth";
import {
  beginPlatformMfaEnrollment,
  createPlatformUser,
  generatePlatformRecoveryCodes,
  loginPlatformUser,
  resetPlatformStaffMfa,
  validatePlatformSession,
  verifyPlatformMfa,
  verifyPlatformRecoveryCode,
  type PlatformPrincipal,
} from "@/server/auth/platform-auth";
import { inviteStaff } from "@/server/clinic/admin";
import { resetMemberMfa } from "@/server/clinic/members";
import { platformDb, withAppContext } from "@/server/db";
import {
  acceptPlatformInvitation,
  createPlatformInvitation,
  previewPlatformInvitation,
  revokePlatformInvitation,
  rotatePlatformInvitation,
} from "@/server/platform/staff";
import { acceptInvitation, acceptInvitationAsExistingUser } from "@/server/tenancy/invitations";
import { META, PASSWORD, clinicContext, clinicWithOwner, platformActor, uniq } from "./helpers/fixtures";

const totp = (secretBase32: string) => generateTOTP(decodeBase32IgnorePadding(secretBase32), 30, 6);

/** Signs in with the password and enrols TOTP; returns the MFA-verified principal and the secret. */
async function enrolClinic(email: string) {
  const login = await loginClinicUser(email, PASSWORD, META);
  if (!login.ok) throw new Error(login.reason);
  const pre = (await validateClinicSession(login.token))!;
  const { secretBase32 } = await beginClinicMfaEnrollment(pre);
  const r = await verifyClinicMfa(login.token, totp(secretBase32), META);
  if (!r.ok) throw new Error(r.reason);
  return { principal: (await validateClinicSession(r.token))!, token: r.token, secretBase32 };
}

async function halfSignedInClinic(email: string) {
  const login = await loginClinicUser(email, PASSWORD, META);
  if (!login.ok) throw new Error(login.reason);
  return login.token;
}

async function enrolPlatform(email: string) {
  const login = await loginPlatformUser(email, PASSWORD, META);
  if (!login.ok) throw new Error(login.reason);
  const pre = (await validatePlatformSession(login.token))!;
  const { secretBase32 } = await beginPlatformMfaEnrollment(pre);
  const r = await verifyPlatformMfa(login.token, totp(secretBase32), META);
  if (!r.ok) throw new Error(r.reason);
  return { principal: (await validatePlatformSession(r.token))!, token: r.token };
}

async function newPlatformStaff(role: "SUPER_ADMIN" | "PLATFORM_ADMIN" | "SUPPORT" = "SUPPORT") {
  const email = `${uniq("staff")}@itopmed.test`;
  await createPlatformUser({ email, fullName: "Synthetic Staff", password: PASSWORD, role });
  return email;
}

async function addStaff(owner: Awaited<ReturnType<typeof clinicWithOwner>>, roleKeys: string[]) {
  const email = `${uniq("staff")}@clinic.test`;
  const inv = await inviteStaff(owner.ctx, { fullName: "Synthetic Staff", email, roleKeys }, META);
  await acceptInvitation(inv.token, { fullName: "Synthetic Staff", password: PASSWORD, confirmPassword: PASSWORD }, META);
  return email;
}

async function asOwner<T>(fn: (c: pg.Client) => Promise<T>) {
  const c = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

describe("clinic MFA recovery codes", () => {
  it("are single-use, stored only as hashes, replaced by a new set, and need an enrolled account", async () => {
    const actor = await platformActor();
    const a = await clinicWithOwner(actor);
    const { principal } = await enrolClinic(a.ownerEmail);

    const codes = await generateClinicRecoveryCodes(principal, META);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z2-7]{4}(-[a-z2-7]{4}){3}$/);

    // Nothing in the database contains a code in clear.
    const stored = await asOwner((c) => c.query<{ codeHash: string }>(`SELECT "codeHash" FROM "MfaRecoveryCode" WHERE "userId" = $1`, [principal.user.id]));
    expect(stored.rows).toHaveLength(10);
    const plain = codes.map((c) => c.replace(/-/g, ""));
    for (const r of stored.rows) {
      expect(r.codeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(plain.some((p) => r.codeHash.includes(p))).toBe(false);
    }

    // A half-signed-in session completes the second factor with a code (case and dashes do not matter).
    const t1 = await halfSignedInClinic(a.ownerEmail);
    const ok = await verifyClinicRecoveryCode(t1, codes[0]!.toUpperCase().replace(/-/g, " "), META);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(await validateClinicSession(t1)).toBeNull(); // rotated: no session fixation
    expect((await validateClinicSession(ok.token))?.mfaVerified).toBe(true);

    // The same code never works twice.
    const t2 = await halfSignedInClinic(a.ownerEmail);
    expect(await verifyClinicRecoveryCode(t2, codes[0]!, META)).toEqual({ ok: false, reason: "invalid" });
    expect(await verifyClinicRecoveryCode(t2, "not-a-code", META)).toEqual({ ok: false, reason: "invalid" });

    // A new set invalidates the old one.
    const fresh = await generateClinicRecoveryCodes((await validateClinicSession(ok.token))!, META);
    const t3 = await halfSignedInClinic(a.ownerEmail);
    expect((await verifyClinicRecoveryCode(t3, codes[1]!, META)).ok).toBe(false);
    expect((await verifyClinicRecoveryCode(t3, fresh[0]!, META)).ok).toBe(true);

    // Generating codes needs a completed second factor.
    const half = (await validateClinicSession(await halfSignedInClinic(a.ownerEmail)))!;
    await expect(generateClinicRecoveryCodes(half, META)).rejects.toThrow("errors.mfaRequired");
  });

  it("a code is burnt atomically: concurrent use succeeds exactly once", async () => {
    const actor = await platformActor();
    const a = await clinicWithOwner(actor);
    const { principal } = await enrolClinic(a.ownerEmail);
    const [code] = await generateClinicRecoveryCodes(principal, META);
    const tokens = await Promise.all([halfSignedInClinic(a.ownerEmail), halfSignedInClinic(a.ownerEmail), halfSignedInClinic(a.ownerEmail)]);
    const results = await Promise.all(tokens.map((t) => verifyClinicRecoveryCode(t, code!, META)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("shares the TOTP attempt limit (no brute force via recovery codes)", async () => {
    const actor = await platformActor();
    const a = await clinicWithOwner(actor);
    await enrolClinic(a.ownerEmail);
    const t = await halfSignedInClinic(a.ownerEmail);
    for (let i = 0; i < 5; i++) expect((await verifyClinicRecoveryCode(t, "aaaa-bbbb-cccc-dddd", META)).ok).toBe(false);
    expect(await verifyClinicRecoveryCode(t, "aaaa-bbbb-cccc-dddd", META)).toEqual({ ok: false, reason: "rate_limited" });
  });

  it("RLS: nobody else can see an account's codes; the platform role has no access at all", async () => {
    const actor = await platformActor();
    const a = await clinicWithOwner(actor);
    const { principal } = await enrolClinic(a.ownerEmail);
    await generateClinicRecoveryCodes(principal, META);
    const other = await addStaff(a, ["clinic_admin"]);
    const otherCtx = await clinicContext(other, a.slug);
    const seen = await withAppContext({ tenantId: a.tenantId, userId: otherCtx.principal.user.id }, (tx) => tx.mfaRecoveryCode.count({ where: { userId: principal.user.id } }));
    expect(seen).toBe(0);
    await expect(platformDb().$queryRawUnsafe(`SELECT count(*) FROM "MfaRecoveryCode"`)).rejects.toThrow(/permission denied/);
  });
});

describe("platform MFA recovery codes and reset", () => {
  it("staff sign in with a recovery code once; a super admin can reset a lost authenticator", async () => {
    const email = await newPlatformStaff("SUPPORT");
    const { principal, token } = await enrolPlatform(email);
    const codes = await generatePlatformRecoveryCodes(principal, META);

    const login = await loginPlatformUser(email, PASSWORD, META);
    if (!login.ok) throw new Error("login");
    const r = await verifyPlatformRecoveryCode(login.token, codes[3]!, META);
    expect(r.ok).toBe(true);
    const again = await loginPlatformUser(email, PASSWORD, META);
    if (!again.ok) throw new Error("login");
    expect((await verifyPlatformRecoveryCode(again.token, codes[3]!, META)).ok).toBe(false);

    // Reset by a super admin: secret and codes gone, every session ends.
    const root = await enrolPlatform(await newPlatformStaff("SUPER_ADMIN"));
    await resetPlatformStaffMfa(root.principal, principal.user.id, META);
    expect(await validatePlatformSession(token)).toBeNull();
    if (r.ok) expect(await validatePlatformSession(r.token)).toBeNull();
    const user = await platformDb().platformUser.findUniqueOrThrow({ where: { id: principal.user.id } });
    expect(user.mfaSecretEnc).toBeNull();
    expect(user.mfaEnabledAt).toBeNull();
    expect(await platformDb().platformMfaRecoveryCode.count({ where: { platformUserId: principal.user.id } })).toBe(0);
    const audit = await platformDb().auditEvent.findFirst({ where: { action: "platform.staff.mfa_reset", entityId: principal.user.id } });
    expect(audit?.actorId).toBe(root.principal.user.id);

    // Next sign-in requires enrolment again.
    const next = await loginPlatformUser(email, PASSWORD, META);
    expect(next.ok && next.mfaEnrolled).toBe(false);
    // Nothing left to reset.
    await expect(resetPlatformStaffMfa(root.principal, principal.user.id, META)).rejects.toThrow("errors.mfaNotSetUp");
  });

  it("only a super admin may reset, never their own", async () => {
    const target = await enrolPlatform(await newPlatformStaff("SUPPORT"));
    const admin = await enrolPlatform(await newPlatformStaff("PLATFORM_ADMIN"));
    await expect(resetPlatformStaffMfa(admin.principal, target.principal.user.id, META)).rejects.toThrow("errors.forbidden");
    const root = await enrolPlatform(await newPlatformStaff("SUPER_ADMIN"));
    await expect(resetPlatformStaffMfa(root.principal, root.principal.user.id, META)).rejects.toThrow("errors.selfChange");
    const halfRoot: PlatformPrincipal = { ...root.principal, mfaVerified: false };
    await expect(resetPlatformStaffMfa(halfRoot, target.principal.user.id, META)).rejects.toThrow("errors.mfaRequired");
  });
});

describe("clinic administrator resets a member's MFA", () => {
  it("resets an enrolled member: secret and codes removed, sessions ended, audited", async () => {
    const actor = await platformActor();
    const a = await clinicWithOwner(actor);
    const adminEmail = await addStaff(a, ["clinic_admin"]);
    const admin = await enrolClinic(adminEmail);
    await generateClinicRecoveryCodes(admin.principal, META);
    const owner = await enrolClinic(a.ownerEmail);
    const ownerCtx = (await resolveClinic(owner.principal, a.slug))!;

    const membership = await withAppContext({ tenantId: a.tenantId, userId: owner.principal.user.id }, (tx) =>
      tx.membership.findFirstOrThrow({ where: { tenantId: a.tenantId, userId: admin.principal.user.id } }),
    );
    await resetMemberMfa(ownerCtx, membership.id, META);

    expect(await validateClinicSession(admin.token)).toBeNull();
    const row = await asOwner((c) => c.query(`SELECT "mfaSecretEnc", "mfaEnabledAt", (SELECT count(*)::int FROM "MfaRecoveryCode" WHERE "userId" = u.id) AS codes FROM "User" u WHERE id = $1`, [admin.principal.user.id]));
    expect(row.rows[0]).toEqual({ mfaSecretEnc: null, mfaEnabledAt: null, codes: 0 });
    const audit = await withAppContext({ tenantId: a.tenantId, userId: owner.principal.user.id }, (tx) =>
      tx.auditEvent.findFirst({ where: { tenantId: a.tenantId, action: "membership.mfa_reset", entityId: membership.id } }),
    );
    expect(audit?.actorId).toBe(owner.principal.user.id);

    // Privileged role: the next sign-in must enrol again.
    const p = (await validateClinicSession(await halfSignedInClinic(adminEmail)))!;
    expect(p.mfaRequired).toBe(true);
    expect(p.user.mfaEnrolled).toBe(false);
  });

  it("enforces the guardrails in the service and again inside PostgreSQL", async () => {
    const actor = await platformActor();
    const a = await clinicWithOwner(actor);
    const owner = await enrolClinic(a.ownerEmail);
    const adminEmail = await addStaff(a, ["clinic_admin"]);
    const admin = await enrolClinic(adminEmail);
    const adminCtx = (await resolveClinic(admin.principal, a.slug))!;
    const doctorEmail = await addStaff(a, ["doctor"]);
    const doctor = await enrolClinic(doctorEmail);
    const doctorCtx = (await resolveClinic(doctor.principal, a.slug))!;

    const memberOf = (userId: string) =>
      withAppContext({ tenantId: a.tenantId, userId: owner.principal.user.id }, (tx) => tx.membership.findFirstOrThrow({ where: { tenantId: a.tenantId, userId } }));
    const ownerM = await memberOf(owner.principal.user.id);
    const doctorM = await memberOf(doctor.principal.user.id);
    const adminM = await memberOf(admin.principal.user.id);

    // An administrator may not reset an owner, nor themself; a doctor may not reset anyone.
    await expect(resetMemberMfa(adminCtx, ownerM.id, META)).rejects.toThrow("errors.ownerOnly");
    await expect(resetMemberMfa(adminCtx, adminM.id, META)).rejects.toThrow("errors.selfChange");
    await expect(resetMemberMfa(doctorCtx, adminM.id, META)).rejects.toThrow("errors.forbidden");

    // Defence in depth: calling the database function directly without staff.manage is refused.
    const direct = await withAppContext({ tenantId: a.tenantId, userId: doctor.principal.user.id }, (tx) =>
      tx.$queryRaw<{ r: string }[]>`SELECT app_reset_member_mfa(${admin.principal.user.id}::uuid) AS r`,
    );
    expect(direct[0]!.r).toBe("forbidden");
    // …and an admin cannot reach an owner through it either.
    const direct2 = await withAppContext({ tenantId: a.tenantId, userId: admin.principal.user.id }, (tx) =>
      tx.$queryRaw<{ r: string }[]>`SELECT app_reset_member_mfa(${owner.principal.user.id}::uuid) AS r`,
    );
    expect(direct2[0]!.r).toBe("owner_only");
    // A user of another clinic cannot be targeted from this clinic.
    const b = await clinicWithOwner(actor);
    const outsider = await enrolClinic(b.ownerEmail);
    const direct3 = await withAppContext({ tenantId: a.tenantId, userId: admin.principal.user.id }, (tx) =>
      tx.$queryRaw<{ r: string }[]>`SELECT app_reset_member_mfa(${outsider.principal.user.id}::uuid) AS r`,
    );
    expect(direct3[0]!.r).toBe("not_found");

    // The admin can reset the doctor.
    await resetMemberMfa(adminCtx, doctorM.id, META);
    expect(await validateClinicSession(doctor.token)).toBeNull();
  });

  it("refuses accounts that also belong to another clinic (ITop Med support handles those)", async () => {
    const actor = await platformActor();
    const a = await clinicWithOwner(actor);
    const b = await clinicWithOwner(actor);
    const email = await addStaff(a, ["doctor"]);
    const doctor = await enrolClinic(email);
    const inv = await inviteStaff(b.ctx, { fullName: "Synthetic Staff", email, roleKeys: ["nurse"] }, META);
    await acceptInvitationAsExistingUser(inv.token, doctor.principal as ClinicPrincipal, META);

    const owner = await enrolClinic(a.ownerEmail);
    const ownerCtx = (await resolveClinic(owner.principal, a.slug))!;
    const m = await withAppContext({ tenantId: a.tenantId, userId: owner.principal.user.id }, (tx) =>
      tx.membership.findFirstOrThrow({ where: { tenantId: a.tenantId, userId: doctor.principal.user.id } }),
    );
    await expect(resetMemberMfa(ownerCtx, m.id, META)).rejects.toThrow("errors.mfaResetOtherClinics");
    expect(await validateClinicSession(doctor.token)).not.toBeNull(); // nothing changed
  });
});

describe("platform staff invitations", () => {
  it("invite → accept creates an ACTIVE account that must enrol MFA; links are single-use", async () => {
    const root = await platformActor("SUPER_ADMIN");
    const email = `${uniq("new")}@itopmed.test`;
    const inv = await createPlatformInvitation(root, { email, fullName: "Synthetic Newcomer", role: "SUPPORT" }, META);
    expect(await previewPlatformInvitation(inv.token)).toEqual({ valid: true, email, fullName: "Synthetic Newcomer", role: "SUPPORT" });

    // Only a hash is stored.
    const row = await platformDb().platformInvitation.findUniqueOrThrow({ where: { id: inv.id } });
    expect(row.tokenHash).not.toContain(inv.token);

    // Duplicate pending invitation and weak password are refused.
    await expect(createPlatformInvitation(root, { email, fullName: "Again", role: "SUPPORT" }, META)).rejects.toThrow("errors.invitationPending");
    await expect(acceptPlatformInvitation(inv.token, { fullName: "Synthetic Newcomer", password: "short", confirmPassword: "short" }, META)).rejects.toThrow();

    await acceptPlatformInvitation(inv.token, { fullName: "Synthetic Newcomer", password: PASSWORD, confirmPassword: PASSWORD }, META);
    const login = await loginPlatformUser(email, PASSWORD, META);
    expect(login.ok && login.mfaEnrolled).toBe(false);
    const user = await platformDb().platformUser.findUniqueOrThrow({ where: { email } });
    expect(user).toMatchObject({ role: "SUPPORT", status: "ACTIVE" });

    await expect(acceptPlatformInvitation(inv.token, { fullName: "X Y", password: PASSWORD, confirmPassword: PASSWORD }, META)).rejects.toThrow("errors.invitationInvalid");
    expect(await previewPlatformInvitation(inv.token)).toEqual({ valid: false, reason: "used" });
    await expect(createPlatformInvitation(root, { email, fullName: "Again", role: "SUPPORT" }, META)).rejects.toThrow("errors.staffExists");
  });

  it("resend rotates the token; revoke and expiry close the link; only super admins may invite", async () => {
    const root = await platformActor("SUPER_ADMIN");
    const inv = await createPlatformInvitation(root, { email: `${uniq("r")}@itopmed.test`, fullName: "Synthetic Person", role: "BILLING" }, META);
    const rotated = await rotatePlatformInvitation(root, inv.id, META);
    expect(await previewPlatformInvitation(inv.token)).toEqual({ valid: false, reason: "not_found" });
    expect((await previewPlatformInvitation(rotated.token)).valid).toBe(true);
    await revokePlatformInvitation(root, inv.id, META);
    expect(await previewPlatformInvitation(rotated.token)).toEqual({ valid: false, reason: "used" });
    await expect(revokePlatformInvitation(root, inv.id, META)).rejects.toThrow("errors.invitationNotPending");

    const late = await createPlatformInvitation(root, { email: `${uniq("e")}@itopmed.test`, fullName: "Synthetic Late", role: "SUPPORT" }, META);
    await platformDb().platformInvitation.update({ where: { id: late.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await previewPlatformInvitation(late.token)).toEqual({ valid: false, reason: "expired" });
    await expect(acceptPlatformInvitation(late.token, { fullName: "Synthetic Late", password: PASSWORD, confirmPassword: PASSWORD }, META)).rejects.toThrow("errors.invitationExpired");

    const admin = await platformActor("PLATFORM_ADMIN");
    await expect(createPlatformInvitation(admin, { email: `${uniq("x")}@itopmed.test`, fullName: "Synthetic X", role: "SUPER_ADMIN" }, META)).rejects.toThrow("errors.forbidden");
  });
});
