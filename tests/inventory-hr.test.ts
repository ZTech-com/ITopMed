import pg from "pg";
import { describe, expect, it } from "vitest";
import { bookAppointment } from "@/server/appointments/appointments";
import { addStaffMember, listBranches, listStaff } from "@/server/clinic/admin";
import { addScheduleBlock, doctorSlots, saveDoctorProfile } from "@/server/clinic/doctors";
import { createDepartment } from "@/server/clinic/resources";
import { addCredential, archiveCredential, cancelLeave, getStaffHr, hrAlerts, listStaffHr, recordLeave, saveStaffProfile } from "@/server/hr/hr";
import {
  archiveItem,
  createItem,
  createSupplier,
  getItem,
  inventoryAlerts,
  issueStock,
  listInventory,
  receiveStock,
  recordCount,
  writeOffStock,
} from "@/server/inventory/inventory";
import { registerPatient } from "@/server/patients/patients";
import { addDays, localToInstant, todayIn } from "@/server/scheduling/time";
import { META, PASSWORD, clinicContext, clinicWithOwner, platformActor, uniq } from "./helpers/fixtures";

const TZ = "Asia/Tashkent";
const day = (n: number) => addDays(todayIn(TZ), n);

async function staff(o: Awaited<ReturnType<typeof clinicWithOwner>>, roleKeys: string[]) {
  const login = uniq("s");
  await addStaffMember(o.ctx, { fullName: `Synthetic ${roleKeys[0]}`, username: login, roleKeys, password: PASSWORD }, META);
  const m = (await listStaff(o.ctx)).members.find((x) => x.user.username === login)!;
  return { login, membershipId: m.id, ctx: await clinicContext(login, o.slug) };
}

async function setup() {
  const a = await clinicWithOwner(await platformActor());
  const [branch] = await listBranches(a.ctx);
  const pharmacist = await staff(a, ["pharmacist"]);
  const hr = await staff(a, ["hr_manager"]);
  const reception = await staff(a, ["receptionist"]);
  const doctor = await staff(a, ["doctor"]);
  return { a, branch: branch!, pharmacist, hr, reception, doctor };
}

/** Inserts an already-expired batch directly (the app refuses to receive expired stock). */
async function expiredBatch(tenantId: string, itemId: string, branchId: string, userId: string, quantity: number) {
  const c = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await c.connect();
  const id = crypto.randomUUID();
  await c.query(`INSERT INTO "StockBatch" (id, "tenantId", "itemId", "branchId", "lotNumber", "expiresOn") VALUES ($1, $2, $3, $4, 'OLD-1', $5::date)`, [id, tenantId, itemId, branchId, day(-10)]);
  await c.query(`INSERT INTO "StockMovement" (id, "tenantId", "batchId", "itemId", "branchId", kind, quantity, "createdById") VALUES ($1, $2, $3, $4, $5, 'RECEIPT', $6, $7)`, [
    crypto.randomUUID(),
    tenantId,
    id,
    itemId,
    branchId,
    quantity,
    userId,
  ]);
  await c.end();
  return id;
}

