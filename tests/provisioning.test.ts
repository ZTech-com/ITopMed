import { decodeBase32IgnorePadding } from "@oslojs/encoding";
import { generateTOTP } from "@oslojs/otp";
import pg from "pg";
import { describe, expect, it } from "vitest";
import {
  beginPlatformMfaEnrollment,
  loginPlatformUser,
  validatePlatformSession,
  verifyPlatformMfa,
} from "@/server/auth/platform-auth";
import { resolveClinic, validateClinicSession, loginClinicUser } from "@/server/auth/clinic-auth";
import { createBranch, inviteStaff, listBranches, listClinicAudit, updateClinicSettings } from "@/server/clinic/admin";
import { acceptInvitation, previewInvitation } from "@/server/tenancy/invitations";
import { changeTenantStatus, provisionClinic, resendInvitation, setTenantModule } from "@/server/tenancy/provisioning";
import { platformDb } from "@/server/db";
import { createPlatformUser } from "@/server/auth/platform-auth";
import { META, PASSWORD, clinicContext, clinicWithOwner, platformActor, uniq } from "./helpers/fixtures";

describe("acceptance 1: super admin signs in securely (password + mandatory TOTP)", () => {
  it("requires MFA enrolment, rotates the session after MFA, and locks after repeated failures", async () => {
    const email = `${uniq("root")}@itopmed.test`;
    await createPlatformUser({ email, fullName: "Synthetic Root", password: PASSWORD, role: "SUPER_ADMIN" });

    const login = await loginPlatformUser(email, PASSWORD, META);
    expect(login.ok).toBe(true);
    if (!login.ok) return;
    expect(login.mfaEnrolled).toBe(false);

    const pre = await validatePlatformSession(login.token);
    expect(pre?.mfaVerified).toBe(false);

    const { secretBase32 } = await beginPlatformMfaEnrollment(pre!);
    const bad = await verifyPlatformMfa(login.token, "000000", META);
    expect(bad.ok).toBe(false);
    const code = generateTOTP(decodeBase32IgnorePadding(secretBase32), 30, 6);
    const mfa = await verifyPlatformMfa(login.token, code, META);
    expect(mfa.ok).toBe(true);
    if (!mfa.ok) return;

    expect(await validatePlatformSession(login.token)).toBeNull(); // pre-MFA token revoked
    const post = await validatePlatformSession(mfa.token);
    expect(post?.mfaVerified).toBe(true);
    expect(post?.user.mfaEnrolled).toBe(true);

    for (let i = 0; i < 5; i++) expect((await loginPlatformUser(email, "wrong-password-123", META)).ok).toBe(false);
    const locked = await loginPlatformUser(email, PASSWORD, META);
    expect(locked).toEqual({ ok: false, reason: "locked" });
  });

  it("rejects unknown accounts without revealing whether they exist", async () => {
    expect(await loginPlatformUser("nobody@itopmed.test", PASSWORD, META)).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("acceptance 2–5: clinic provisioning, invitation and owner activation", () => {
  it("provisions an isolated workspace atomically", async () => {
    const actor = await platformActor();
    const slug = uniq("medlife");
    const r = await provisionClinic(
      actor,
      { name: "Synthetic MedLife", slug, contactEmail: "info@medlife.test", defaultLocale: "ru", timezone: "Asia/Tashkent", planCode: "starter", ownerFullName: "Synthetic Owner", ownerEmail: `${uniq("o")}@medlife.test`, taxId: "123456789" },
      META,
    );
    const t = await platformDb().tenant.findUniqueOrThrow({ where: { id: r.tenantId }, include: { branches: true, roles: true, modules: true, subscription: true, invitations: true } });
    expect(t.status).toBe("TRIAL");
    expect(t.branches).toHaveLength(1);
    expect(t.branches[0]!.isMain).toBe(true);
    expect(t.roles.map((x) => x.key).sort()).toContain("clinic_owner");
    expect(t.roles).toHaveLength(12);
    expect(t.subscription?.status).toBe("TRIALING");
    expect(t.modules.find((m) => m.moduleKey === "core")?.enabled).toBe(true);
    expect(t.modules.find((m) => m.moduleKey === "laboratory")?.enabled).toBe(false); // not in starter plan
    expect(t.invitations[0]!.tokenHash).not.toContain(r.inviteToken); // only the hash is stored
    expect(t.invitations[0]!.tokenHash).toHaveLength(64);
  });

  it("rejects duplicate and reserved slugs, and unauthorised platform roles", async () => {
    const actor = await platformActor();
    const base = { name: "Dup", contactEmail: "a@b.test", defaultLocale: "en", timezone: "UTC", planCode: "starter", ownerFullName: "Synthetic Owner", ownerEmail: "o@b.test" };
    const slug = uniq("dup");
    await provisionClinic(actor, { ...base, slug }, META);
    await expect(provisionClinic(actor, { ...base, slug }, META)).rejects.toThrow("errors.slugTaken");
    await expect(provisionClinic(actor, { ...base, slug: "admin" }, META)).rejects.toThrow();
    const support = await platformActor("SUPPORT");
    await expect(provisionClinic(support, { ...base, slug: uniq("x") }, META)).rejects.toThrow("errors.forbidden");
    const noMfa = { ...actor, mfaVerified: false };
    await expect(provisionClinic(noMfa, { ...base, slug: uniq("x") }, META)).rejects.toThrow("errors.mfaRequired");
  });

  it("owner accepts the invitation once, then configures the clinic", async () => {
    const actor = await platformActor();
    const slug = uniq("shifo");
    const ownerEmail = `${uniq("owner")}@shifo.test`;
    const r = await provisionClinic(actor, { name: "Synthetic Shifo", slug, contactEmail: "info@shifo.test", defaultLocale: "uz-Cyrl", timezone: "Asia/Tashkent", planCode: "professional", ownerFullName: "Synthetic Owner", ownerEmail }, META);

    const preview = await previewInvitation(r.inviteToken);
    expect(preview).toMatchObject({ valid: true, email: ownerEmail, clinicName: "Synthetic Shifo", accountExists: false });

    await expect(acceptInvitation(r.inviteToken, { fullName: "Synthetic Owner", password: "short", confirmPassword: "short" }, META)).rejects.toThrow();
    await acceptInvitation(r.inviteToken, { fullName: "Synthetic Owner", password: PASSWORD, confirmPassword: PASSWORD }, META);
    await expect(acceptInvitation(r.inviteToken, { fullName: "X Y", password: PASSWORD, confirmPassword: PASSWORD }, META)).rejects.toThrow("errors.invitationInvalid");
    expect(await previewInvitation(r.inviteToken)).toEqual({ valid: false, reason: "used" });

    const ctx = await clinicContext(ownerEmail, slug);
    expect(ctx.roleKeys).toEqual(["clinic_owner"]);
    expect(ctx.principal.mfaRequired).toBe(true); // privileged clinic role
    expect(ctx.permissions.has("clinic.settings.manage")).toBe(true);
    expect(ctx.permissions.has("emr.read")).toBe(false); // admin authority ≠ medical access

    await updateClinicSettings(ctx, { name: "Synthetic Shifo Plus", defaultLocale: "ru", timezone: "Asia/Tashkent", contactEmail: "", contactPhone: "+998 90 000 00 00", address: "" }, META);
    await createBranch(ctx, { name: "Chilonzor", address: "", phone: "" }, META);
    const branches = await listBranches(ctx);
    expect(branches.map((b) => b.name)).toEqual(["Synthetic Shifo", "Chilonzor"]);

    const events = await listClinicAudit(ctx);
    const actions = events.map((e) => e.action);
    for (const a of ["tenant.created", "invitation.created", "invitation.accepted", "membership.created", "clinic.settings.updated", "branch.created"]) {
      expect(actions).toContain(a);
    }
  });

  it("resending rotates the token so the old link stops working", async () => {
    const actor = await platformActor();
    const r = await provisionClinic(actor, { name: "Synthetic Rotate", slug: uniq("rot"), contactEmail: "a@rot.test", defaultLocale: "en", timezone: "UTC", planCode: "starter", ownerFullName: "Synthetic Owner", ownerEmail: `${uniq("o")}@rot.test` }, META);
    const inv = await platformDb().invitation.findFirstOrThrow({ where: { tenantId: r.tenantId } });
    await resendInvitation(actor, inv.id, META);
    expect(await previewInvitation(r.inviteToken)).toEqual({ valid: false, reason: "not_found" });
  });

  it("expired invitations cannot be used", async () => {
    const actor = await platformActor();
    const r = await provisionClinic(actor, { name: "Synthetic Expired", slug: uniq("exp"), contactEmail: "a@exp.test", defaultLocale: "en", timezone: "UTC", planCode: "starter", ownerFullName: "Synthetic Owner", ownerEmail: `${uniq("o")}@exp.test` }, META);
    const owner = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await owner.connect();
    await owner.query(`UPDATE "Invitation" SET "expiresAt" = (now() AT TIME ZONE 'UTC') - interval '1 hour' WHERE "tenantId" = $1`, [r.tenantId]);
    await owner.end();
    expect(await previewInvitation(r.inviteToken)).toEqual({ valid: false, reason: "expired" });
    await expect(acceptInvitation(r.inviteToken, { fullName: "Synthetic Owner", password: PASSWORD, confirmPassword: PASSWORD }, META)).rejects.toThrow("errors.invitationExpired");
  });
});

describe("acceptance 6: clinic creates individual staff accounts", () => {
  it("owner invites a doctor who gets doctor permissions only", async () => {
    const actor = await platformActor();
    const { ctx, slug } = await clinicWithOwner(actor);
    const email = `${uniq("dr")}@clinic.test`;
    const inv = await inviteStaff(ctx, { fullName: "Synthetic Doctor", email, roleKeys: ["doctor"] }, META);
    await acceptInvitation(inv.token, { fullName: "Synthetic Doctor", password: PASSWORD, confirmPassword: PASSWORD }, META);
    const dr = await clinicContext(email, slug);
    expect(dr.roleKeys).toEqual(["doctor"]);
    expect(dr.permissions.has("emr.read")).toBe(true);
    expect(dr.permissions.has("staff.manage")).toBe(false);
    expect(dr.principal.mfaRequired).toBe(false);
    await expect(inviteStaff(dr, { fullName: "Someone Else", email: "x@clinic.test", roleKeys: ["receptionist"] }, META)).rejects.toThrow("errors.forbidden");
  });

  it("a clinic admin cannot grant the owner role", async () => {
    const actor = await platformActor();
    const { ctx, slug } = await clinicWithOwner(actor);
    const email = `${uniq("adm")}@clinic.test`;
    const inv = await inviteStaff(ctx, { fullName: "Synthetic Admin", email, roleKeys: ["clinic_admin"] }, META);
    await acceptInvitation(inv.token, { fullName: "Synthetic Admin", password: PASSWORD, confirmPassword: PASSWORD }, META);
    const admin = await clinicContext(email, slug);
    await expect(inviteStaff(admin, { fullName: "Would Be Owner", email: "w@clinic.test", roleKeys: ["clinic_owner"] }, META)).rejects.toThrow("errors.forbidden");
  });
});

describe("tenant lifecycle and feature flags", () => {
  it("suspension blocks clinic access immediately; reactivation restores it", async () => {
    const actor = await platformActor();
    const { tenantId, ownerEmail, slug } = await clinicWithOwner(actor);
    await expect(changeTenantStatus(actor, tenantId, "suspend", "short", META)).rejects.toThrow();
    await changeTenantStatus(actor, tenantId, "suspend", "Unpaid invoice for synthetic test period", META);

    const login = await loginClinicUser(ownerEmail, PASSWORD, META);
    if (!login.ok) throw new Error("login");
    const principal = await validateClinicSession(login.token);
    expect(await resolveClinic(principal!, slug)).toBeNull();

    await changeTenantStatus(actor, tenantId, "reactivate", undefined, META);
    const principal2 = await validateClinicSession(login.token);
    expect(await resolveClinic(principal2!, slug)).not.toBeNull();
    await expect(changeTenantStatus(actor, tenantId, "activate", undefined, META)).rejects.toThrow("errors.invalidTransition");
  });

  it("modules can be toggled, but the core module cannot be disabled", async () => {
    const actor = await platformActor();
    const { tenantId } = await clinicWithOwner(actor);
    await setTenantModule(actor, tenantId, "laboratory", false, META);
    await expect(setTenantModule(actor, tenantId, "core", false, META)).rejects.toThrow("errors.coreModule");
    await expect(setTenantModule(await platformActor("SUPPORT"), tenantId, "emr", false, META)).rejects.toThrow("errors.forbidden");
  });
});
