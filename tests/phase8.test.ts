import pg from "pg";
import { describe, expect, it } from "vitest";
import { registerWalkIn } from "@/server/appointments/appointments";
import { inviteStaff, listBranches, listStaff } from "@/server/clinic/admin";
import { saveDoctorProfile } from "@/server/clinic/doctors";
import { createService } from "@/server/clinic/resources";
import { getEncounter, getMedicalRecord, startVisit } from "@/server/emr/record";
import { addAnalyte, cancelLabOrder, collectSpecimen, createLabOrder, enterResults, getLabOrder, labWorklist, listLabTests, verifyResults } from "@/server/lab/lab";
import { registerPatient } from "@/server/patients/patients";
import { todayIn } from "@/server/scheduling/time";
import { acceptInvitation } from "@/server/tenancy/invitations";
import { META, PASSWORD, clinicContext, clinicWithOwner, platformActor, uniq } from "./helpers/fixtures";

async function staff(owner: Awaited<ReturnType<typeof clinicWithOwner>>, roleKeys: string[]) {
  const email = `${uniq("s")}@clinic.test`;
  const inv = await inviteStaff(owner.ctx, { fullName: `Synthetic ${roleKeys[0]}`, email, roleKeys }, META);
  await acceptInvitation(inv.token, { fullName: `Synthetic ${roleKeys[0]}`, password: PASSWORD, confirmPassword: PASSWORD }, META);
  const m = (await listStaff(owner.ctx)).members.find((x) => x.user.email === email)!;
  return { email, membershipId: m.id, ctx: await clinicContext(email, owner.slug) };
}

let n = 0;
async function setup() {
  const a = await clinicWithOwner(await platformActor());
  const [branch] = await listBranches(a.ctx);
  const reception = await staff(a, ["receptionist"]);
  const doctor = await staff(a, ["doctor"]);
  const nurse = await staff(a, ["nurse"]);
  const lab1 = await staff(a, ["lab_staff"]);
  const lab2 = await staff(a, ["lab_staff"]);
  const profileId = await saveDoctorProfile(a.ctx, doctor.membershipId, { specialty: "therapy", defaultSlotMinutes: 20, acceptsOnlineBooking: false }, META);
  const cbc = await createService(a.ctx, { code: `LAB${++n}`, name: "Synthetic blood test", kind: "LAB_TEST", durationMinutes: 10, price: "50000", currency: "UZS" }, META);
  const consult = await createService(a.ctx, { code: `CON${n}`, name: "Synthetic consultation", kind: "CONSULTATION", durationMinutes: 20, price: "100000", currency: "UZS" }, META);
  const hb = await addAnalyte(lab1.ctx, cbc, { name: "Hemoglobin", loinc: "718-7", unit: "g/L", refLow: "120", refHigh: "160", sortOrder: "1" }, META);
  const glu = await addAnalyte(lab1.ctx, cbc, { name: "Glucose", loinc: "2345-7", unit: "mmol/L", refLow: "3,9", refHigh: "6.1", sortOrder: "2" }, META);
  const p = await registerPatient(reception.ctx, { lastName: "Sintetik", firstName: `Lab${n}`, birthDate: "1985-02-02", sex: "MALE" }, { confirmNotDuplicate: true }, META);
  if (!p.ok) throw new Error("patient");
  const appt = await registerWalkIn(reception.ctx, { patientId: p.id, doctorProfileId: profileId, branchId: branch!.id }, META);
  const doctorCtx = await clinicContext(doctor.email, a.slug);
  const encounterId = await startVisit(doctorCtx, appt, META);
  return { a, branch: branch!, reception, doctorCtx, nurse, lab1, lab2, cbc, consult, hb, glu, patientId: p.id, encounterId };
}

