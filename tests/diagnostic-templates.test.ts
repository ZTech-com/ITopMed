import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { bodySurfaceArea } from "@/lib/calculators";
import { fieldLines, flagOf, parseFieldLines, parseTemplateContent, renderReport, unknownPlaceholders } from "@/lib/diagnostic-template";
import { applyClinicExtras, clinicSpecSchema } from "../scripts/lib/create-clinic";
import { registerWalkIn } from "@/server/appointments/appointments";
import { addStaffMember, listBranches, listStaff } from "@/server/clinic/admin";
import { saveDoctorProfile } from "@/server/clinic/doctors";
import { listTemplates, saveTemplate } from "@/server/clinic/templates";
import { withAppContext } from "@/server/db";
import { addDiagnosticResult, diagnosticForPrint } from "@/server/emr/diagnostics";
import { startVisit } from "@/server/emr/record";
import { registerPatient } from "@/server/patients/patients";
import { META, PASSWORD, clinicContext, clinicWithOwner, platformActor, uniq } from "./helpers/fixtures";

const SPEC = JSON.parse(fs.readFileSync("scripts/deploy/clinics/farhod-medservis.json", "utf8"));

describe("diagnostic template format", () => {
  it("parses fields, keeps the clinic's ranges, flags values and renders the report", () => {
    const { fields, badLines } = parseFieldLines("fhr | Yurak urishi | marta | 115-160 |\nmovements | Harakati |  |  | me'yorda\n\nbad key | x\nfhr | duplicate");
    expect(badLines).toEqual([4, 5]);
    expect(fields).toEqual([
      { key: "fhr", label: "Yurak urishi", unit: "marta", min: 115, max: 160 },
      { key: "movements", label: "Harakati", normal: "me'yorda" },
    ]);
    expect(parseFieldLines(fieldLines(fields)).fields).toEqual(fields);
    expect([flagOf(fields[0]!, "170"), flagOf(fields[0]!, "100"), flagOf(fields[0]!, "140"), flagOf(fields[1]!, "yo'q")]).toEqual(["HIGH", "LOW", null, null]);
    expect(unknownPlaceholders("{{fhr}} {{nope}}", fields)).toEqual(["nope"]);
    const r = renderReport("Yurak urishi {{fhr}} marta, harakati {{movements}}.\nFaqat {{nope}}\nOddiy qator", { fhr: "140", movements: "me'yorda" });
    expect(r.text).toBe("Yurak urishi 140 marta, harakati me'yorda.\nOddiy qator");
    expect(r.parts[0]!.find((p) => p.key === "fhr")?.text).toBe("140");
  });

  it("the Farhod MedServis II-III trimester form is a valid template with only the form's own norms", () => {
    const t = SPEC.diagnosticTemplates[0];
    const { fields, badLines } = parseFieldLines(t.fields);
    expect(badLines).toEqual([]);
    expect(unknownPlaceholders(t.body, fields)).toEqual([]);
    const ranged = fields.filter((f) => f.min !== undefined);
    expect(ranged.map((f) => [f.key, f.min, f.max])).toEqual([
      ["fhr", 115, 160],
      ["placentaToOs", 50, 70],
    ]);
  });

  it("body surface area (Mosteller): 180 cm, 80 kg -> 2.0 m²", () => {
    expect(bodySurfaceArea({ heightCm: 180, weightKg: 80 })).toMatchObject({ ok: true, value: { bsa: 2 } });
    expect(bodySurfaceArea({ heightCm: 180 }).ok).toBe(false);
  });
});

describe("clinic templates in use", () => {
  it("applies the spec to a live clinic once; a doctor records a result with it; past reports keep their template", async () => {
    const o = await clinicWithOwner(await platformActor());
    const spec = clinicSpecSchema.parse({ ...SPEC, slug: o.slug, name: "Synthetic" });
    const first = await applyClinicExtras(spec);
    expect(first.templatesAdded).toBe(1);
    expect(first.letterhead).toEqual(expect.arrayContaining(["legalName", "licenseText"]));
    expect(await applyClinicExtras(spec)).toEqual({ templatesAdded: 0, letterhead: [] });

    const tpl = (await listTemplates(o.ctx, { kind: "DIAGNOSTIC" }))[0]!;
    expect(parseTemplateContent(tpl.content)?.study).toBe("ULTRASOUND");
    // Editing: a broken field list is refused.
    await expect(saveTemplate(o.ctx, tpl.id, { kind: "DIAGNOSTIC", name: tpl.name, study: "ULTRASOUND", fieldsText: "bad key | x", body: "{{x}}" }, META)).rejects.toThrow();

    const login = uniq("doc");
    await addStaffMember(o.ctx, { fullName: "Synthetic Doctor", username: login, roleKeys: ["doctor"], password: PASSWORD }, META);
    const m = (await listStaff(o.ctx)).members.find((x) => x.user.username === login)!;
    const doctor = await clinicContext(login, o.slug);
    const profileId = await saveDoctorProfile(o.ctx, m.id, { specialty: "cardiology", defaultSlotMinutes: 20, acceptsOnlineBooking: false }, META);
    const [branch] = await listBranches(o.ctx);
    const recEmail = uniq("rec");
    await addStaffMember(o.ctx, { fullName: "Synthetic Reception", username: recEmail, roleKeys: ["receptionist"], password: PASSWORD }, META);
    const desk = await clinicContext(recEmail, o.slug);
    const reg = await registerPatient(desk, { lastName: "Sintetik", firstName: "Homilador", birthDate: "1995", sex: "FEMALE" }, { confirmNotDuplicate: true }, META);
    if (!reg.ok) throw new Error("duplicate");
    const appointmentId = await registerWalkIn(desk, { patientId: reg.id, doctorProfileId: profileId, branchId: branch!.id, serviceId: "", adminNote: "" }, META);
    await startVisit(doctor, appointmentId, META);

    await expect(addDiagnosticResult(doctor, reg.id, { kind: "OTHER", templateId: tpl.id, title: "UTT", conclusion: "Synthetic", f_fhr: "tez" }, META)).rejects.toThrow("errors.diagnosticValue");
    const id = await addDiagnosticResult(doctor, reg.id, { kind: "OTHER", templateId: tpl.id, title: "UTT", conclusion: "Synthetic", f_fhr: "172", f_movements: "me'yorda", f_fetusCount: "1" }, META);
    // The clinic later changes its template: the saved report does not change.
    await withAppContext({ tenantId: o.ctx.tenant.id }, (tx) => tx.clinicTemplate.update({ where: { id: tpl.id }, data: { content: JSON.stringify({ study: "ULTRASOUND", fields: [{ key: "x", label: "X" }], body: "{{x}}" }) } }));
    const printed = await diagnosticForPrint(doctor, id, META);
    expect(printed.result.kind).toBe("ULTRASOUND");
    const snap = printed.result.templateSnapshot as { fields: { key: string; min?: number; max?: number }[]; body: string };
    expect(snap.fields.find((f) => f.key === "fhr")).toMatchObject({ min: 115, max: 160 });
    expect(flagOf(snap.fields.find((f) => f.key === "fhr")! as never, printed.result.data.fhr)).toBe("HIGH");
    expect(renderReport(snap.body, printed.result.data as Record<string, string>).text).toContain("1 daqiqada 172 marta");
  });
});
