import { describe, expect, it } from "vitest";
import { suggestDiagnoses } from "@/lib/dx-suggest";
import { addStaffMember, listBranches, listStaff } from "@/server/clinic/admin";
import { saveDoctorProfile } from "@/server/clinic/doctors";
import { copyPreviousNote, frequentDiagnoses } from "@/server/emr/assist";
import { addNursingRecord, getPatientHistory, listNursingRecords, savePatientHistory } from "@/server/emr/history";
import { addDiagnosis, finishEncounter, getEncounter, recordVitals, saveDraft, signNote, startVisit } from "@/server/emr/record";
import { registerWalkIn } from "@/server/appointments/appointments";
import { checkIn } from "@/server/appointments/appointments";
import { registerPatient } from "@/server/patients/patients";
import { META, PASSWORD, clinicContext, clinicWithOwner, platformActor, uniq } from "./helpers/fixtures";

async function staff(o: Awaited<ReturnType<typeof clinicWithOwner>>, roleKeys: string[]) {
  const login = uniq("s");
  await addStaffMember(o.ctx, { fullName: `Synthetic ${roleKeys.join(" ")}`, username: login, roleKeys, password: PASSWORD }, META);
  const m = (await listStaff(o.ctx)).members.find((x) => x.user.username === login)!;
  return { membershipId: m.id, ctx: await clinicContext(login, o.slug) };
}

async function setup() {
  const o = await clinicWithOwner(await platformActor());
  const [branch] = await listBranches(o.ctx);
  const doctor = await staff(o, ["doctor"]);
  const nurse = await staff(o, ["nurse"]);
  const desk = await staff(o, ["receptionist"]);
  const profileId = await saveDoctorProfile(o.ctx, doctor.membershipId, { specialty: "cardiology", defaultSlotMinutes: 20, acceptsOnlineBooking: false }, META);
  const reg = await registerPatient(desk.ctx, { lastName: "Sintetik", firstName: "Triaj", birthDate: "1960", sex: "FEMALE" }, { confirmNotDuplicate: true }, META);
  if (!reg.ok) throw new Error("duplicate");
  const visit = async () => {
    const appointmentId = await registerWalkIn(desk.ctx, { patientId: reg.id, doctorProfileId: profileId, branchId: branch!.id, serviceId: "", adminNote: "" }, META);
    await checkIn(desk.ctx, appointmentId, META).catch(() => undefined);
    return { appointmentId, encounterId: await startVisit(doctor.ctx, appointmentId, META) };
  };
  return { o, doctor, nurse, desk, patientId: reg.id, visit };
}

