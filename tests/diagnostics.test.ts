import { describe, expect, it } from "vitest";
import { parseDiagnosticData, sniffFileType } from "@/lib/diagnostics";
import { registerWalkIn } from "@/server/appointments/appointments";
import { inviteStaff, listBranches, listStaff } from "@/server/clinic/admin";
import { saveDoctorProfile } from "@/server/clinic/doctors";
import { addDiagnosticFile, addDiagnosticResult, diagnosticForPrint, getDiagnosticFile, listDiagnosticResults, markDiagnosticError } from "@/server/emr/diagnostics";
import { addPrescription } from "@/server/emr/prescriptions";
import { getEncounter, setNextVisit, startVisit } from "@/server/emr/record";
import { registerPatient } from "@/server/patients/patients";
import { acceptInvitation } from "@/server/tenancy/invitations";
import { META, PASSWORD, clinicContext, clinicWithOwner, platformActor, uniq } from "./helpers/fixtures";

async function staff(o: Awaited<ReturnType<typeof clinicWithOwner>>, roleKeys: string[]) {
  const email = `${uniq("s")}@clinic.test`;
  const inv = await inviteStaff(o.ctx, { fullName: `Synthetic ${roleKeys.join(" ")}`, email, roleKeys }, META);
  await acceptInvitation(inv.token, { fullName: "Synthetic Staff", password: PASSWORD, confirmPassword: PASSWORD }, META);
  const m = (await listStaff(o.ctx)).members.find((x) => x.user.email === email)!;
  return { membershipId: m.id, ctx: await clinicContext(email, o.slug) };
}

// Minimal valid file headers (synthetic content).
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const PDF = new TextEncoder().encode("%PDF-1.4 synthetic");
const EXE = new TextEncoder().encode("MZ synthetic");

async function setup() {
  const o = await clinicWithOwner(await platformActor());
  const [branch] = await listBranches(o.ctx);
  const doctor = await staff(o, ["doctor"]);
  const other = await staff(o, ["doctor"]);
  const desk = await staff(o, ["receptionist"]);
  const profileId = await saveDoctorProfile(o.ctx, doctor.membershipId, { specialty: "cardiology", defaultSlotMinutes: 20, acceptsOnlineBooking: false, contactPhone: "+998 90 000 00 00", contactTelegram: "https://t.me/synthetic_dr" }, META);
  const reg = await registerPatient(desk.ctx, { lastName: "Sintetik", firstName: "Diagnostika", birthDate: "1965", sex: "MALE" }, { confirmNotDuplicate: true }, META);
  if (!reg.ok) throw new Error("duplicate");
  const appointmentId = await registerWalkIn(desk.ctx, { patientId: reg.id, doctorProfileId: profileId, branchId: branch!.id, serviceId: "", adminNote: "" }, META);
  const encounterId = await startVisit(doctor.ctx, appointmentId, META);
  return { o, doctor, other, desk, patientId: reg.id, encounterId };
}

describe("diagnostic studies", () => {
  it("field registry validates numbers; file type comes from the bytes", () => {
    expect(parseDiagnosticData("ECHO", { lvef: "55", lvedd: "48,5", valves: "Synthetic MR I" })).toEqual({ data: { lvef: 55, lvedd: 48.5, valves: "Synthetic MR I" }, errors: [] });
    expect(parseDiagnosticData("ECHO", { lvef: "150" }).errors).toEqual(["lvef"]);
    expect([sniffFileType(PNG), sniffFileType(PDF), sniffFileType(EXE)]).toEqual(["image/png", "application/pdf", null]);
  });

  it("doctor enters an echo with files; print and view are audited; receptionist sees nothing; errors are marked, not deleted", async () => {
    const { doctor, other, desk, patientId, encounterId } = await setup();
    await expect(addDiagnosticResult(doctor.ctx, patientId, { kind: "ECHO", title: "ExoKG", conclusion: "Synthetic", lvef: "999" }, META)).rejects.toThrow("errors.diagnosticValue");
    const id = await addDiagnosticResult(doctor.ctx, patientId, { kind: "ECHO", title: "ExoKG", conclusion: "Synthetic: chap qorincha funksiyasi saqlangan", encounterId, lvef: "58", lvedd: "49" }, META);
    await addDiagnosticFile(doctor.ctx, id, { name: "echo.png", bytes: PNG }, META);
    await addDiagnosticFile(doctor.ctx, id, { name: "report.pdf", bytes: PDF }, META);
    await expect(addDiagnosticFile(doctor.ctx, id, { name: "virus.png", bytes: EXE }, META)).rejects.toThrow("errors.fileType");

    const list = await listDiagnosticResults(doctor.ctx, patientId, META);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: "ECHO", data: { lvef: 58, lvedd: 49 } });
    expect(list[0]!.files.map((f) => f.mimeType)).toEqual(["image/png", "application/pdf"]);
    const file = await getDiagnosticFile(doctor.ctx, list[0]!.files[0]!.id, META);
    expect(file.mimeType).toBe("image/png");
    expect((await diagnosticForPrint(doctor.ctx, id, META)).result.title).toBe("ExoKG");

    await expect(listDiagnosticResults(desk.ctx, patientId, META)).rejects.toThrow();
    await expect(addDiagnosticResult(desk.ctx, patientId, { kind: "ECG", title: "EKG", conclusion: "x" }, META)).rejects.toThrow("errors.forbidden");
    // Only the author marks a result as entered in error.
    await expect(markDiagnosticError(other.ctx, id, META)).rejects.toThrow("errors.forbidden");
    await markDiagnosticError(doctor.ctx, id, META);
    expect((await listDiagnosticResults(doctor.ctx, patientId, META))[0]!.enteredInErrorAt).not.toBeNull();
    await expect(addDiagnosticFile(doctor.ctx, id, { name: "late.png", bytes: PNG }, META)).rejects.toThrow("errors.invalidTransition");
  });

  it("conclusion details: next visit, intake times, doctor's contact", async () => {
    const { o, doctor, patientId, encounterId } = await setup();
    await expect(setNextVisit(doctor.ctx, encounterId, { nextVisitDate: "2000-01-01" }, META)).rejects.toThrow("errors.nextVisitPast");
    await setNextVisit(doctor.ctx, encounterId, { nextVisitDate: "2099-12-01" }, META);
    await expect(addPrescription(doctor.ctx, encounterId, { drug: "Bisoprolol 5 mg", dose: "1 tabletka", frequency: "kuniga 1 marta", times: "25:00" }, META)).rejects.toThrow();
    await addPrescription(doctor.ctx, encounterId, { drug: "Bisoprolol 5 mg", dose: "1 tabletka", frequency: "kuniga 2 marta", times: "20:00; 8:00" }, META);
    const e = (await getEncounter(doctor.ctx, encounterId, META)).encounter;
    expect(e.nextVisitDate?.toISOString().slice(0, 10)).toBe("2099-12-01");
    expect(e.prescriptions[0]!.times).toBe("08:00, 20:00");
    const profile = await (await import("@/server/db")).withAppContext({ tenantId: o.ctx.tenant.id }, (tx) => tx.doctorProfile.findFirst({ where: { contactTelegram: { not: null } }, select: { contactTelegram: true, contactPhone: true } }));
    expect(profile).toEqual({ contactTelegram: "@synthetic_dr", contactPhone: "+998 90 000 00 00" });
    void patientId;
  });
});
