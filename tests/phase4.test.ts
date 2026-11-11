import pg from "pg";
import { describe, expect, it } from "vitest";
import { loginClinicUser, resolveClinic, validateClinicSession } from "@/server/auth/clinic-auth";
import { issuePasswordReset, isResetTokenValid, resetPassword } from "@/server/auth/password-reset";
import { inviteStaff, listBranches, listStaff } from "@/server/clinic/admin";
import { getMember, setMemberStatus, updateMemberAccess } from "@/server/clinic/members";
import { createRole, deleteRole, listRoles, updateRole } from "@/server/clinic/roles";
import { acceptInvitation, acceptInvitationAsExistingUser, previewInvitation } from "@/server/tenancy/invitations";
import { decideGrant, getActiveGrant, listGrantsForClinic, requestSupportAccess } from "@/server/support/access";
import { META, PASSWORD, clinicContext, clinicWithOwner, platformActor, uniq } from "./helpers/fixtures";

async function addStaff(owner: Awaited<ReturnType<typeof clinicWithOwner>>, roleKeys: string[]) {
  const email = `${uniq("staff")}@clinic.test`;
  const inv = await inviteStaff(owner.ctx, { fullName: "Synthetic Staff", email, roleKeys }, META);
  await acceptInvitation(inv.token, { fullName: "Synthetic Staff", password: PASSWORD, confirmPassword: PASSWORD }, META);
  const ctx = await clinicContext(email, owner.slug);
  return { email, ctx };
}

describe("existing accounts joining another clinic", () => {
  it("requires signing in as the invited email, then adds the membership", async () => {
    const actor = await platformActor();
    const a = await clinicWithOwner(actor);
    const b = await clinicWithOwner(actor);
    const doctor = await addStaff(a, ["doctor"]);

    const inv = await inviteStaff(b.ctx, { fullName: "Synthetic Staff", email: doctor.email, roleKeys: ["nurse"] }, META);
    expect(await previewInvitation(inv.token)).toMatchObject({ valid: true, accountExists: true });
    // New-account path refuses: the account must prove its identity.
    await expect(acceptInvitation(inv.token, { fullName: "X Y", password: PASSWORD, confirmPassword: PASSWORD }, META)).rejects.toThrow("errors.accountExistsSignIn");
    // Another signed-in user cannot take the invitation.
    await expect(acceptInvitationAsExistingUser(inv.token, a.ctx.principal, META)).rejects.toThrow("errors.wrongAccount");

    const r = await acceptInvitationAsExistingUser(inv.token, doctor.ctx.principal, META);
    expect(r.slug).toBe(b.slug);
    const p = await validateClinicSession((await loginClinicUser(doctor.email, PASSWORD, META) as { token: string }).token);
    expect(p!.clinics.map((c) => c.slug).sort()).toEqual([a.slug, b.slug].sort());
    const inB = await resolveClinic(p!, b.slug);
    expect(inB?.roleKeys).toEqual(["nurse"]); // roles are per clinic
    const inA = await resolveClinic(p!, a.slug);
    expect(inA?.roleKeys).toEqual(["doctor"]);
  });

  it("refuses to invite someone who is already an active member", async () => {
    const actor = await platformActor();
    const a = await clinicWithOwner(actor);
    const s = await addStaff(a, ["receptionist"]);
    await expect(inviteStaff(a.ctx, { fullName: "Again", email: s.email, roleKeys: ["nurse"] }, META)).rejects.toThrow("errors.alreadyMember");
  });
});

describe("clinic sign-in lockout (regression)", () => {
  it("counts failures for existing accounts and locks after five", async () => {
    const actor = await platformActor();
    const a = await clinicWithOwner(actor);
    for (let i = 0; i < 5; i++) expect(await loginClinicUser(a.ownerEmail, "wrong-password-1", META)).toEqual({ ok: false, reason: "invalid" });
    expect(await loginClinicUser(a.ownerEmail, PASSWORD, META)).toEqual({ ok: false, reason: "locked" });
  });
});