describe("inventory: stock ledger", () => {
  it("receive → FEFO issue/dispense → write-off → count; expired and negative stock refused", async () => {
    const s = await setup();
    const ph = s.pharmacist.ctx;
    const itemId = await createItem(ph, { code: "PARA500", name: "Paracetamol (synthetic)", category: "MEDICINE", form: "tablet", strength: "500 mg", unit: "tablet", minStock: "50" }, META);
    await expect(createItem(ph, { code: "PARA500", name: "Duplicate", category: "MEDICINE", unit: "tablet" }, META)).rejects.toThrow("errors.codeTaken");
    const supplierId = await createSupplier(ph, { name: "Synthetic Pharma LLC", taxId: "123456789", phone: "" }, META);
    await expect(receiveStock(ph, itemId, { branchId: s.branch.id, lotNumber: "X", expiresOn: day(-1), quantity: "10" }, META)).rejects.toThrow("errors.receiveExpired");

    const late = await receiveStock(ph, itemId, { branchId: s.branch.id, lotNumber: "LATE", expiresOn: day(300), quantity: "30", unitCost: "1 200", supplierId, documentRef: "WB-1" }, META);
    const early = await receiveStock(ph, itemId, { branchId: s.branch.id, lotNumber: "EARLY", expiresOn: day(20), quantity: "20" }, META);
    await expiredBatch(s.a.tenantId, itemId, s.branch.id, s.pharmacist.ctx.principal.user.id, 99);

    let inv = (await listInventory(ph, { branchId: s.branch.id })).find((i) => i.id === itemId)!;
    expect([inv.onHand, inv.expired, inv.low, inv.expiringSoon]).toEqual([50, 99, false, true]); // expired stock never counts as available

    // FEFO: the 25 units come from EARLY (20) first, then LATE (5) — never from the expired lot.
    const p = await registerPatient(s.reception.ctx, { lastName: "Sintetik", firstName: "Dorixona", birthDate: "1990-01-01", sex: "MALE" }, { confirmNotDuplicate: true }, META);
    if (!p.ok) throw new Error("patient");
    expect(await issueStock(ph, itemId, { branchId: s.branch.id, quantity: "25", kind: "DISPENSE", patientMrn: p.mrn.toLowerCase() }, META)).toEqual({ batches: 2 });
    let detail = (await getItem(ph, itemId))!;
    const qty = (id: string) => detail.batches.find((b) => b.id === id)?.quantity;
    expect([qty(early), qty(late)]).toEqual([0, 25]);
    expect(detail.movements.filter((m) => m.kind === "DISPENSE").every((m) => m.patient?.mrn === p.mrn)).toBe(true);

    await expect(issueStock(ph, itemId, { branchId: s.branch.id, quantity: "26", kind: "ISSUE" }, META)).rejects.toThrow("errors.insufficientStock");
    await expect(issueStock(ph, itemId, { branchId: s.branch.id, quantity: "1", kind: "DISPENSE" }, META)).rejects.toThrow(); // patient required
    await expect(issueStock(ph, itemId, { branchId: s.branch.id, quantity: "1", kind: "DISPENSE", patientMrn: "P-999999" }, META)).rejects.toThrow("errors.patientNotFound");
    const dep = await createDepartment(s.a.ctx, { name: "Synthetic ward", branchId: "" }, META);
    await issueStock(ph, itemId, { branchId: s.branch.id, quantity: "5", kind: "ISSUE", departmentId: dep }, META);

    await expect(writeOffStock(ph, late, { quantity: "21", reason: "DAMAGED" }, META)).rejects.toThrow("errors.insufficientStock");
    await writeOffStock(ph, late, { quantity: "2", reason: "DAMAGED" }, META);
    expect(await recordCount(ph, late, { counted: "17" }, META)).toEqual({ delta: -1 });
    expect(await recordCount(ph, late, { counted: "17" }, META)).toEqual({ delta: 0 });
    inv = (await listInventory(ph, { branchId: s.branch.id })).find((i) => i.id === itemId)!;
    expect([inv.onHand, inv.low]).toEqual([17, true]);
    expect((await inventoryAlerts(ph)).low.map((i) => i.id)).toContain(itemId);

    await expect(archiveItem(ph, itemId, META)).rejects.toThrow("errors.itemHasStock");
    detail = (await getItem(ph, itemId))!;
    expect(detail.movements.map((m) => m.kind).sort()).toEqual(["ADJUSTMENT", "DISPENSE", "DISPENSE", "ISSUE", "RECEIPT", "RECEIPT", "RECEIPT", "WRITE_OFF"]);
  });

  it("the database guards the ledger even against direct SQL", async () => {
    const s = await setup();
    const itemId = await createItem(s.pharmacist.ctx, { code: "SYR5", name: "Syringe 5 ml (synthetic)", category: "CONSUMABLE", unit: "pcs" }, META);
    const batchId = await receiveStock(s.pharmacist.ctx, itemId, { branchId: s.branch.id, lotNumber: "S1", quantity: "10" }, META);
    const expired = await expiredBatch(s.a.tenantId, itemId, s.branch.id, s.pharmacist.ctx.principal.user.id, 5);
    const app = new pg.Client({ connectionString: process.env.DATABASE_URL });
    const owner = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    const platform = new pg.Client({ connectionString: process.env.PLATFORM_DATABASE_URL });
    await Promise.all([app.connect(), owner.connect(), platform.connect()]);
    try {
      // Quantities cannot be edited, only moved through the ledger.
      await expect(app.query(`UPDATE "StockBatch" SET quantity = 1000`)).rejects.toThrow(/permission denied/);
      const mv = (kind: string, q: number, batch = batchId, extra = "") =>
        owner.query(`INSERT INTO "StockMovement" (id, "tenantId", "batchId", "itemId", "branchId", kind, quantity, "createdById"${extra ? `, ${extra.split("=")[0]}` : ""})
                     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7${extra ? `, ${extra.split("=")[1]}` : ""})`, [s.a.tenantId, batch, itemId, s.branch.id, kind, q, s.pharmacist.ctx.principal.user.id]);
      await expect(mv("ISSUE", -11)).rejects.toThrow(/StockBatch_quantity_chk/); // never negative
      await expect(mv("ISSUE", 3)).rejects.toThrow(/StockMovement_sign_chk/);
      await expect(mv("ISSUE", -1, expired)).rejects.toThrow(/Expired stock/);
      await expect(mv("WRITE_OFF", -1)).rejects.toThrow(/StockMovement_reason_chk/);
      await expect(mv("DISPENSE", -1)).rejects.toThrow(/StockMovement_patient_chk/);
      await mv("WRITE_OFF", -1, expired, `reason='EXPIRED'`); // expired stock can still be written off
      await expect(owner.query(`UPDATE "StockMovement" SET quantity = 1`)).rejects.toThrow(/append-only/);
      await expect(owner.query(`DELETE FROM "StockMovement"`)).rejects.toThrow(/append-only/);
      // A new batch always starts empty, whatever the insert says.
      const b = crypto.randomUUID();
      await owner.query(`INSERT INTO "StockBatch" (id, "tenantId", "itemId", "branchId", "lotNumber", quantity) VALUES ($1, $2, $3, $4, 'FAKE', 500)`, [b, s.a.tenantId, itemId, s.branch.id]);
      expect((await owner.query(`SELECT quantity FROM "StockBatch" WHERE id = $1`, [b])).rows[0].quantity).toBe(0);
      for (const t of ["InventoryItem", "StockBatch", "StockMovement", "Supplier", "StaffProfile", "StaffCredential", "StaffLeave"]) {
        await expect(platform.query(`SELECT 1 FROM "${t}" LIMIT 1`)).rejects.toThrow(/permission denied/);
      }
    } finally {
      await Promise.all([app.end(), owner.end(), platform.end()]);
    }
  });

  it("concurrent issues never oversell", async () => {
    const s = await setup();
    const itemId = await createItem(s.pharmacist.ctx, { code: "AMP1", name: "Ampoule (synthetic)", category: "MEDICINE", unit: "ampoule" }, META);
    await receiveStock(s.pharmacist.ctx, itemId, { branchId: s.branch.id, lotNumber: "A1", expiresOn: day(100), quantity: "6" }, META);
    await receiveStock(s.pharmacist.ctx, itemId, { branchId: s.branch.id, lotNumber: "A2", expiresOn: day(200), quantity: "4" }, META);
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => issueStock(s.pharmacist.ctx, itemId, { branchId: s.branch.id, quantity: "4", kind: "ISSUE" }, META)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(results.filter((r) => r.status === "rejected").every((r) => String((r as PromiseRejectedResult).reason).includes("errors.insufficientStock"))).toBe(true);
    expect((await listInventory(s.pharmacist.ctx, { branchId: s.branch.id }))[0]!.onHand).toBe(2);
  });

  it("roles and clinics are kept apart", async () => {
    const s = await setup();
    const itemId = await createItem(s.pharmacist.ctx, { code: "GAUZE", name: "Gauze (synthetic)", category: "CONSUMABLE", unit: "pack" }, META);
    await expect(createItem(s.reception.ctx, { code: "X1", name: "Nope", category: "OTHER", unit: "pcs" }, META)).rejects.toThrow("errors.forbidden");
    await expect(listInventory(s.reception.ctx)).rejects.toThrow("errors.forbidden");
    await expect(listInventory(s.hr.ctx)).rejects.toThrow("errors.forbidden");
    expect((await listInventory(s.a.ctx)).map((i) => i.id)).toEqual([itemId]); // owner reads stock
    await expect(receiveStock(s.a.ctx, itemId, { branchId: s.branch.id, lotNumber: "L", quantity: "1" }, META)).rejects.toThrow("errors.forbidden");
    const other = await setup();
    expect(await getItem(other.pharmacist.ctx, itemId)).toBeNull();
    await expect(receiveStock(other.pharmacist.ctx, itemId, { branchId: other.branch.id, lotNumber: "L", quantity: "1" }, META)).rejects.toThrow("errors.notFound");
  });
});

