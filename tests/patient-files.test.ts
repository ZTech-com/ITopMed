import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { colName, excelDate, writeXlsx } from "@/lib/xlsx";
import { inviteStaff, listBranches, listStaff } from "@/server/clinic/admin";
import { getDataSettings, isLocalOnly, saveDataMode, savePatientFiles, syncPatientFiles } from "@/server/clinic/data-mode";
import { saveDoctorProfile } from "@/server/clinic/doctors";
import { importPriceList } from "@/server/clinic/price-list";
import { listServices } from "@/server/clinic/resources";
import { withAppContext } from "@/server/db";
import { exportAllPatients, exportPatientWorkbook, patientFileName } from "@/server/emr/patient-file";
import { addDiagnosis, startVisit } from "@/server/emr/record";
import { deskCheckIn } from "@/server/reception/desk";
import { acceptInvitation } from "@/server/tenancy/invitations";
import { META, PASSWORD, clinicContext, clinicWithOwner, platformActor, uniq } from "./helpers/fixtures";

async function staff(o: Awaited<ReturnType<typeof clinicWithOwner>>, roleKeys: string[]) {
  const email = `${uniq("s")}@clinic.test`;
  const inv = await inviteStaff(o.ctx, { fullName: `Synthetic ${roleKeys.join(" ")}`, email, roleKeys }, META);
  await acceptInvitation(inv.token, { fullName: "Synthetic Head Doctor", password: PASSWORD, confirmPassword: PASSWORD }, META);
  const m = (await listStaff(o.ctx)).members.find((x) => x.user.email === email)!;
  return { email, membershipId: m.id, ctx: await clinicContext(email, o.slug) };
}

const sheetsOf = (bytes: Uint8Array) => {
  const files = unzipSync(bytes);
  return Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strFromU8(v)]));
};

afterEach(() => {
  delete process.env.LOCAL_MODE;
});

describe("xlsx writer", () => {
  it("writes a valid package; text that looks like a formula stays text", () => {
    const out = sheetsOf(writeXlsx([{ name: "Karta/1", columns: [10], rows: [{ cells: ["=HYPERLINK(\"x\")", 42, { v: "a < b & c", s: "wrap" }] }] }]));
    expect(Object.keys(out)).toEqual(expect.arrayContaining(["[Content_Types].xml", "xl/workbook.xml", "xl/styles.xml", "xl/worksheets/sheet1.xml"]));
    const sheet = out["xl/worksheets/sheet1.xml"]!;
    expect(sheet).toContain('t="inlineStr"><is><t xml:space="preserve">=HYPERLINK(&quot;x&quot;)</t>');
    expect(sheet).not.toContain("<f>");
    expect(sheet).toContain("a &lt; b &amp; c");
    expect(out["xl/workbook.xml"]).toContain('name="Karta 1"');
  });

  it("columns and dates", () => {
    expect([colName(0), colName(25), colName(26), colName(701)]).toEqual(["A", "Z", "AA", "ZZ"]);
    expect(excelDate(new Date(Date.UTC(2026, 0, 1)))).toBe(46023);
    // 2026-01-01 00:00 UTC is 05:00 in Tashkent.
    expect(excelDate(new Date(Date.UTC(2026, 0, 1)), "Asia/Tashkent")).toBeCloseTo(46023 + 5 / 24, 6);
  });

  it("file names are safe", () => {
    expect(patientFileName({ mrn: "000123", lastName: "Sintetik/Test", firstName: 'Bemor"', middleName: null })).toBe("000123 - Sintetik Test Bemor.xlsx");
  });
});

