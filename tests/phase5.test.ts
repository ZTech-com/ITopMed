import { describe, expect, it } from "vitest";
import { createBranch, addStaffMember, listBranches, listStaff } from "@/server/clinic/admin";
import { updateMemberAccess } from "@/server/clinic/members";
import {
  addScheduleBlock,
  addScheduleException,
  doctorSlots,
  doctorsWorkingOn,
  getDoctorDetail,
  getMyDoctorProfileId,
  listDoctors,
  removeScheduleBlock,
  saveDoctorProfile,
  setDoctorServices,
} from "@/server/clinic/doctors";
import { archiveRoom, createDepartment, createRoom, createService, listRooms, listServices, updateService } from "@/server/clinic/resources";
import { listRoles } from "@/server/clinic/roles";
import { META, PASSWORD, clinicContext, clinicWithOwner, platformActor, uniq } from "./helpers/fixtures";

async function staff(owner: Awaited<ReturnType<typeof clinicWithOwner>>, roleKeys: string[]) {
  const login = uniq("s");
  await addStaffMember(owner.ctx, { fullName: "Synthetic Person", username: login, roleKeys, password: PASSWORD }, META);
  const members = await listStaff(owner.ctx);
  return { login, membershipId: members.members.find((m) => m.user.username === login)!.id, ctx: await clinicContext(login, owner.slug) };
}

// 2030-01-07 is a Monday.
const MONDAY = "2030-01-07";

describe("services and prices", () => {
  it("creates services with exact money, rejects bad input and duplicate codes, audits price changes", async () => {
    const a = await clinicWithOwner(await platformActor());
    const dep = await createDepartment(a.ctx, { name: "Terapiya", branchId: "" }, META);
    const id = await createService(a.ctx, { code: "cons-01", name: "Terapevt konsultatsiyasi", kind: "CONSULTATION", departmentId: dep, durationMinutes: "20", price: "150 000", currency: "UZS" }, META);
    await expect(createService(a.ctx, { code: "CONS-01", name: "Dup", kind: "OTHER", durationMinutes: 20, price: "1", currency: "UZS" }, META)).rejects.toThrow("errors.codeTaken");
    await expect(createService(a.ctx, { code: "X1", name: "Bad price", kind: "OTHER", durationMinutes: 20, price: "-5", currency: "UZS" }, META)).rejects.toThrow();
    await updateService(a.ctx, id, { code: "CONS-01", name: "Terapevt konsultatsiyasi", kind: "CONSULTATION", departmentId: dep, durationMinutes: 30, price: "175000,50", currency: "UZS" }, META);
    const [s] = await listServices(a.ctx);
    expect(s!.code).toBe("CONS-01");
    expect(s!.priceMinor).toBe(17_500_050n);
    expect(s!.durationMinutes).toBe(30);
  });

  it("receptionists and triage nurses read services (to bill ordered tests) but cannot change them or take money", async () => {
    const a = await clinicWithOwner(await platformActor());
    await createService(a.ctx, { code: "LAB-1", name: "Qon tahlili", kind: "LAB_TEST", durationMinutes: 10, price: "50000", currency: "UZS" }, META);
    const rec = await staff(a, ["receptionist"]);
    expect(await listServices(rec.ctx)).toHaveLength(1);
    await expect(createService(rec.ctx, { code: "LAB-2", name: "X", kind: "OTHER", durationMinutes: 10, price: "1", currency: "UZS" }, META)).rejects.toThrow("errors.forbidden");
    const nurse = await staff(a, ["nurse"]);
    expect(await listServices(nurse.ctx)).toHaveLength(1);
    await expect(createService(nurse.ctx, { code: "LAB-3", name: "Y", kind: "OTHER", durationMinutes: 10, price: "1", currency: "UZS" }, META)).rejects.toThrow("errors.forbidden");
    expect(nurse.ctx.permissions.has("billing.payment")).toBe(false);
  });
});