describe("password reset", () => {
  it("is single-use, expires, resets lockout and signs out every session", async () => {
    const actor = await platformActor();
    const a = await clinicWithOwner(actor);
    const s = await addStaff(a, ["receptionist"]);
    const before = await loginClinicUser(s.email, PASSWORD, META);
    if (!before.ok) throw new Error("login");

    expect(await issuePasswordReset("nobody@clinic.test", META)).toBeNull();
    const first = await issuePasswordReset(s.email, META);
    const second = await issuePasswordReset(s.email, META);
    expect(await isResetTokenValid(first!.token)).toBe(false); // superseded
    expect(await isResetTokenValid(second!.token)).toBe(true);

    const NEW = "Brand-New-Passw0rd-1";
    await expect(resetPassword(second!.token, { password: NEW, confirmPassword: "different-1234" }, META)).rejects.toThrow();
    await resetPassword(second!.token, { password: NEW, confirmPassword: NEW }, META);
    await expect(resetPassword(second!.token, { password: NEW, confirmPassword: NEW }, META)).rejects.toThrow("errors.resetInvalid");

    expect(await validateClinicSession(before.token)).toBeNull(); // old sessions revoked
    expect((await loginClinicUser(s.email, PASSWORD, META)).ok).toBe(false);
    expect((await loginClinicUser(s.email, NEW, META)).ok).toBe(true);
  });

  it("expired links do not work", async () => {
    const actor = await platformActor();
    const a = await clinicWithOwner(actor);
    const r = await issuePasswordReset(a.ownerEmail, META);
    const owner = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await owner.connect();
    await owner.query(`UPDATE "PasswordReset" SET "expiresAt" = (now() AT TIME ZONE 'UTC') - interval '1 minute' WHERE "usedAt" IS NULL`);
    await owner.end();
    expect(await isResetTokenValid(r!.token)).toBe(false);
  });
});

describe("roles and permissions editor", () => {
  it("creates, edits and deletes custom roles with guardrails", async () => {
    const actor = await platformActor();
    const a = await clinicWithOwner(actor);
    const id = await createRole(a.ctx, { name: "Front desk lead", permissions: ["patients.read", "appointments.manage"] }, META);
    await expect(createRole(a.ctx, { name: "front DESK lead", permissions: [] }, META)).rejects.toThrow("errors.roleNameTaken");
    await expect(createRole(a.ctx, { name: "Bad", permissions: ["root.everything"] }, META)).rejects.toThrow();

    await updateRole(a.ctx, id, { name: "Front desk lead", permissions: ["patients.read", "queue.manage"] }, META);
    const roles = await listRoles(a.ctx);
    const custom = roles.find((r) => r.id === id)!;
    expect(custom.permissions.map((p) => p.permission).sort()).toEqual(["patients.read", "queue.manage"]);

    const ownerRole = roles.find((r) => r.key === "clinic_owner")!;
    await expect(updateRole(a.ctx, ownerRole.id, { permissions: [] }, META)).rejects.toThrow("errors.roleLocked");
    await expect(deleteRole(a.ctx, ownerRole.id, META)).rejects.toThrow("errors.roleLocked");

    // Staff can be invited with the custom role; then it cannot be deleted.
    const inv = await inviteStaff(a.ctx, { fullName: "Synthetic Lead", email: `${uniq("lead")}@clinic.test`, roleKeys: [custom.key] }, META);
    await acceptInvitation(inv.token, { fullName: "Synthetic Lead", password: PASSWORD, confirmPassword: PASSWORD }, META);
    await expect(deleteRole(a.ctx, id, META)).rejects.toThrow("errors.roleInUse");
  });

  it("system role edits change the permissions members receive", async () => {
    const actor = await platformActor();
    const a = await clinicWithOwner(actor);
    const s = await addStaff(a, ["receptionist"]);
    expect(s.ctx.permissions.has("billing.read")).toBe(false);
    const rec = (await listRoles(a.ctx)).find((r) => r.key === "receptionist")!;
    await updateRole(a.ctx, rec.id, { permissions: [...rec.permissions.map((p) => p.permission), "billing.read"] }, META);
    const fresh = await clinicContext(s.email, a.slug);
    expect(fresh.permissions.has("billing.read")).toBe(true);
  });

  it("only role managers may edit roles", async () => {
    const actor = await platformActor();
    const a = await clinicWithOwner(actor);
    const s = await addStaff(a, ["clinic_admin"]);
    await expect(createRole(s.ctx, { name: "Sneaky", permissions: ["emr.read_all"] }, META)).rejects.toThrow("errors.forbidden");
  });
});