describe("patient files", () => {
  async function setup() {
    const o = await clinicWithOwner(await platformActor());
    const [branch] = await listBranches(o.ctx);
    await importPriceList(o.ctx, { text: "Kardiolog ko'ruvi 100 ming\nEKG 30 ming" }, META);
    const services = await listServices(o.ctx);
    const head = await staff(o, ["doctor", "head_doctor", "clinic_admin"]);
    const desk = await staff(o, ["receptionist", "cashier", "nurse"]);
    const profileId = await saveDoctorProfile(o.ctx, head.membershipId, { specialty: "cardiology", defaultSlotMinutes: 20, acceptsOnlineBooking: false }, META);
    const r = await deskCheckIn(
      desk.ctx,
      { lastName: "Sintetik", firstName: "Bemor", birthDate: "1960", sex: "MALE", doctorProfileId: profileId, branchId: branch!.id, serviceIds: services.map((s) => s.id), payMode: "partial", amount: "50000", method: "CASH", SYSTOLIC_BP: "140", DIASTOLIC_BP: "85" },
      META,
    );
    if (!r.ok) throw new Error("duplicate");
    const enc = await startVisit(head.ctx, r.appointmentId, META);
    await addDiagnosis(head.ctx, enc, { icd10Code: "I10", description: "Synthetic essential hypertension", kind: "PRIMARY" }, META);
    return { o, head, desk, patientId: r.patientId };
  }

  it("one patient as an Excel file: card, visit, diagnosis, vitals, debt; access rules apply", async () => {
    const { o, head, patientId } = await setup();
    const { bytes, mrn } = await exportPatientWorkbook(head.ctx, patientId, META);
    expect(mrn).toBeTruthy();
    const x = sheetsOf(bytes);
    const all = Object.entries(x)
      .filter(([k]) => k.startsWith("xl/worksheets/"))
      .map(([, v]) => v)
      .join("\n");
    expect(x["xl/workbook.xml"]).toContain("Karta");
    expect(all).toContain("Sintetik Bemor");
    expect(all).toContain("Synthetic essential hypertension");
    expect(all).toContain("Kardiolog ko'ruvi");
    expect(all).toContain("<v>80000</v>"); // debt: 130 000 - 50 000
    // A receptionist has no access to medical records.
    const reception = await staff(o, ["receptionist"]);
    await expect(exportPatientWorkbook(reception.ctx, patientId, META)).rejects.toThrow("errors.forbidden");
  });

  it("all patients as a ZIP only for oversight access; the owner (no medical access) cannot", async () => {
    const { o, head } = await setup();
    const { bytes, count } = await exportAllPatients(head.ctx, META);
    expect(count).toBe(1);
    const names = Object.keys(unzipSync(bytes));
    expect(names).toHaveLength(2);
    expect(names.some((n) => n.includes("Sintetik Bemor"))).toBe(true);
    await expect(exportAllPatients(o.ctx, META)).rejects.toThrow("errors.forbidden");
  });

  it("local mode exists only in the local app; there it stops outgoing messages and keeps a folder of files", async () => {
    const { o, head, patientId } = await setup();
    // Internet server: always connected, local cannot be chosen.
    expect((await getDataSettings(o.ctx)).mode).toBe("CONNECTED");
    await expect(saveDataMode(o.ctx, { mode: "LOCAL" }, META)).rejects.toThrow("errors.localAppOnly");
    await expect(savePatientFiles(head.ctx, { enabled: true }, META)).rejects.toThrow("errors.localAppOnly");

    process.env.LOCAL_MODE = "1";
    expect((await getDataSettings(o.ctx)).mode).toBe("LOCAL"); // default of the local app
    expect(await withAppContext({ tenantId: o.ctx.tenant.id }, (tx) => isLocalOnly(tx, o.ctx.tenant.id))).toBe(true);
    await saveDataMode(o.ctx, { mode: "CONNECTED" }, META);
    expect(await withAppContext({ tenantId: o.ctx.tenant.id }, (tx) => isLocalOnly(tx, o.ctx.tenant.id))).toBe(false);
    await expect(saveDataMode(head.ctx, { mode: "LOCAL" }, META)).rejects.toThrow("errors.ownerOnly");

    // Folder of files: needs oversight access to records.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "itm-files-"));
    try {
      await expect(savePatientFiles(o.ctx, { enabled: true, dir }, META)).rejects.toThrow("errors.needsHeadDoctor");
      await expect(savePatientFiles(head.ctx, { enabled: true, dir: "relative/folder" }, META)).rejects.toThrow("errors.folderInvalid");
      expect(await savePatientFiles(head.ctx, { enabled: true, dir }, META)).toEqual({ written: 1 });
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".xlsx"));
      expect(files).toHaveLength(2); // the patient + the list
      expect(files.some((f) => f.includes("Sintetik Bemor"))).toBe(true);
      // Nothing changed since: the next pass writes nothing.
      expect(await syncPatientFiles(o.ctx.tenant.id)).toEqual({ written: 0 });
      // The patient changed: only that patient is written again.
      await withAppContext({ tenantId: o.ctx.tenant.id }, (tx) => tx.patient.update({ where: { id: patientId }, data: { address: "Synthetic street 2" } }));
      expect(await syncPatientFiles(o.ctx.tenant.id)).toEqual({ written: 1 });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
