import { describe, expect, it } from "vitest";
import { addStaffMember, listStaff } from "@/server/clinic/admin";
import { loginClinicUser } from "@/server/auth/clinic-auth";
import { META, PASSWORD, clinicContext, clinicWithOwner, platformActor, uniq } from "./helpers/fixtures";

const STAFF_PASSWORD = "Synthetic-Staff-2026";

describe("staff accounts: login + password (no email anywhere)", () => {
  it("creates a working account with the given roles; login and a strong password are required", async () => {
    const o = await clinicWithOwner(await platformActor());
    const login = uniq("doc");
    await expect(addStaffMember(o.ctx, { fullName: "Synthetic Doctor", username: login, roleKeys: ["doctor"], password: "short" }, META)).rejects.toThrow();
    await expect(addStaffMember(o.ctx, { fullName: "Synthetic Doctor", roleKeys: ["doctor"], password: STAFF_PASSWORD }, META)).rejects.toThrow();
    await addStaffMember(o.ctx, { fullName: "Synthetic Doctor", username: login, roleKeys: ["doctor"], password: STAFF_PASSWORD }, META);

    const m = (await listStaff(o.ctx)).members.find((x) => x.user.username === login)!;
    expect(m.roles.map((r: { role: { key: string } }) => r.role.key)).toEqual(["doctor"]);
    expect((await loginClinicUser(login, STAFF_PASSWORD, META)).ok).toBe(true);

    // The same login cannot be given twice, in this clinic or another.
    await expect(addStaffMember(o.ctx, { fullName: "Synthetic Doctor", username: login, roleKeys: ["doctor"], password: STAFF_PASSWORD }, META)).rejects.toThrow("errors.usernameTaken");
    const other = await clinicWithOwner(await platformActor());
    await expect(addStaffMember(other.ctx, { fullName: "Synthetic Doctor", username: login, roleKeys: ["doctor"], password: STAFF_PASSWORD }, META)).rejects.toThrow("errors.usernameTaken");
  });

  it("a receptionist cannot add staff", async () => {
    const o = await clinicWithOwner(await platformActor());
    const login = uniq("rec");
    await addStaffMember(o.ctx, { fullName: "Synthetic Reception", username: login, roleKeys: ["receptionist"], password: PASSWORD }, META);
    const rec = await clinicContext(login, o.slug);
    await expect(addStaffMember(rec, { fullName: "Synthetic Other", username: uniq("x"), roleKeys: ["doctor"], password: PASSWORD }, META)).rejects.toThrow("errors.forbidden");
  });
});

describe("administrator gives a new password", () => {
  it("works for staff of this clinic only; old password and sessions stop working", async () => {
    const { setMemberPassword } = await import("@/server/clinic/members");
    const o = await clinicWithOwner(await platformActor());
    const login = uniq("nurse");
    await addStaffMember(o.ctx, { fullName: "Synthetic Nurse", username: login, roleKeys: ["nurse"], password: STAFF_PASSWORD }, META);
    const m = (await listStaff(o.ctx)).members.find((x) => x.user.username === login)!;
    await expect(setMemberPassword(o.ctx, m.id, { password: "weak" }, META)).rejects.toThrow();
    await setMemberPassword(o.ctx, m.id, { password: "Synthetic-New-2026x" }, META);
    expect((await loginClinicUser(login, STAFF_PASSWORD, META)).ok).toBe(false);
    expect((await loginClinicUser(login, "Synthetic-New-2026x", META)).ok).toBe(true);

    // A receptionist cannot do it; nobody changes the owner's password except an owner.
    const recLogin = uniq("rec");
    await addStaffMember(o.ctx, { fullName: "Synthetic Reception", username: recLogin, roleKeys: ["receptionist"], password: PASSWORD }, META);
    const rec = await clinicContext(recLogin, o.slug);
    await expect(setMemberPassword(rec, m.id, { password: "Synthetic-New-2026y" }, META)).rejects.toThrow("errors.forbidden");
  });
});
