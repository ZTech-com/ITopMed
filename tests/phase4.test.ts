import { describe, expect, it } from "vitest";
import { loginClinicUser, resolveClinic, validateClinicSession } from "@/server/auth/clinic-auth";
import { addStaffMember, listBranches, listStaff } from "@/server/clinic/admin";
import { getMember, setMemberStatus, updateMemberAccess } from "@/server/clinic/members";
import { createRole, deleteRole, listRoles, updateRole } from "@/server/clinic/roles";
import { decideGrant, getActiveGrant, listGrantsForClinic, requestSupportAccess } from "@/server/support/access";
import { META, PASSWORD, clinicContext, clinicWithOwner, platformActor, uniq } from "./helpers/fixtures";

async function addStaff(owner: Awaited<ReturnType<typeof clinicWithOwner>>, roleKeys: string[]) {
  const login = uniq("staff");
  await addStaffMember(owner.ctx, { fullName: "Synthetic Staff", username: login, password: PASSWORD, roleKeys }, META);
  const ctx = await clinicContext(login, owner.slug);
  return { login, ctx };
}


describe("one login, one account", () => {
  it("a login taken in one clinic cannot be given again in another; members are not added twice", async () => {
    const actor = await platformActor();
    const a = await clinicWithOwner(actor);
    const b = await clinicWithOwner(actor);
    const doctor = await addStaff(a, ["doctor"]);
    await expect(addStaffMember(b.ctx, { fullName: "Synthetic Staff", username: doctor.login, password: PASSWORD, roleKeys: ["nurse"] }, META)).rejects.toThrow("errors.usernameTaken");
    await expect(addStaffMember(a.ctx, { fullName: "Again", username: doctor.login, password: PASSWORD, roleKeys: ["nurse"] }, META)).rejects.toThrow("errors.usernameTaken");
  });
});

describe("clinic sign-in lockout (regression)", () => {
  it("counts failures for existing accounts and locks after five", async () => {
    const actor = await platformActor();
    const a = await clinicWithOwner(actor);
    for (let i = 0; i < 5; i++) expect(await loginClinicUser(a.ownerLogin, "wrong-password-1", META)).toEqual({ ok: false, reason: "invalid" });
    expect(await loginClinicUser(a.ownerLogin, PASSWORD, META)).toEqual({ ok: false, reason: "locked" });
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

    // Staff can be added with the custom role; then it cannot be deleted.
    await addStaffMember(a.ctx, { fullName: "Synthetic Lead", username: uniq("lead"), password: PASSWORD, roleKeys: [custom.key] }, META);
    await expect(deleteRole(a.ctx, id, META)).rejects.toThrow("errors.roleInUse");
  });

  it("system role edits change the permissions members receive", async () => {
    const actor = await platformActor();
    const a = await clinicWithOwner(actor);
    const s = await addStaff(a, ["receptionist"]);
    expect(s.ctx.permissions.has("billing.read")).toBe(false);
    const rec = (await listRoles(a.ctx)).find((r) => r.key === "receptionist")!;
    await updateRole(a.ctx, rec.id, { permissions: [...rec.permissions.map((p) => p.permission), "billing.read"] }, META);
    const fresh = await clinicContext(s.login, a.slug);
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
    const m = staff.members.find((x) => x.user.username === s.login)!;
    expect((await getMember(a.ctx, m.id)).user.username).toBe(s.login);
    const branch = (await listBranches(a.ctx))[0]!;

    await updateMemberAccess(a.ctx, m.id, { roleIds: [nurse.id], allBranches: false, branchIds: [branch.id] }, META);
    const after = await clinicContext(s.login, a.slug);
    expect(after.roleKeys).toEqual(["nurse"]);
    expect(after.branchIds).toEqual([branch.id]);

    await setMemberStatus(a.ctx, m.id, "suspend", META);
    const p = await validateClinicSession((await loginClinicUser(s.login, PASSWORD, META) as { token: string }).token);
    expect(await resolveClinic(p!, a.slug)).toBeNull();
    await setMemberStatus(a.ctx, m.id, "reactivate", META);
    const fresh = await validateClinicSession((await loginClinicUser(s.login, PASSWORD, META) as { token: string }).token);
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
    const ownerM = staff.members.find((x) => x.user.username === a.ownerLogin)!;
    const adminM = staff.members.find((x) => x.user.username === admin.login)!;

    await expect(setMemberStatus(a.ctx, ownerM.id, "suspend", META)).rejects.toThrow("errors.selfChange");
    await expect(setMemberStatus(admin.ctx, ownerM.id, "suspend", META)).rejects.toThrow("errors.ownerOnly");
    await expect(updateMemberAccess(admin.ctx, adminM.id, { roleIds: [ownerRole.id], allBranches: true, branchIds: [] }, META)).rejects.toThrow("errors.selfChange");

    // Promote the admin to co-owner; then the original owner may be demoted, but not the last one.
    await updateMemberAccess(a.ctx, adminM.id, { roleIds: [ownerRole.id], allBranches: true, branchIds: [] }, META);
    const coOwner = await clinicContext(admin.login, a.slug);
    const doctorRole = roles.find((r) => r.key === "doctor")!;
    await updateMemberAccess(coOwner, ownerM.id, { roleIds: [doctorRole.id], allBranches: true, branchIds: [] }, META);
    const original = await clinicContext(a.ownerLogin, a.slug);
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
    expect(listed[0]).toMatchObject({ id, requesterName: support.user.fullName, status: "REQUESTED" });

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