describe("anamnesis, triage and the doctor's helpers", () => {
  it("structured anamnesis: doctor writes, receptionist cannot read; pregnancy weeks only with pregnancy", async () => {
    const { doctor, desk, patientId, visit } = await setup();
    await visit();
    await expect(savePatientHistory(doctor.ctx, patientId, { pregnancy: "NO", pregnancyWeeks: "12" }, META)).rejects.toThrow();
    await savePatientHistory(doctor.ctx, patientId, { pregnancy: "YES", pregnancyWeeks: "12", priorMyocardialInfarction: "yes", diabetes: "TYPE2", smoking: "CURRENT", hypertensionYears: "8", surgeries: "Synthetic appendectomy" }, META);
    const h = await getPatientHistory(doctor.ctx, patientId, META);
    expect(h).toMatchObject({ pregnancy: "YES", pregnancyWeeks: 12, priorMyocardialInfarction: true, diabetes: "TYPE2", smoking: "CURRENT", hypertensionYears: 8 });
    await expect(getPatientHistory(desk.ctx, patientId, META)).rejects.toThrow();
    await expect(savePatientHistory(desk.ctx, patientId, { smoking: "NEVER" }, META)).rejects.toThrow("errors.forbidden");
  });

  it("triage: both arms, waist; first aid and medication are logged (append-only), drug required for medication", async () => {
    const { nurse, desk, patientId, visit } = await setup();
    const { appointmentId } = await visit();
    await recordVitals(nurse.ctx, patientId, { SYSTOLIC_BP: "150", DIASTOLIC_BP: "95", SYSTOLIC_BP_LEFT: "135", DIASTOLIC_BP_LEFT: "85", WAIST: "102", SPO2: "97" }, META);
    await expect(addNursingRecord(nurse.ctx, patientId, { kind: "MEDICATION", text: "Synthetic" }, META)).rejects.toThrow("errors.drugRequired");
    await addNursingRecord(nurse.ctx, patientId, { kind: "MEDICATION", text: "Synthetic: bosim baland", drug: "Kaptopril", dose: "25 mg", route: "til ostiga", appointmentId }, META);
    await addNursingRecord(nurse.ctx, patientId, { kind: "FIRST_AID", text: "Synthetic: yotqizildi" }, META);
    const log = await listNursingRecords(nurse.ctx, patientId, META);
    expect(log.map((r) => r.kind)).toEqual(["FIRST_AID", "MEDICATION"]);
    expect(log[1]).toMatchObject({ drug: "Kaptopril", dose: "25 mg" });
    await expect(addNursingRecord(desk.ctx, patientId, { kind: "NOTE", text: "x" }, META)).rejects.toThrow("errors.forbidden");
  });

  it("copy previous note fills only empty sections; diagnosis stage; frequent diagnoses", async () => {
    const { doctor, visit } = await setup();
    const first = await visit();
    const e1 = await getEncounter(doctor.ctx, first.encounterId, META);
    const d1 = e1.encounter.notes.find((n) => n.status === "DRAFT")!;
    await saveDraft(doctor.ctx, d1.id, { complaints: "Synthetic bosh og'rig'i", history: "Synthetic 5 yil", examination: "Synthetic tonlar aniq", assessment: "Synthetic AG", plan: "Synthetic dieta" }, META);
    await signNote(doctor.ctx, d1.id, { complaints: "Synthetic bosh og'rig'i", history: "Synthetic 5 yil", examination: "Synthetic tonlar aniq", assessment: "Synthetic AG", plan: "Synthetic dieta" }, META);
    await addDiagnosis(doctor.ctx, first.encounterId, { icd10Code: "I10", description: "Synthetic gipertenziya", kind: "PRIMARY", stage: "II daraja" }, META);
    await finishEncounter(doctor.ctx, first.encounterId, META);

    const second = await visit();
    const e2 = await getEncounter(doctor.ctx, second.encounterId, META);
    const d2 = e2.encounter.notes.find((n) => n.status === "DRAFT")!;
    await saveDraft(doctor.ctx, d2.id, { complaints: "Synthetic yangi shikoyat", history: "", examination: "", assessment: "", plan: "" }, META);
    expect(await copyPreviousNote(doctor.ctx, second.encounterId, META)).toBe(true);
    const after = (await getEncounter(doctor.ctx, second.encounterId, META)).encounter.notes.find((n) => n.id === d2.id)!;
    expect(after.complaints).toBe("Synthetic yangi shikoyat");
    expect(after.examination).toBe("Synthetic tonlar aniq");
    expect(e2.encounter.diagnoses.length).toBe(0);
    const dx = (await getEncounter(doctor.ctx, first.encounterId, META)).encounter.diagnoses[0]!;
    expect(dx.stage).toBe("II daraja");
    expect(await frequentDiagnoses(doctor.ctx)).toEqual([{ icd10Code: "I10", description: "Synthetic gipertenziya", uses: 1 }]);
  });
});

describe("tentative diagnoses", () => {
  it("only from measured or recorded facts, never repeating a recorded code", () => {
    expect(suggestDiagnoses({ systolic: 150, diastolic: 95, weightKg: 95, heightCm: 170, diabetes: "TYPE2", priorMyocardialInfarction: true, smoking: "CURRENT", existing: [] }).map((s) => s.code)).toEqual(["I10", "E66", "E11", "I25.2", "Z72.0"]);
    expect(suggestDiagnoses({ systolic: 130, diastolic: 80, existing: [] })).toEqual([]);
    // The higher-reading arm counts.
    expect(suggestDiagnoses({ systolic: 130, diastolic: 80, systolicLeft: 145, diastolicLeft: 85, existing: [] })[0]).toMatchObject({ code: "I10", reason: { values: { bp: "145/85" } } });
    expect(suggestDiagnoses({ systolic: 160, diastolic: 100, existing: ["I11.9"] })).toEqual([]);
  });
});
