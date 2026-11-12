import pg from "pg";
import { describe, expect, it } from "vitest";
import { registerWalkIn } from "@/server/appointments/appointments";
import { addInvoiceLine, createInvoice } from "@/server/billing/billing";
import { inviteStaff, listBranches, listStaff } from "@/server/clinic/admin";
import { doctorSlots, saveDoctorProfile } from "@/server/clinic/doctors";
import { completeSetup, listClinicModules, setClinicModule } from "@/server/clinic/practice";
import { listServices } from "@/server/clinic/resources";
import { recordTooth } from "@/server/emr/dental";
import { getEncounter, getMedicalRecord, startVisit } from "@/server/emr/record";
import { listStaffHr } from "@/server/hr/hr";
import { labWorklist } from "@/server/lab/lab";
import { registerPatient } from "@/server/patients/patients";
import { portalTenant } from "@/server/portal/auth";
import { addDays, isoWeekday, todayIn } from "@/server/scheduling/time";
import { changeSubscriptionPlan } from "@/server/tenancy/provisioning";
import { acceptInvitation } from "@/server/tenancy/invitations";
import { META, PASSWORD, clinicContext, clinicWithOwner, platformActor, uniq } from "./helpers/fixtures";

const TZ = "Asia/Tashkent";

async function staff(o: Awaited<ReturnType<typeof clinicWithOwner>>, roleKeys: string[]) {
  const email = `${uniq("s")}@clinic.test`;
  const inv = await inviteStaff(o.ctx, { fullName: `Synthetic ${roleKeys[0]}`, email, roleKeys }, META);
  await acceptInvitation(inv.token, { fullName: `Synthetic ${roleKeys[0]}`, password: PASSWORD, confirmPassword: PASSWORD }, META);
  const m = (await listStaff(o.ctx)).members.find((x) => x.user.email === email)!;
  return { email, membershipId: m.id, ctx: await clinicContext(email, o.slug) };
}

/** Fresh contexts reflect module changes (permissions are resolved per request). */
const fresh = (email: string, slug: string) => clinicContext(email, slug);
const SETUP = { applyModules: true, addStarterServices: true, ownerIsDoctor: false, specialty: "", weekdaySchedule: false };

describe("modules are enforced", () => {
  it("switching a module off removes its screens' permissions for everyone; on again restores them; plan limits apply", async () => {
    const actor = await platformActor();
    const a = await clinicWithOwner(actor);
    const lab = await staff(a, ["lab_staff"]);
    const hr = await staff(a, ["hr_manager"]);
    const reception = await staff(a, ["receptionist"]);
    expect(lab.ctx.permissions.has("lab.read")).toBe(true);

    await setClinicModule(a.ctx, "laboratory", false, META);
    const labOff = await fresh(lab.email, a.slug);
    expect([...labOff.permissions].filter((p) => p.startsWith("lab."))).toEqual([]);
    await expect(labWorklist(labOff, ["ORDERED"])).rejects.toThrow("errors.forbidden");
    expect(labOff.permissions.has("patients.read")).toBe(true); // unrelated permissions stay
    await setClinicModule(a.ctx, "laboratory", true, META);
    expect((await fresh(lab.email, a.slug)).permissions.has("lab.read")).toBe(true);

    // Core modules cannot be switched; only owners/admins switch modules.
    await expect(setClinicModule(a.ctx, "emr", false, META)).rejects.toThrow("errors.invalidInput");
    await expect(setClinicModule(reception.ctx, "hr", false, META)).rejects.toThrow("errors.forbidden");

    // Plan limits: on the starter plan, HR can be switched off but not back on.
    await changeSubscriptionPlan(actor, a.tenantId, "starter", META);
    await setClinicModule(a.ctx, "hr", false, META);
    await expect(listStaffHr(await fresh(hr.email, a.slug))).rejects.toThrow("errors.forbidden");
    await expect(setClinicModule(a.ctx, "hr", true, META)).rejects.toThrow("errors.moduleNotInPlan");
    const modules = await listClinicModules(a.ctx);
    expect(modules.find((m) => m.key === "hr")).toEqual({ key: "hr", enabled: false, inPlan: false });
    expect(modules.find((m) => m.key === "dental")).toEqual({ key: "dental", enabled: false, inPlan: true });

    // No portal module → the clinic has no patient portal at all.
    expect(await portalTenant(a.slug)).not.toBeNull();
    await setClinicModule(a.ctx, "patient_portal", false, META);
    expect(await portalTenant(a.slug)).toBeNull();
  });
});

