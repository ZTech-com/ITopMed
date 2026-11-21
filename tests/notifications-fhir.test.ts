import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { bookAppointment, cancelAppointment, registerWalkIn } from "@/server/appointments/appointments";
import { addStaffMember, listBranches, listStaff } from "@/server/clinic/admin";
import { addScheduleBlock, saveDoctorProfile } from "@/server/clinic/doctors";
import { createService } from "@/server/clinic/resources";
import { exportPatientFhir } from "@/server/emr/fhir";
import { addAllergy, addDiagnosis, recordVitals, startVisit } from "@/server/emr/record";
import { addAnalyte, collectSpecimen, createLabOrder, enterResults, getLabOrder, releaseLabOrder, verifyResults } from "@/server/lab/lab";
import { listNotifications, processDueNotifications, saveNotificationSettings } from "@/server/notifications/notifications";
import { recordConsent, registerPatient, withdrawConsent } from "@/server/patients/patients";
import { activatePortalAccount, portalTenant } from "@/server/portal/auth";
import { issuePortalCode } from "@/server/portal/staff";
import { addDays, localToInstant, todayIn } from "@/server/scheduling/time";
import { META, PASSWORD, clinicContext, clinicWithOwner, platformActor, uniq } from "./helpers/fixtures";

const TZ = "Asia/Tashkent";
const PW = "Bemor-Parol-2026x";

async function staff(o: Awaited<ReturnType<typeof clinicWithOwner>>, roleKeys: string[]) {
  const login = uniq("s");
  await addStaffMember(o.ctx, { fullName: `Synthetic ${roleKeys[0]}`, username: login, roleKeys, password: PASSWORD }, META);
  const m = (await listStaff(o.ctx)).members.find((x) => x.user.username === login)!;
  return { login, membershipId: m.id, ctx: await clinicContext(login, o.slug) };
}

let n = 0;
async function setup() {
  const a = await clinicWithOwner(await platformActor());
  const [branch] = await listBranches(a.ctx);
  const reception = await staff(a, ["receptionist"]);
  const doctor = await staff(a, ["doctor"]);
  const profileId = await saveDoctorProfile(a.ctx, doctor.membershipId, { specialty: "therapy", defaultSlotMinutes: 20, acceptsOnlineBooking: false }, META);
  for (let d = 1; d <= 7; d++) await addScheduleBlock(a.ctx, profileId, { weekday: d, start: "00:00", end: "24:00", branchId: branch!.id }, META);
  const doctorCtx = await clinicContext(doctor.login, a.slug);
  const phone = `+99890${String(1000000 + ++n * 7919).slice(-7)}`;
  const p = await registerPatient(
    reception.ctx,
    { lastName: "Sintetik", firstName: `Xabar${n}`, birthDate: "1990-02-03", sex: "FEMALE", phone },
    { confirmNotDuplicate: true },
    META,
  );
  if (!p.ok) throw new Error("patient");
  const consent = (purpose: string) => recordConsent(reception.ctx, p.id, { purpose, method: "PAPER_SIGNED" }, META);
  const at = (days: number, hhmm = "10:00") => {
    const [h, m] = hhmm.split(":").map(Number);
    return localToInstant(addDays(todayIn(TZ), days), h! * 60 + m!, TZ);
  };
  const book = (when: Date) => bookAppointment(reception.ctx, { patientId: p.id, doctorProfileId: profileId, startsAt: when.toISOString() }, META);
  const log = async () => (await listNotifications(a.ctx)).rows;
  return { a, branch: branch!, reception, doctorCtx, profileId, patientId: p.id, mrn: p.mrn, phone, consent, at, book, log };
}

function smsFilesFor(phone: string) {
  const dir = path.join(process.cwd(), ".dev-mailbox", "sms");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(`_${phone}.txt`)).map((f) => fs.readFileSync(path.join(dir, f), "utf8"));
}

