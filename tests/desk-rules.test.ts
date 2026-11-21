import { describe, expect, it } from "vitest";
import { approveDebt, getInvoice } from "@/server/billing/billing";
import { addStaffMember, listBranches, listStaff } from "@/server/clinic/admin";
import { saveDoctorProfile } from "@/server/clinic/doctors";
import { importPriceList } from "@/server/clinic/price-list";
import { listBenefitCategories, saveBenefitCategory, saveFreeFollowUpDays, savePackage } from "@/server/clinic/pricing";
import { listServices } from "@/server/clinic/resources";
import { addStandardTemplates, listTemplates } from "@/server/clinic/templates";
import { withAppContext } from "@/server/db";
import { deskPrintGate, documentForVisit } from "@/server/emr/documents";
import { addDiagnosis, finishEncounter, saveDraft, signNote, startVisit, getEncounter } from "@/server/emr/record";
import { getPatient } from "@/server/patients/patients";
import { deskCheckIn } from "@/server/reception/desk";
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
  await importPriceList(o.ctx, { text: "Kardiolog ko'ruvi 100 ming\nEKG 30 ming\nEXO 120 ming" }, META);
  const services = await listServices(o.ctx);
  const sid = (n: string) => services.find((s) => s.name === n)!.id;
  const desk = await staff(o, ["receptionist"]);
  const cashier = await staff(o, ["cashier"]);
  const frontDesk = await staff(o, ["receptionist", "cashier"]);
  const doctor = await staff(o, ["doctor"]);
  const profileId = await saveDoctorProfile(o.ctx, doctor.membershipId, { specialty: "cardiology", defaultSlotMinutes: 20, acceptsOnlineBooking: false }, META);
  return { o, branchId: branch!.id, sid, desk, cashier, frontDesk, doctor, profileId };
}

const invoiceOf = async (ctx: Parameters<typeof getInvoice>[0], appointmentId: string) =>
  withAppContext({ tenantId: ctx.tenant.id, userId: ctx.principal.user.id }, (tx) => tx.invoice.findUniqueOrThrow({ where: { appointmentId }, include: { lines: true } }));

describe("desk pricing rules", () => {
  it("referral source and benefit category are stored; the category discount applies with its reason", async () => {
    const s = await setup();
    await saveBenefitCategory(s.o.ctx, { name: "Synthetic veterans", discountPercent: 20 }, META);
    const [benefit] = await listBenefitCategories(s.o.ctx);
    const r = await deskCheckIn(
      s.frontDesk.ctx,
      { lastName: "Sintetik", firstName: "Imtiyoz", birthDate: "1950", sex: "MALE", referralSource: "ADVERTISING", referralDetail: "Instagram", benefitCategoryId: benefit!.id, doctorProfileId: s.profileId, branchId: s.branchId, serviceIds: [s.sid("Kardiolog ko'ruvi")], payMode: "full", method: "CARD" },
      META,
    );
    if (!r.ok) throw new Error("duplicate");
    const p = await getPatient(s.frontDesk.ctx, r.patientId, META);
    expect(p).toMatchObject({ referralSource: "ADVERTISING", referralDetail: "Instagram", benefitCategoryId: benefit!.id });
    const inv = await invoiceOf(s.frontDesk.ctx, r.appointmentId);
    expect(inv.totalMinor).toBe(8_000_000n); // 100 000 - 20 %
    expect(inv.lines[0]).toMatchObject({ discountKind: "BENEFIT", discountReason: "Imtiyoz: Synthetic veterans" });
    expect(inv.paidMinor).toBe(8_000_000n);
  });

  it("a package applies when all its services are billed together; the best single rule wins", async () => {
    const s = await setup();
    await savePackage(s.o.ctx, { name: "Synthetic heart check", discountPercent: 10, serviceIds: [s.sid("EKG"), s.sid("EXO")] }, META);
    await expect(savePackage(s.o.ctx, { name: "One", discountPercent: 10, serviceIds: [s.sid("EKG")] }, META)).rejects.toThrow();
    const r = await deskCheckIn(s.frontDesk.ctx, { lastName: "Sintetik", firstName: "Paket", birthDate: "1970", sex: "FEMALE", doctorProfileId: s.profileId, branchId: s.branchId, serviceIds: [s.sid("EKG"), s.sid("EXO")], payMode: "debt" }, META);
    if (!r.ok) throw new Error("duplicate");
    const inv = await invoiceOf(s.frontDesk.ctx, r.appointmentId);
    expect(inv.totalMinor).toBe(13_500_000n); // (30 000 + 120 000) - 10 %
    expect(inv.lines.every((l) => l.discountKind === "PACKAGE")).toBe(true);
  });

  it("follow-up consultation is free within N days; outside it only by exception with reason and permission", async () => {
    const s = await setup();
    const first = await deskCheckIn(s.frontDesk.ctx, { lastName: "Sintetik", firstName: "Qayta", birthDate: "1960", sex: "MALE", doctorProfileId: s.profileId, branchId: s.branchId, serviceIds: [s.sid("Kardiolog ko'ruvi")], payMode: "full", method: "CARD" }, META);
    if (!first.ok) throw new Error("duplicate");
    expect((await invoiceOf(s.frontDesk.ctx, first.appointmentId)).totalMinor).toBe(10_000_000n);

    // A few minutes later (same day) is within 10 days: free, nothing to pay.
    const again = await deskCheckIn(s.frontDesk.ctx, { patientId: first.patientId, doctorProfileId: s.profileId, branchId: s.branchId, serviceIds: [s.sid("Kardiolog ko'ruvi"), s.sid("EKG")], payMode: "full", method: "CARD" }, META);
    if (!again.ok) throw new Error("duplicate");
    const inv2 = await invoiceOf(s.frontDesk.ctx, again.appointmentId);
    expect(inv2.lines.find((l) => l.serviceId === s.sid("Kardiolog ko'ruvi"))).toMatchObject({ discountKind: "FOLLOW_UP", totalMinor: 0n });
    expect(inv2.totalMinor).toBe(3_000_000n); // the ECG is still paid

    // Period switched off: not free any more; the exception needs billing.free_visit and a reason.
    await saveFreeFollowUpDays(s.o.ctx, { freeFollowUpDays: 0 }, META);
    const base = { patientId: first.patientId, doctorProfileId: s.profileId, branchId: s.branchId, serviceIds: [s.sid("Kardiolog ko'ruvi")], payMode: "debt" };
    await expect(deskCheckIn(s.desk.ctx, { ...base, freeVisit: "on", freeVisitReason: "Synthetic reason" }, META)).rejects.toThrow();
    await expect(deskCheckIn(s.frontDesk.ctx, { ...base, freeVisit: "on", freeVisitReason: "" }, META)).rejects.toThrow("errors.freeVisitReasonRequired");
    const exc = await deskCheckIn(s.frontDesk.ctx, { ...base, freeVisit: "on", freeVisitReason: "Synthetic: complication check" }, META);
    if (!exc.ok) throw new Error("duplicate");
    const inv3 = await invoiceOf(s.frontDesk.ctx, exc.appointmentId);
    expect(inv3.lines[0]).toMatchObject({ discountKind: "FOLLOW_UP_EXCEPTION", totalMinor: 0n, discountApprovedById: s.frontDesk.ctx.principal.user.id });
    expect(inv3.lines[0]!.discountReason).toContain("Synthetic: complication check");
  });
});

