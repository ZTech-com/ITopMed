import pg from "pg";
import { describe, expect, it } from "vitest";
import { subscriptionDue } from "@/server/clinic/subscription";
import { platformDb } from "@/server/db";
import {
  billingOverview,
  clinicActivity,
  clinicBalances,
  generateMonthlyInvoices,
  recordClinicPayment,
  suspendOverdueClinics,
  voidClinicPayment,
} from "@/server/platform/billing";
import { changeTenantStatus } from "@/server/tenancy/provisioning";
import { META, clinicWithOwner, platformActor, uniq } from "./helpers/fixtures";

// Synthetic plan and clinic; all amounts are made up (UZS minor units: 100 = 1 so'm).
const PRICE = 50_000_000n; // 500 000 so'm a month

async function payingClinic() {
  const admin = await platformActor();
  const o = await clinicWithOwner(admin);
  const owner = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await owner.connect();
  const code = uniq("plan");
  await owner.query(
    `INSERT INTO "Plan" (id, code, name, "priceMonthlyMinor", currency, modules, "trialDays", "isActive", "updatedAt")
     SELECT gen_random_uuid(), $1, name, $2, 'UZS', modules, 0, true, now() FROM "Plan" WHERE code = 'enterprise'`,
    [code, PRICE.toString()],
  );
  await owner.query(`UPDATE "Subscription" SET "planId" = (SELECT id FROM "Plan" WHERE code = $1), status = 'ACTIVE' WHERE "tenantId" = $2`, [code, o.tenantId]);
  await owner.end();
  await changeTenantStatus(admin, o.tenantId, "activate", undefined, META);
  return { admin, o };
}

describe("ITop Med billing of clinics", () => {
  it("issues one invoice per clinic and month, settles oldest first, warns the clinic, then suspends it", async () => {
    const { admin, o } = await payingClinic();
    const jan = new Date("2026-01-15T10:00:00Z");
    await generateMonthlyInvoices(jan);
    await generateMonthlyInvoices(jan); // idempotent
    await generateMonthlyInvoices(new Date("2026-02-03T10:00:00Z"));
    const invoices = await platformDb().clinicInvoice.findMany({ where: { tenantId: o.tenantId }, orderBy: { periodStart: "asc" } });
    expect(invoices.map((i) => [i.periodStart.toISOString().slice(0, 10), i.amountMinor])).toEqual([
      ["2026-01-01", PRICE],
      ["2026-02-01", PRICE],
    ]);

    const feb20 = new Date("2026-02-20T10:00:00Z");
    let b = (await clinicBalances(o.tenantId, feb20)).get(o.tenantId)!;
    expect(b.debtMinor).toBe(PRICE * 2n);
    expect(b.oldestUnpaidDue?.toISOString().slice(0, 10)).toBe("2026-01-11");
    expect(b.overdueDays).toBe(40);

    // Only the SuperAdmin records money; a part payment closes January first.
    await expect(recordClinicPayment(await platformActor("BILLING"), o.tenantId, { amount: "500000", method: "CASH", receivedOn: "2026-02-18" }, META)).rejects.toThrow("errors.forbidden");
    await expect(recordClinicPayment(admin, o.tenantId, { amount: "-5", method: "CASH", receivedOn: "2026-02-18" }, META)).rejects.toThrow();
    await recordClinicPayment(admin, o.tenantId, { amount: "500 000", method: "TRANSFER", receivedOn: "2026-02-18", note: "synthetic order 1" }, META);
    b = (await clinicBalances(o.tenantId, feb20)).get(o.tenantId)!;
    expect(b.debtMinor).toBe(PRICE);
    expect(b.oldestUnpaidDue?.toISOString().slice(0, 10)).toBe("2026-02-11");
    expect(b.overdueDays).toBe(9);

    // The clinic's manager sees the overdue notice (amount only, its own clinic).
    const due = await subscriptionDue(o.ctx);
    expect(due?.debtMinor).toBe(PRICE);

    // 9 days late < 15: still running; 40 days late: suspended automatically.
    expect(await suspendOverdueClinics(feb20)).toBeGreaterThanOrEqual(0);
    expect((await platformDb().tenant.findUnique({ where: { id: o.tenantId } }))?.status).toBe("ACTIVE");
    expect(await suspendOverdueClinics(new Date("2026-03-20T10:00:00Z"))).toBeGreaterThanOrEqual(1);
    expect((await platformDb().tenant.findUnique({ where: { id: o.tenantId } }))?.status).toBe("SUSPENDED");

    // A voided payment no longer counts.
    const pay = await platformDb().clinicPayment.findFirstOrThrow({ where: { tenantId: o.tenantId } });
    await voidClinicPayment(admin, pay.id, META);
    expect((await clinicBalances(o.tenantId, feb20)).get(o.tenantId)!.debtMinor).toBe(PRICE * 2n);
  });

  it("the console overview is the SuperAdmin's, with activity as counts only", async () => {
    const { admin, o } = await payingClinic();
    await expect(billingOverview(await platformActor("SUPPORT"))).rejects.toThrow("errors.forbidden");
    const view = await billingOverview(admin);
    const row = view.rows.find((r) => r.tenant.id === o.tenantId)!;
    expect(row.activity?.activeStaff).toBe(1);
    expect(row.activity?.lastLoginAt).not.toBeNull();
    const a = (await clinicActivity()).get(o.tenantId)!;
    expect(Object.keys(a).sort()).toEqual(
      ["activeStaff", "appointments30d", "appointmentsToday", "branches", "invoices30d", "lastLoginAt", "newPatients30d", "staff30d", "staff7d", "tenantId"].sort(),
    );
  });

  it("the clinic role cannot read ITop Med's payments", async () => {
    const app = new pg.Client({ host: "localhost", port: Number(process.env.TEST_PG_PORT ?? "54339"), user: "itopmed_app", password: "test-app", database: "itopmed" });
    await app.connect();
    await expect(app.query(`SELECT * FROM "ClinicPayment"`)).rejects.toThrow(/permission denied/);
    await expect(app.query(`SELECT * FROM "ClinicInvoice"`)).rejects.toThrow(/permission denied/);
    await app.end();
  });
});