describe("notifications: outbox, consent and delivery", () => {
  it("booking queues a confirmation and a reminder per consented channel; delivery is rendered at send time", async () => {
    const s = await setup();
    // No consent yet → nothing is queued.
    await s.book(s.at(5, "09:00"));
    expect(await s.log()).toEqual([]);

    await s.consent("SMS_REMINDERS");
    // There is no email channel any more: an email consent cannot even be recorded.
    await expect(s.consent("EMAIL_NOTIFICATIONS")).rejects.toThrow();
    const startsAt = s.at(3, "10:00");
    const appt = await s.book(startsAt);
    let rows = await s.log();
    expect(rows.map((r) => `${r.kind}:${r.channel}:${r.status}`).sort()).toEqual(["APPOINTMENT_BOOKED:SMS:PENDING", "APPOINTMENT_REMINDER:SMS:PENDING"]);
    const reminder = rows.find((r) => r.kind === "APPOINTMENT_REMINDER")!;
    expect(reminder.dueAt.getTime()).toBe(startsAt.getTime() - 24 * 3_600_000);
    expect(rows.every((r) => r.subjectId === appt)).toBe(true);

    expect(await processDueNotifications(s.a.tenantId)).toEqual({ sent: 1, failed: 0, skipped: 0, retried: 0 });
    rows = await s.log();
    expect(rows.filter((r) => r.status === "SENT").map((r) => r.transport)).toEqual(["sms-dev-outbox"]);
    const sms = smsFilesFor(s.phone).join("\n");
    expect(sms).toContain("SIMULATED SMS");
    expect(sms).toContain(s.a.ctx.tenant.name);
    expect(sms).not.toMatch(/therapy|terapevt|Synthetic doctor/i); // no specialty or doctor in messages

    // Reminders go out when due — and never twice, even with parallel workers.
    const later = new Date(reminder.dueAt.getTime() + 60_000);
    const [r1, r2] = await Promise.all([processDueNotifications(s.a.tenantId, { now: later }), processDueNotifications(s.a.tenantId, { now: later })]);
    expect(r1.sent + r2.sent).toBe(1);
    expect((await s.log()).filter((r) => r.status === "SENT")).toHaveLength(2);
  });

  it("re-checks relevance and consent at send time; cancellations notify; settings switch kinds off", async () => {
    const s = await setup();
    await s.consent("SMS_REMINDERS");
    const appt = await s.book(s.at(4));
    await processDueNotifications(s.a.tenantId); // confirmation
    await cancelAppointment(s.reception.ctx, appt, "PATIENT_REQUEST", META);
    const reminderDue = (await s.log()).find((r) => r.kind === "APPOINTMENT_REMINDER")!.dueAt;
    await processDueNotifications(s.a.tenantId, { now: new Date(reminderDue.getTime() + 1000) });
    const byKind = Object.fromEntries((await s.log()).map((r) => [r.kind, `${r.status}:${r.lastError ?? ""}`]));
    expect(byKind).toEqual({ APPOINTMENT_BOOKED: "SENT:", APPOINTMENT_CANCELLED: "SENT:", APPOINTMENT_REMINDER: "SKIPPED:stale" });

    // Consent withdrawn after queuing → skipped, nothing sent.
    const appt2 = await s.book(s.at(6));
    const smsConsent = (await (await import("@/server/patients/patients")).getPatient(s.reception.ctx, s.patientId, META))!.consents.find((c) => c.purpose === "SMS_REMINDERS" && !c.withdrawnAt)!;
    await withdrawConsent(s.reception.ctx, smsConsent.id, META);
    await processDueNotifications(s.a.tenantId);
    expect((await s.log()).find((r) => r.subjectId === appt2 && r.kind === "APPOINTMENT_BOOKED")).toMatchObject({ status: "SKIPPED", lastError: "no_consent" });

    // Settings: only owners/admins; reminders off → only confirmations are queued.
    await expect(saveNotificationSettings(s.reception.ctx, { appointmentBooked: true, appointmentReminder: false, reminderHoursBefore: 24, appointmentCancelled: true, resultsReady: true }, META)).rejects.toThrow("errors.forbidden");
    await expect(saveNotificationSettings(s.a.ctx, { appointmentBooked: true, appointmentReminder: true, reminderHoursBefore: 100, appointmentCancelled: true, resultsReady: true }, META)).rejects.toThrow();
    await saveNotificationSettings(s.a.ctx, { appointmentBooked: true, appointmentReminder: false, reminderHoursBefore: 24, appointmentCancelled: true, resultsReady: true }, META);
    await s.consent("SMS_REMINDERS");
    const appt3 = await s.book(s.at(7));
    expect((await s.log()).filter((r) => r.subjectId === appt3).map((r) => r.kind)).toEqual(["APPOINTMENT_BOOKED"]);
  });

  it("results-ready only for patients with an active portal; the message carries a link, never values", async () => {
    const s = await setup();
    await s.consent("SMS_REMINDERS");
    const lab1 = await staff(s.a, ["lab_staff"]);
    const lab2 = await staff(s.a, ["lab_staff"]);
    const nurse = await staff(s.a, ["nurse"]);
    const svc = await createService(s.a.ctx, { code: `NL${n}`, name: "Synthetic test", kind: "LAB_TEST", durationMinutes: 10, price: "1000", currency: "UZS" }, META);
    const analyte = await addAnalyte(lab1.ctx, svc, { name: "Hemoglobin", unit: "g/L", refLow: "120", refHigh: "160" }, META);
    const verified = async () => {
      const w = await registerWalkIn(s.reception.ctx, { patientId: s.patientId, doctorProfileId: s.profileId, branchId: s.branch.id }, META);
      const enc = await startVisit(s.doctorCtx, w, META);
      const { id } = await createLabOrder(s.doctorCtx, enc, { serviceIds: [svc] }, META);
      await collectSpecimen(nurse.ctx, id, META);
      const item = (await getLabOrder(lab1.ctx, id, META)).items[0]!;
      await enterResults(lab1.ctx, id, { [`${item.id}:${analyte}`]: "99.5" }, META);
      await verifyResults(lab2.ctx, id, META);
      return id;
    };
    const first = await verified();
    await releaseLabOrder(s.doctorCtx, first, META);
    expect((await s.log()).filter((r) => r.kind === "RESULTS_READY")).toEqual([]); // no portal account

    const { code } = await issuePortalCode(s.reception.ctx, s.patientId, { consentMethod: "PAPER_SIGNED" }, META);
    await activatePortalAccount((await portalTenant(s.a.slug))!, { code, birthDate: "1990-02-03", phone: s.phone, password: PW, confirmPassword: PW }, META);
    const second = await verified();
    await releaseLabOrder(s.doctorCtx, second, META);
    await processDueNotifications(s.a.tenantId);
    expect((await s.log()).find((r) => r.kind === "RESULTS_READY")).toMatchObject({ status: "SENT", subjectId: second });
    const text = smsFilesFor(s.phone).find((t) => t.includes(`/p/${s.a.slug}`))!;
    expect(text).toBeDefined();
    expect(text).not.toContain("99.5");
    expect(text).not.toContain(second);
  });

  it("the outbox is clinic-only data", async () => {
    const s = await setup();
    const platform = new pg.Client({ connectionString: process.env.PLATFORM_DATABASE_URL });
    const portal = new pg.Client({ connectionString: process.env.PORTAL_DATABASE_URL });
    await Promise.all([platform.connect(), portal.connect()]);
    try {
      for (const c of [platform, portal]) {
        for (const t of ["Notification", "NotificationSettings"]) await expect(c.query(`SELECT 1 FROM "${t}" LIMIT 1`)).rejects.toThrow(/permission denied/);
      }
    } finally {
      await Promise.all([platform.end(), portal.end()]);
    }
    const other = await setup();
    await s.consent("SMS_REMINDERS");
    await s.book(s.at(3));
    expect(await other.log()).toEqual([]);
  });
});