describe("desk prints final documents only after the cashier", () => {
  it("not before the visit is closed, not while unpaid; after the cashier allows the debt it prints", async () => {
    const s = await setup();
    await addStandardTemplates(s.o.ctx, META);
    const [doc] = await listTemplates(s.o.ctx, { kind: "DOCUMENT" });
    const r = await deskCheckIn(s.frontDesk.ctx, { lastName: "Sintetik", firstName: "Hujjat", birthDate: "1965", sex: "MALE", doctorProfileId: s.profileId, branchId: s.branchId, serviceIds: [s.sid("Kardiolog ko'ruvi")], payMode: "debt" }, META);
    if (!r.ok) throw new Error("duplicate");
    const enc = await startVisit(s.doctor.ctx, r.appointmentId, META);
    expect(await deskPrintGate(s.desk.ctx, enc)).toBe("notFinished");
    const note = (await getEncounter(s.doctor.ctx, enc, META)).encounter.notes[0]!;
    await saveDraft(s.doctor.ctx, note.id, { complaints: "Synthetic", history: "", examination: "", assessment: "Synthetic", plan: "" }, META);
    await signNote(s.doctor.ctx, note.id, { complaints: "Synthetic", history: "", examination: "", assessment: "Synthetic", plan: "" }, META);
    await addDiagnosis(s.doctor.ctx, enc, { icd10Code: "I10", description: "Synthetic", kind: "PRIMARY" }, META);
    await finishEncounter(s.doctor.ctx, enc, META);

    expect(await deskPrintGate(s.desk.ctx, enc)).toBe("unpaid");
    await expect(documentForVisit(s.desk.ctx, enc, doc!.id, META)).rejects.toThrow("errors.deskPrint.unpaid");
    // The registrar cannot allow the debt; the cashier can.
    const inv = await invoiceOf(s.cashier.ctx, r.appointmentId);
    await expect(approveDebt(s.desk.ctx, inv.id, META)).rejects.toThrow();
    await approveDebt(s.cashier.ctx, inv.id, META);
    expect(await deskPrintGate(s.desk.ctx, enc)).toBe("ok");
    const d = await documentForVisit(s.desk.ctx, enc, doc!.id, META);
    expect(d.encounter.patient.firstName).toBe("Hujjat");
  });
});