describe("doctor profiles and schedules", () => {
  it("builds a weekly schedule, prevents double-booking the doctor, honours exceptions", async () => {
    const a = await clinicWithOwner(await platformActor());
    const [main] = await listBranches(a.ctx);
    const second = await createBranch(a.ctx, { name: "Yunusobod", address: "", phone: "" }, META);
    const room = await createRoom(a.ctx, { name: "101", branchId: main!.id, kind: "CONSULTATION" }, META);
    const dr = await staff(a, ["doctor"]);

    const nurse = await staff(a, ["nurse"]);
    await expect(saveDoctorProfile(a.ctx, nurse.membershipId, { specialty: "therapy", defaultSlotMinutes: 20, acceptsOnlineBooking: false }, META)).rejects.toThrow("errors.notADoctor");
    const profileId = await saveDoctorProfile(a.ctx, dr.membershipId, { specialty: "cardiology", licenseNumber: "SYN-0001", defaultSlotMinutes: 30, acceptsOnlineBooking: true }, META);

    await addScheduleBlock(a.ctx, profileId, { weekday: 1, start: "09:00", end: "12:00", branchId: main!.id, roomId: room }, META);
    // Same time at another branch would put the doctor in two places.
    await expect(addScheduleBlock(a.ctx, profileId, { weekday: 1, start: "11:00", end: "13:00", branchId: second, roomId: "" }, META)).rejects.toThrow("errors.scheduleOverlap");
    await addScheduleBlock(a.ctx, profileId, { weekday: 1, start: "14:00", end: "16:00", branchId: second, roomId: "" }, META);
    await expect(addScheduleBlock(a.ctx, profileId, { weekday: 1, start: "17:00", end: "16:00", branchId: second, roomId: "" }, META)).rejects.toThrow();
    // A room of another branch cannot be used.
    await expect(addScheduleBlock(a.ctx, profileId, { weekday: 2, start: "09:00", end: "10:00", branchId: second, roomId: room }, META)).rejects.toThrow("errors.roomNotInBranch");

    const slots = await doctorSlots(a.ctx, profileId, MONDAY, { includePast: true });
    expect(slots).toHaveLength(6 + 4);
    expect(slots[0]!.start.toISOString()).toBe("2030-01-07T04:00:00.000Z"); // 09:00 Tashkent

    const working = await doctorsWorkingOn(a.ctx, MONDAY);
    expect(working).toHaveLength(1);
    expect(working[0]!.blocks.map((b) => b.branchName)).toEqual([main!.name, "Yunusobod"]);

    await addScheduleException(a.ctx, profileId, { date: MONDAY, kind: "VACATION" }, META);
    await expect(addScheduleException(a.ctx, profileId, { date: MONDAY, kind: "DAY_OFF" }, META)).rejects.toThrow("errors.exceptionExists");
    expect(await doctorSlots(a.ctx, profileId, MONDAY)).toEqual([]);
    expect(await doctorsWorkingOn(a.ctx, MONDAY)).toEqual([]);
    expect(await doctorSlots(a.ctx, profileId, "2030-01-14")).toHaveLength(10);

    // The doctor sees their own schedule without schedule permissions.
    expect(dr.ctx.permissions.has("schedules.read")).toBe(false);
    expect(await getMyDoctorProfileId(dr.ctx)).toBe(profileId);
    const own = await getDoctorDetail(dr.ctx, profileId);
    expect(own.schedules).toHaveLength(2);
    await expect(listDoctors(dr.ctx)).rejects.toThrow("errors.forbidden");
    await expect(addScheduleBlock(dr.ctx, profileId, { weekday: 3, start: "09:00", end: "10:00", branchId: main!.id }, META)).rejects.toThrow("errors.forbidden");

    // Archiving a room detaches it from schedules.
    await archiveRoom(a.ctx, room, META);
    const after = await getDoctorDetail(a.ctx, profileId);
    expect(after.schedules.every((s) => s.roomId === null)).toBe(true);
  });

  it("links doctors to services they provide", async () => {
    const a = await clinicWithOwner(await platformActor());
    const svc = await createService(a.ctx, { code: "ECG", name: "EKG", kind: "PROCEDURE", durationMinutes: 15, price: "80000", currency: "UZS" }, META);
    const dr = await staff(a, ["doctor"]);
    const profileId = await saveDoctorProfile(a.ctx, dr.membershipId, { specialty: "cardiology", defaultSlotMinutes: 20, acceptsOnlineBooking: false }, META);
    await setDoctorServices(a.ctx, profileId, [svc], META);
    expect((await getDoctorDetail(a.ctx, profileId)).serviceIds).toEqual([svc]);
    await expect(setDoctorServices(a.ctx, profileId, ["00000000-0000-7000-8000-000000000000"], META)).rejects.toThrow("errors.invalidInput");
  });
});