describe("FHIR R4 export", () => {
  it("exports the treating doctor's patient as a standards-coded bundle; others cannot; audited", async () => {
    const s = await setup();
    const w = await registerWalkIn(s.reception.ctx, { patientId: s.patientId, doctorProfileId: s.profileId, branchId: s.branch.id }, META);
    const enc = await startVisit(s.doctorCtx, w, META);
    await addDiagnosis(s.doctorCtx, enc, { icd10Code: "J06.9", description: "Synthetic acute URI", kind: "PRIMARY" }, META);
    await addAllergy(s.doctorCtx, s.patientId, { substance: "Synthetic penicillin", severity: "SEVERE", reaction: "" }, META);
    await recordVitals(s.doctorCtx, s.patientId, { TEMPERATURE: "37,8", HEART_RATE: "88" }, META, { encounterId: enc });

    const bundle = await exportPatientFhir(s.doctorCtx, s.patientId, META);
    expect(bundle).toMatchObject({ resourceType: "Bundle", type: "collection" });
    const types = bundle.entry.map((e) => e.resource.resourceType).sort();
    expect(types).toEqual(["AllergyIntolerance", "Condition", "Encounter", "Observation", "Observation", "Patient"]);
    // Only the fields these assertions read.
    type Res = { identifier: unknown[]; gender: string; criticality: string; code: { coding: { code: string }[] }; valueQuantity: unknown; encounter: unknown };
    const byType = (t: string) => bundle.entry.filter((e) => e.resource.resourceType === t).map((e) => e.resource as unknown as Res);
    const patient = byType("Patient")[0]!;
    expect(patient.identifier[0]).toEqual({ use: "usual", system: `urn:itopmed:${s.a.slug}:mrn`, value: s.mrn });
    expect(patient.gender).toBe("female");
    expect(byType("Condition")[0]!.code.coding[0]).toEqual({ system: "http://hl7.org/fhir/sid/icd-10", code: "J06.9", display: "Synthetic acute URI" });
    expect(byType("AllergyIntolerance")[0]!.criticality).toBe("high");
    const temp = byType("Observation").find((o) => o.code.coding[0]?.code === "8310-5")!;
    expect(temp.valueQuantity).toEqual({ value: 37.8, unit: "Cel", system: "http://unitsofmeasure.org", code: "Cel" });
    expect(temp.encounter).toEqual({ reference: `urn:uuid:${enc}` });
    expect(bundle.entry.every((e) => e.fullUrl === `urn:uuid:${e.resource.id}`)).toBe(true);

    // Front desk has no EMR access; a doctor without a care relationship cannot export (not even via break-the-glass).
    await expect(exportPatientFhir(s.reception.ctx, s.patientId, META)).rejects.toThrow("errors.forbidden");
    const other = await staff(s.a, ["doctor"]);
    await saveDoctorProfile(s.a.ctx, other.membershipId, { specialty: "therapy", defaultSlotMinutes: 20, acceptsOnlineBooking: false }, META);
    await expect(exportPatientFhir(other.ctx, s.patientId, META)).rejects.toThrow("errors.noCareRelationship");

    const c = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await c.connect();
    const audit = await c.query(`SELECT metadata FROM "AuditEvent" WHERE action = 'emr.exported_fhir' AND "entityId" = $1`, [s.patientId]);
    await c.end();
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].metadata).toEqual({ resources: 6 });
  });
});