describe("HR", () => {
  it("profiles, credentials with expiry alerts, and leave that blocks a doctor's bookings", async () => {
    const s = await setup();
    const hr = s.hr.ctx;
    await saveStaffProfile(hr, s.doctor.membershipId, { personnelNumber: "T-001", position: "Therapist", employmentType: "FULL_TIME", hiredOn: "2024-03-01", workPhone: "" }, META);
    await expect(saveStaffProfile(hr, s.reception.membershipId, { personnelNumber: "T-001", employmentType: "PART_TIME" }, META)).rejects.toThrow("errors.personnelNumberTaken");
    await expect(saveStaffProfile(s.reception.ctx, s.doctor.membershipId, { employmentType: "FULL_TIME" }, META)).rejects.toThrow("errors.forbidden");

    await addCredential(hr, s.doctor.membershipId, { kind: "MEDICAL_LICENSE", title: "Licence (synthetic)", number: "LIC-1", issuedOn: "2020-01-01", expiresOn: day(30) }, META);
    const old = await addCredential(hr, s.doctor.membershipId, { kind: "TRAINING", title: "CPR course (synthetic)", expiresOn: day(-5) }, META);
    await expect(addCredential(hr, s.doctor.membershipId, { kind: "OTHER", title: "Bad dates", issuedOn: "2025-01-02", expiresOn: "2025-01-01" }, META)).rejects.toThrow();
    let row = (await listStaffHr(hr)).find((m) => m.id === s.doctor.membershipId)!;
    expect([row.expiredCredentials, row.expiringCredentials, row.staffProfile?.position]).toEqual([1, 1, "Therapist"]);
    expect((await hrAlerts(hr)).credentials.map((m) => m.id)).toEqual([s.doctor.membershipId]);
    await archiveCredential(hr, old, META);
    row = (await listStaffHr(hr)).find((m) => m.id === s.doctor.membershipId)!;
    expect(row.expiredCredentials).toBe(0);

    // A doctor with a schedule and one booked visit inside the coming leave.
    const profileId = await saveDoctorProfile(s.a.ctx, s.doctor.membershipId, { specialty: "therapy", defaultSlotMinutes: 20, acceptsOnlineBooking: false }, META);
    for (let d = 1; d <= 7; d++) await addScheduleBlock(s.a.ctx, profileId, { weekday: d, start: "08:00", end: "18:00", branchId: s.branch.id }, META);
    const p = await registerPatient(s.reception.ctx, { lastName: "Sintetik", firstName: "Tatil", birthDate: "1980-05-05", sex: "FEMALE" }, { confirmNotDuplicate: true }, META);
    if (!p.ok) throw new Error("patient");
    await bookAppointment(s.reception.ctx, { patientId: p.id, doctorProfileId: profileId, startsAt: localToInstant(day(11), 10 * 60, TZ).toISOString() }, META);

    const leave = await recordLeave(hr, s.doctor.membershipId, { kind: "SICK_LEAVE", startsOn: day(10), endsOn: day(12) }, META);
    expect(leave.conflicts).toBe(1);
    await expect(recordLeave(hr, s.doctor.membershipId, { kind: "VACATION", startsOn: day(12), endsOn: day(14) }, META)).rejects.toThrow("errors.leaveOverlap");
    await expect(recordLeave(hr, s.doctor.membershipId, { kind: "VACATION", startsOn: day(5), endsOn: day(4) }, META)).rejects.toThrow();
    expect(await doctorSlots(s.reception.ctx, profileId, day(11))).toEqual([]);
    await expect(bookAppointment(s.reception.ctx, { patientId: p.id, doctorProfileId: profileId, startsAt: localToInstant(day(12), 9 * 60, TZ).toISOString() }, META)).rejects.toThrow("errors.outsideSchedule");

    // Colleagues see a generic absence, never "sick leave".
    const c = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await c.connect();
    const kinds = (await c.query(`SELECT DISTINCT kind::text FROM "ScheduleException" WHERE "leaveId" = $1`, [leave.id])).rows.map((r) => r.kind);
    await c.end();
    expect(kinds).toEqual(["OTHER_ABSENCE"]);

    await cancelLeave(hr, leave.id, META);
    expect((await doctorSlots(s.reception.ctx, profileId, day(12))).length).toBeGreaterThan(0);
    const detail = await getStaffHr(hr, s.doctor.membershipId);
    expect(detail.leaves.map((l) => l.status)).toEqual(["CANCELLED"]);
    expect(detail.isDoctor).toBe(true);

    // Other clinics' HR cannot reach these people.
    const other = await setup();
    await expect(getStaffHr(other.hr.ctx, s.doctor.membershipId)).rejects.toThrow("errors.notFound");
    await expect(listStaffHr(s.pharmacist.ctx)).rejects.toThrow("errors.forbidden");
  });
});