describe("setup assistant", () => {
  it("solo practice: owner becomes the doctor, gets a bookable week, starter services without prices, only the modules a small office needs", async () => {
    const a = await clinicWithOwner(await platformActor());
    const admin = await staff(a, ["clinic_admin"]);
    await expect(completeSetup(admin.ctx, { ...SETUP, practiceType: "SOLO_PRACTICE" }, META)).rejects.toThrow("errors.forbidden"); // owner only
    await expect(completeSetup(a.ctx, { ...SETUP, practiceType: "SOLO_PRACTICE", ownerIsDoctor: true }, META)).rejects.toThrow(); // specialty required

    const r = await completeSetup(a.ctx, { ...SETUP, practiceType: "SOLO_PRACTICE", ownerIsDoctor: true, ownerFrontDesk: true, specialty: "general_practice", weekdaySchedule: true }, META);
    expect(r.modulesOn.sort()).toEqual(["billing", "patient_portal", "reports"]);
    expect(r.servicesAdded).toBe(2);
    expect(r.ownerDoctorProfileId).toBeTruthy();

    const owner = await fresh(a.ownerEmail, a.slug);
    expect(owner.roleKeys.sort()).toEqual(["cashier", "clinic_owner", "doctor", "receptionist"]);
    for (const p of ["patients.create", "appointments.manage", "billing.payment", "cash.shift"]) expect(owner.permissions.has(p as never)).toBe(true);
    expect(owner.permissions.has("emr.write")).toBe(true);
    for (const p of ["lab.read", "inventory.read", "hr.read"]) expect(owner.permissions.has(p as never)).toBe(false);

    let day = addDays(todayIn(TZ), 1);
    while (isoWeekday(day) > 5) day = addDays(day, 1);
    expect((await doctorSlots(owner, r.ownerDoctorProfileId!, day)).length).toBeGreaterThan(0);

    // Running it again adds no duplicate services.
    expect((await completeSetup(owner, { ...SETUP, practiceType: "SOLO_PRACTICE" }, META)).servicesAdded).toBe(0);

    // Starter services have no price yet: they cannot be billed until one is set.
    const consult = (await listServices(owner)).find((s) => s.code === "CONSULT")!;
    expect(consult.priceMinor).toBe(0n);
    const [branch] = await listBranches(owner);
    const p = await registerPatient(owner, { lastName: "Sintetik", firstName: "Yakka", birthDate: "1977-07-07", sex: "MALE" }, { confirmNotDuplicate: true }, META);
    if (!p.ok) throw new Error("patient");
    const inv = await createInvoice(owner, { patientId: p.id, branchId: branch!.id }, META);
    await expect(addInvoiceLine(owner, inv, { serviceId: consult.id, quantity: 1 }, META)).rejects.toThrow("errors.servicePriceNotSet");

    const c = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await c.connect();
    const audit = await c.query(`SELECT action FROM "AuditEvent" WHERE "tenantId" = $1 AND action IN ('clinic.owner_clinical_role', 'clinic.owner_front_desk_role', 'clinic.setup_completed')`, [a.tenantId]);
    await c.end();
    expect(audit.rows.map((x) => x.action).sort()).toEqual(["clinic.owner_clinical_role", "clinic.owner_front_desk_role", "clinic.setup_completed", "clinic.setup_completed"]);
  });
});