describe("branch scope (ABAC)", () => {
  it("a branch manager only sees and edits resources of assigned branches", async () => {
    const a = await clinicWithOwner(await platformActor());
    const [main] = await listBranches(a.ctx);
    const second = await createBranch(a.ctx, { name: "Sergeli", address: "", phone: "" }, META);
    const roomMain = await createRoom(a.ctx, { name: "M-1", branchId: main!.id, kind: "CONSULTATION" }, META);
    await createRoom(a.ctx, { name: "S-1", branchId: second, kind: "CONSULTATION" }, META);
    const dr = await staff(a, ["doctor"]);
    const profileId = await saveDoctorProfile(a.ctx, dr.membershipId, { specialty: "therapy", defaultSlotMinutes: 20, acceptsOnlineBooking: false }, META);
    const mainBlock = await addScheduleBlock(a.ctx, profileId, { weekday: 1, start: "09:00", end: "10:00", branchId: main!.id }, META);
    await addScheduleBlock(a.ctx, profileId, { weekday: 1, start: "14:00", end: "15:00", branchId: second }, META);

    const mgr = await staff(a, ["branch_manager"]);
    const roles = await listRoles(a.ctx);
    await updateMemberAccess(a.ctx, mgr.membershipId, { roleIds: [roles.find((r) => r.key === "branch_manager")!.id], allBranches: false, branchIds: [second] }, META);
    const scoped = await clinicContext(mgr.login, a.slug);
    expect(scoped.branchIds).toEqual([second]);

    expect((await listRooms(scoped)).map((r) => r.name)).toEqual(["S-1"]);
    await expect(createRoom(scoped, { name: "M-2", branchId: main!.id, kind: "OTHER" }, META)).rejects.toThrow("errors.forbidden"); // branch managers lack clinic.branches.manage
    await expect(addScheduleBlock(scoped, profileId, { weekday: 2, start: "09:00", end: "10:00", branchId: main!.id }, META)).rejects.toThrow("errors.branchScope");
    await addScheduleBlock(scoped, profileId, { weekday: 2, start: "09:00", end: "10:00", branchId: second }, META);
    await expect(removeScheduleBlock(scoped, mainBlock, META)).rejects.toThrow("errors.branchScope");
    await expect(archiveRoom(scoped, roomMain, META)).rejects.toThrow("errors.forbidden");

    const working = await doctorsWorkingOn(scoped, MONDAY);
    expect(working[0]!.blocks.map((b) => b.branchName)).toEqual(["Sergeli"]);
    const detail = await getDoctorDetail(scoped, profileId);
    expect(detail.schedules.every((s) => s.branchId === second)).toBe(true);
  });
});

describe("existing clinics received the new permissions", () => {
  it("standard roles include scheduling and service permissions", async () => {
    const a = await clinicWithOwner(await platformActor());
    const roles = await listRoles(a.ctx);
    const perms = (key: string) => roles.find((r) => r.key === key)!.permissions.map((p) => p.permission);
    expect(perms("receptionist")).toEqual(expect.arrayContaining(["schedules.read", "services.read"]));
    expect(perms("clinic_admin")).toEqual(expect.arrayContaining(["schedules.manage", "services.manage"]));
    expect(perms("doctor")).not.toContain("schedules.read");
  });
});
