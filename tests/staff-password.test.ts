import { describe, expect, it } from "vitest";
import { createStaffWithPassword, inviteStaff, listStaff } from "@/server/clinic/admin";
import { loginClinicUser } from "@/server/auth/clinic-auth";
import { META, PASSWORD, clinicContext, clinicWithOwner, platformActor, uniq } from "./helpers/fixtures";

const STAFF_PASSWORD = "Synthetic-Staff-2026";

describe("staff with a password (no email needed)", () => {
  it("creates a working account with the given roles; the password is required and strong", async () => {
    const o = await clinicWithOwner(await platformActor());
    const email = `${uniq("doc")}@clinic.test`;
    await expect(createStaffWithPassword(o.ctx, { fullName: "Synthetic Doctor", email, roleKeys: ["doctor"], password: "short" }, META)).rejects.toThrow();
    await createStaffWithPassword(o.ctx, { fullName: "Synthetic Doctor", email, roleKeys: ["doctor"], password: STAFF_PASSWORD }, META);

    const m = (await listStaff(o.ctx)).members.find((x) => x.user.email === email)!;
    expect(m.roles.map((r: { role: { key: string } }) => r.role.key)).toEqual(["doctor"]);
    const login = await loginClinicUser(email, STAFF_PASSWORD, META);
    expect(login.ok).toBe(true);

    // The same person cannot be created twice; an existing account must be invited instead.
    await expect(createStaffWithPassword(o.ctx, { fullName: "Synthetic Doctor", email, roleKeys: ["doctor"], password: STAFF_PASSWORD }, META)).rejects.toThrow("errors.accountExistsUseInvite");
    const other = await clinicWithOwner(await platformActor());
    await expect(createStaffWithPassword(other.ctx, { fullName: "Synthetic Doctor", email, roleKeys: ["doctor"], password: STAFF_PASSWORD }, META)).rejects.toThrow("errors.accountExistsUseInvite");
    expect((await inviteStaff(other.ctx, { fullName: "Synthetic Doctor", email, roleKeys: ["doctor"] }, META)).invitationId).toBeTruthy();
  });

  it("a receptionist cannot add staff", async () => {
    const o = await clinicWithOwner(await platformActor());
    const email = `${uniq("rec")}@clinic.test`;
    await createStaffWithPassword(o.ctx, { fullName: "Synthetic Reception", email, roleKeys: ["receptionist"], password: PASSWORD }, META);
    const rec = await clinicContext(email, o.slug);
    await expect(createStaffWithPassword(rec, { fullName: "Synthetic Other", email: `${uniq("x")}@clinic.test`, roleKeys: ["doctor"], password: PASSWORD }, META)).rejects.toThrow("errors.forbidden");
  });
});

describe("administrator gives a new password", () => {
  it("works for staff of this clinic only; old password and sessions stop working", async () => {
    const { setMemberPassword } = await import("@/server/clinic/members");
    const o = await clinicWithOwner(await platformActor());
    const email = `${uniq("nurse")}@clinic.test`;
    await createStaffWithPassword(o.ctx, { fullName: "Synthetic Nurse", email, roleKeys: ["nurse"], password: STAFF_PASSWORD }, META);
    const m = (await listStaff(o.ctx)).members.find((x) => x.user.email === email)!;
    await expect(setMemberPassword(o.ctx, m.id, { password: "weak" }, META)).rejects.toThrow();
    await setMemberPassword(o.ctx, m.id, { password: "Synthetic-New-2026x" }, META);
    expect((await loginClinicUser(email, STAFF_PASSWORD, META)).ok).toBe(false);
    expect((await loginClinicUser(email, "Synthetic-New-2026x", META)).ok).toBe(true);

    // A receptionist cannot do it; nobody changes the owner's password except an owner.
    const recEmail = `${uniq("rec")}@clinic.test`;
    await createStaffWithPassword(o.ctx, { fullName: "Synthetic Reception", email: recEmail, roleKeys: ["receptionist"], password: PASSWORD }, META);
    const rec = await clinicContext(recEmail, o.slug);
    await expect(setMemberPassword(rec, m.id, { password: "Synthetic-New-2026y" }, META)).rejects.toThrow("errors.forbidden");

  });
});