describe("laboratory workflow", () => {
  it("order → collect → enter (flags) → four-eyes verification → visible in the record", async () => {
    const s = await setup();
    const tests = await listLabTests(s.doctorCtx);
    expect(tests[0]!.labAnalytes.map((x) => x.name)).toEqual(["Hemoglobin", "Glucose"]);

    await expect(createLabOrder(s.doctorCtx, s.encounterId, { serviceIds: [s.consult] }, META)).rejects.toThrow("errors.invalidInput");
    const { id, number } = await createLabOrder(s.doctorCtx, s.encounterId, { serviceIds: [s.cbc], priority: "URGENT", indication: "Synthetic indication" }, META);
    expect(number).toBe(`LAB-${todayIn("Asia/Tashkent").slice(0, 4)}-000001`);

    expect((await labWorklist(s.lab1.ctx, ["ORDERED"])).map((o) => o.id)).toEqual([id]);
    const item = (await getLabOrder(s.lab1.ctx, id, META)).items[0]!;
    await expect(enterResults(s.lab1.ctx, id, { [`${item.id}:${s.hb}`]: "100" }, META)).rejects.toThrow("errors.invalidTransition"); // not collected yet

    await collectSpecimen(s.nurse.ctx, id, META);
    await expect(collectSpecimen(s.nurse.ctx, id, META)).rejects.toThrow("errors.invalidTransition");

    // Partial entry keeps the order "collected"; completing it makes it "resulted".
    expect(await enterResults(s.lab1.ctx, id, { [`${item.id}:${s.hb}`]: "100" }, META)).toEqual({ complete: false });
    await expect(enterResults(s.lab1.ctx, id, { [`${item.id}:${s.glu}`]: "abc" }, META)).rejects.toThrow("errors.invalidResultValue");
    expect(await enterResults(s.lab1.ctx, id, { [`${item.id}:${s.glu}`]: "7,2" }, META)).toEqual({ complete: true });

    await expect(verifyResults(s.lab1.ctx, id, META)).rejects.toThrow("errors.fourEyes");
    await verifyResults(s.lab2.ctx, id, META);
    await expect(enterResults(s.lab1.ctx, id, { [`${item.id}:${s.hb}`]: "130" }, META)).rejects.toThrow("errors.invalidTransition");

    // The database itself refuses to alter verified results, even for the schema owner.
    const owner = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await owner.connect();
    await expect(owner.query(`UPDATE "LabResult" SET value = 999 WHERE "orderItemId" = $1`, [item.id])).rejects.toThrow(/final/);
    await expect(owner.query(`DELETE FROM "LabOrder" WHERE id = $1`, [id])).rejects.toThrow(/final|cannot be deleted/);
    await owner.end();

    const rec = await getMedicalRecord(s.doctorCtx, s.patientId, META);
    const results = rec.labOrders[0]!.items[0]!.results.sort((x, y) => x.analyte.sortOrder - y.analyte.sortOrder);
    expect(rec.labOrders[0]!.status).toBe("VERIFIED");
    expect(results.map((r) => [r.analyte.name, r.value.toString(), r.flag])).toEqual([
      ["Hemoglobin", "100", "LOW"],
      ["Glucose", "7.2", "HIGH"],
    ]);
    expect((await getEncounter(s.doctorCtx, s.encounterId, META)).labOrders).toHaveLength(1);
  });

  it("access is limited to the right roles, clinics and the ordering doctor", async () => {
    const s = await setup();
    const other = await staff(s.a, ["doctor"]);
    await saveDoctorProfile(s.a.ctx, other.membershipId, { specialty: "therapy", defaultSlotMinutes: 20, acceptsOnlineBooking: false }, META);
    await expect(createLabOrder(other.ctx, s.encounterId, { serviceIds: [s.cbc] }, META)).rejects.toThrow(/errors.(notYourPatient|noCareRelationship)/);

    const { id } = await createLabOrder(s.doctorCtx, s.encounterId, { serviceIds: [s.cbc] }, META);
    await expect(labWorklist(s.reception.ctx, ["ORDERED"])).rejects.toThrow("errors.forbidden"); // front desk: no lab access
    await expect(getMedicalRecord(s.lab1.ctx, s.patientId, META)).rejects.toThrow("errors.forbidden"); // lab staff: no EMR
    await expect(addAnalyte(s.nurse.ctx, s.cbc, { name: "X", unit: "u" }, META)).rejects.toThrow("errors.forbidden");
    await expect(addAnalyte(s.lab1.ctx, s.cbc, { name: "Bad range", unit: "u", refLow: "10", refHigh: "1" }, META)).rejects.toThrow();

    const elsewhere = await setup();
    await expect(getLabOrder(elsewhere.lab1.ctx, id, META)).rejects.toThrow("errors.notFound");
    const platform = new pg.Client({ connectionString: process.env.PLATFORM_DATABASE_URL });
    await platform.connect();
    for (const t of ["LabAnalyte", "LabOrder", "LabOrderItem", "LabResult"]) {
      await expect(platform.query(`SELECT 1 FROM "${t}" LIMIT 1`)).rejects.toThrow(/permission denied/);
    }
    await platform.end();

    await cancelLabOrder(s.doctorCtx, id, META);
    await expect(collectSpecimen(s.nurse.ctx, id, META)).rejects.toThrow("errors.invalidTransition");
  });

  it("existing clinics received the new lab permissions", async () => {
    const s = await setup();
    expect(s.nurse.ctx.permissions.has("lab.collect")).toBe(true);
    expect(s.lab1.ctx.permissions.has("lab.manage")).toBe(true);
    expect(s.nurse.ctx.permissions.has("lab.process")).toBe(false);
  });
});