describe("member management", () => {
  it("changes roles and branch scope; suspension blocks access immediately", async () => {
    const actor = await platformActor();
    const a = await clinicWithOwner(actor);
    const s = await addStaff(a, ["receptionist"]);
    const roles = await listRoles(a.ctx);
    const nurse = roles.find((r) => r.key === "nurse")!;
    const staff = await listStaff(a.ctx);
    const m = staff.members.find((x) => x.user.email === s.email)!;
    expect((await getMember(a.ctx, m.id)).user.email).toBe(s.email);
    const branch = (await listBranches(a.ctx))[0]!;

    await updateMemberAccess(a.ctx, m.id, { roleIds: [nurse.id], allBranches: false, branchIds: [branch.id] }, META);
    const after = await clinicContext(s.email, a.slug);
    expect(after.roleKeys).toEqual(["nurse"]);
    expect(after.branchIds).toEqual([branch.id]);

    await setMemberStatus(a.ctx, m.id, "suspend", META);
    const p = await validateClinicSession((await loginClinicUser(s.email, PASSWORD, META) as { token: string }).token);
    expect(await resolveClinic(p!, a.slug)).toBeNull();
    await setMemberStatus(a.ctx, m.id, "reactivate", META);
    const fresh = await validateClinicSession((await loginClinicUser(s.email, PASSWORD, META) as { token: string }).token);
    expect(await resolveClinic(fresh!, a.slug)).not.toBeNull();
    await setMemberStatus(a.ctx, m.id, "remove", META);
    expect(await resolveClinic(fresh!, a.slug)).toBeNull();
  });

  it("protects owners, the last owner, and the caller's own access", async () => {
    const actor = await platformActor();
    const a = await clinicWithOwner(actor);
    const admin = await addStaff(a, ["clinic_admin"]);
    const roles = await listRoles(a.ctx);
    const ownerRole = roles.find((r) => r.key === "clinic_owner")!;
    const staff = await listStaff(a.ctx);
    const ownerM = staff.members.find((x) => x.user.email === a.ownerEmail)!;
    const adminM = staff.members.find((x) => x.user.email === admin.email)!;

    await expect(setMemberStatus(a.ctx, ownerM.id, "suspend", META)).rejects.toThrow("errors.selfChange");
    await expect(setMemberStatus(admin.ctx, ownerM.id, "suspend", META)).rejects.toThrow("errors.ownerOnly");
    await expect(updateMemberAccess(admin.ctx, adminM.id, { roleIds: [ownerRole.id], allBranches: true, branchIds: [] }, META)).rejects.toThrow("errors.selfChange");

    // Promote the admin to co-owner; then the original owner may be demoted, but not the last one.
    await updateMemberAccess(a.ctx, adminM.id, { roleIds: [ownerRole.id], allBranches: true, branchIds: [] }, META);
    const coOwner = await clinicContext(admin.email, a.slug);
    const doctorRole = roles.find((r) => r.key === "doctor")!;
    await updateMemberAccess(coOwner, ownerM.id, { roleIds: [doctorRole.id], allBranches: true, branchIds: [] }, META);
    const original = await clinicContext(a.ownerEmail, a.slug);
    expect(original.roleKeys).toEqual(["doctor"]);
  });

  it("cannot read or change members of another clinic", async () => {
    const actor = await platformActor();
    const a = await clinicWithOwner(actor);
    const b = await clinicWithOwner(actor);
    const bm = (await listStaff(b.ctx)).members[0]!;
    await expect(getMember(a.ctx, bm.id)).rejects.toThrow("errors.notFound");
    await expect(setMemberStatus(a.ctx, bm.id, "suspend", META)).rejects.toThrow("errors.notFound");
  });
});

describe("break-glass support access", () => {
  it("platform requests, clinic decides, access is time-boxed and revocable", async () => {
    const actor = await platformActor();
    const support = await platformActor("SUPPORT");
    const a = await clinicWithOwner(actor);

    await expect(requestSupportAccess(support, a.tenantId, { scope: "CLINICAL_READ", durationMinutes: 30, reason: "Investigating a synthetic issue" }, META)).rejects.toThrow("errors.clinicalAccessDisabled");
    await expect(requestSupportAccess(await platformActor("BILLING"), a.tenantId, { scope: "CONFIGURATION", durationMinutes: 30, reason: "Investigating a synthetic issue" }, META)).rejects.toThrow("errors.forbidden");
    await expect(requestSupportAccess(support, a.tenantId, { scope: "CONFIGURATION", durationMinutes: 999, reason: "Investigating a synthetic issue" }, META)).rejects.toThrow();

    const id = await requestSupportAccess(support, a.tenantId, { scope: "OPERATIONAL", durationMinutes: 30, reason: "Investigating a synthetic issue", ticketRef: "SUP-1" }, META);
    expect(await getActiveGrant(support.user.id, a.tenantId, "CONFIGURATION")).toBeNull();

    const listed = await listGrantsForClinic(a.ctx);
    expect(listed[0]).toMatchObject({ id, requesterEmail: support.user.email, status: "REQUESTED" });

    const s = await addStaff(a, ["clinic_admin"]);
    await expect(decideGrant(s.ctx, id, "approve", META)).rejects.toThrow("errors.forbidden");

    await decideGrant(a.ctx, id, "approve", META);
    await expect(decideGrant(a.ctx, id, "approve", META)).rejects.toThrow("errors.grantNotPending");
    const active = await getActiveGrant(support.user.id, a.tenantId, "CONFIGURATION");
    expect(active?.id).toBe(id);
    expect(active!.expiresAt!.getTime() - active!.startsAt!.getTime()).toBe(30 * 60_000);

    await decideGrant(a.ctx, id, "revoke", META);
    expect(await getActiveGrant(support.user.id, a.tenantId, "OPERATIONAL")).toBeNull();
  });
});