describe("dental chart", () => {
  it("dental preset turns the chart on; the treating doctor records teeth; history is append-only; others are kept out", async () => {
    const a = await clinicWithOwner(await platformActor());
    const r = await completeSetup(a.ctx, { ...SETUP, practiceType: "DENTAL" }, META);
    expect(r.modulesOn).toContain("dental");
    expect(r.modulesOn).not.toContain("laboratory");
    expect((await listServices(await fresh(a.ownerEmail, a.slug))).map((s) => s.code).filter((c) => c.startsWith("DENT-")).sort()).toEqual(["DENT-CLEAN", "DENT-EXAM", "DENT-EXT", "DENT-FILL", "DENT-RCT", "DENT-XRAY"]);

    const [branch] = await listBranches(a.ctx);
    const reception = await staff(a, ["receptionist"]);
    const dentist = await staff(a, ["doctor"]);
    const profileId = await saveDoctorProfile(a.ctx, dentist.membershipId, { specialty: "dentistry", defaultSlotMinutes: 30, acceptsOnlineBooking: false }, META);
    const p = await registerPatient(reception.ctx, { lastName: "Sintetik", firstName: "Tish", birthDate: "1995-05-05", sex: "FEMALE" }, { confirmNotDuplicate: true }, META);
    if (!p.ok) throw new Error("patient");
    const appt = await registerWalkIn(reception.ctx, { patientId: p.id, doctorProfileId: profileId, branchId: branch!.id }, META);
    const doc = await fresh(dentist.email, a.slug);
    const enc = await startVisit(doc, appt, META);

    await recordTooth(doc, enc, { tooth: "36", condition: "CARIES", surfaces: ["O", "D", "O"] }, META);
    await recordTooth(doc, enc, { tooth: "36", condition: "FILLED", surfaces: ["O", "D"] }, META);
    await recordTooth(doc, enc, { tooth: "18", condition: "MISSING", surfaces: ["M"] }, META); // surfaces ignored when not partial
    await recordTooth(doc, enc, { tooth: "75", condition: "HEALTHY" }, META); // primary tooth
    await expect(recordTooth(doc, enc, { tooth: "19", condition: "CARIES" }, META)).rejects.toThrow();
    await expect(recordTooth(doc, enc, { tooth: "59", condition: "CARIES" }, META)).rejects.toThrow();

    const chart = (await getEncounter(doc, enc, META)).dental!;
    expect(chart.current[36]).toMatchObject({ condition: "FILLED", surfaces: ["O", "D"] });
    expect(chart.current[18]).toMatchObject({ condition: "MISSING", surfaces: [] });
    expect(chart.current[75]?.condition).toBe("HEALTHY");
    expect(chart.history).toHaveLength(4);
    expect((await getMedicalRecord(doc, p.id, META)).dental!.current[36]?.condition).toBe("FILLED");

    // Another doctor, the front desk and a switched-off module cannot record.
    const other = await staff(a, ["doctor"]);
    await saveDoctorProfile(a.ctx, other.membershipId, { specialty: "dentistry", defaultSlotMinutes: 30, acceptsOnlineBooking: false }, META);
    await expect(recordTooth(await fresh(other.email, a.slug), enc, { tooth: "11", condition: "CARIES" }, META)).rejects.toThrow(/errors\.(notYourPatient|noCareRelationship)/);
    await expect(recordTooth(reception.ctx, enc, { tooth: "11", condition: "CARIES" }, META)).rejects.toThrow();
    await setClinicModule(a.ctx, "dental", false, META);
    const docOff = await fresh(dentist.email, a.slug);
    await expect(recordTooth(docOff, enc, { tooth: "11", condition: "CARIES" }, META)).rejects.toThrow("errors.moduleDisabled");
    expect((await getEncounter(docOff, enc, META)).dental).toBeNull();

    // The database keeps the history: no edits, no deletes, valid teeth only; no platform access.
    const owner = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    const platform = new pg.Client({ connectionString: process.env.PLATFORM_DATABASE_URL });
    await Promise.all([owner.connect(), platform.connect()]);
    try {
      await expect(owner.query(`UPDATE "DentalChartEntry" SET condition = 'HEALTHY' WHERE "patientId" = $1`, [p.id])).rejects.toThrow(/append-only/);
      await expect(owner.query(`DELETE FROM "DentalChartEntry" WHERE "patientId" = $1`, [p.id])).rejects.toThrow(/append-only/);
      await expect(
        owner.query(`INSERT INTO "DentalChartEntry" (id, "tenantId", "patientId", tooth, surfaces, condition, "recordedById") VALUES (gen_random_uuid(), $1, $2, 49, '{}', 'CARIES', $3)`, [a.tenantId, p.id, a.ctx.principal.user.id]),
      ).rejects.toThrow(/DentalChartEntry_tooth_chk/);
      await expect(platform.query(`SELECT 1 FROM "DentalChartEntry" LIMIT 1`)).rejects.toThrow(/permission denied/);
    } finally {
      await Promise.all([owner.end(), platform.end()]);
    }
  });
});
