import "server-only";
import { z } from "zod";
import { parseMoney } from "@/lib/money";
import { recordAudit } from "../audit";
import type { PlatformPrincipal, RequestMeta } from "../auth/platform-auth";
import { platformDb, withPlatform } from "../db";
import { DomainError } from "../errors";
import { logger } from "../logger";
import { hashIp, uuidv7 } from "../security/crypto";

/**
 * ITop Med's own billing of clinics, run by the SuperAdmin from the console:
 *  - one invoice per clinic and calendar month from its plan price (only for
 *    ACTIVE clinics with an ACTIVE subscription and a non-zero price);
 *  - payments are entered by hand and settle the oldest invoices first;
 *  - debt = invoices - payments; a clinic is overdue when its oldest unpaid
 *    invoice is past due; `suspendAfterDays` later it is suspended automatically
 *    (if enabled). Reactivation is always a person's decision.
 * Amounts are integer minor units (see src/lib/money.ts).
 */

const DAY = 86_400_000;

function requireSuperAdmin(actor: PlatformPrincipal) {
  if (actor.user.role !== "SUPER_ADMIN") throw new DomainError("errors.forbidden");
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const dateOnly = (s: string) => new Date(`${s}T00:00:00Z`);

/** First and last day of the calendar month of `now` (UTC dates). */
export function monthOf(now: Date): { start: Date; end: Date; key: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { start, end, key: `${start.getUTCFullYear()}${String(start.getUTCMonth() + 1).padStart(2, "0")}` };
}

export async function billingSettings() {
  return platformDb().billingSettings.findUniqueOrThrow({ where: { id: 1 } });
}

/** Creates this month's invoice for every billable clinic that has none yet. Safe to call repeatedly. */
export async function generateMonthlyInvoices(now = new Date()): Promise<number> {
  const { start, end, key } = monthOf(now);
  const settings = await billingSettings();
  const subs = await platformDb().subscription.findMany({
    where: { status: "ACTIVE", tenant: { status: "ACTIVE" }, plan: { priceMonthlyMinor: { gt: 0 } } },
    select: { tenantId: true, tenant: { select: { slug: true } }, plan: { select: { priceMonthlyMinor: true, currency: true } } },
  });
  if (subs.length === 0) return 0;
  const due = new Date(start.getTime() + settings.dueDays * DAY);
  const created = await withPlatform(async (tx) => {
    const r = await tx.clinicInvoice.createMany({
      data: subs.map((s) => ({
        id: uuidv7(),
        tenantId: s.tenantId,
        number: `ITM-${key}-${s.tenant.slug}`,
        periodStart: start,
        periodEnd: end,
        amountMinor: s.plan.priceMonthlyMinor,
        currency: s.plan.currency,
        dueDate: due,
      })),
      skipDuplicates: true,
    });
    if (r.count > 0) await recordAudit(tx, { actorType: "SYSTEM", action: "billing.invoices_generated", metadata: { month: key, count: r.count } });
    return r.count;
  });
  return created;
}

export interface ClinicBalance {
  tenantId: string;
  invoicedMinor: bigint;
  paidMinor: bigint;
  debtMinor: bigint;
  currency: string;
  /** Due date of the oldest invoice payments have not covered (null = nothing unpaid). */
  oldestUnpaidDue: Date | null;
  /** Whole days past that due date (0 = not overdue). */
  overdueDays: number;
}

/** Balances of all clinics (or one), payments settling the oldest invoices first. */
export async function clinicBalances(tenantId?: string, now = new Date()): Promise<Map<string, ClinicBalance>> {
  const where = { voidedAt: null, ...(tenantId ? { tenantId } : {}) };
  const [invoices, payments] = await Promise.all([
    platformDb().clinicInvoice.findMany({ where, orderBy: { periodStart: "asc" }, select: { tenantId: true, amountMinor: true, currency: true, dueDate: true } }),
    platformDb().clinicPayment.groupBy({ by: ["tenantId"], where, _sum: { amountMinor: true } }),
  ]);
  const paid = new Map(payments.map((p) => [p.tenantId, p._sum.amountMinor ?? 0n]));
  const out = new Map<string, ClinicBalance>();
  const today = dateOnly(isoDate(now));
  for (const inv of invoices) {
    const b = out.get(inv.tenantId) ?? { tenantId: inv.tenantId, invoicedMinor: 0n, paidMinor: paid.get(inv.tenantId) ?? 0n, debtMinor: 0n, currency: inv.currency, oldestUnpaidDue: null, overdueDays: 0 };
    b.invoicedMinor += inv.amountMinor;
    if (!b.oldestUnpaidDue && b.invoicedMinor > b.paidMinor) b.oldestUnpaidDue = inv.dueDate;
    out.set(inv.tenantId, b);
  }
  for (const [id, p] of paid) if (!out.has(id)) out.set(id, { tenantId: id, invoicedMinor: 0n, paidMinor: p, debtMinor: 0n, currency: "UZS", oldestUnpaidDue: null, overdueDays: 0 });
  for (const b of out.values()) {
    b.debtMinor = b.invoicedMinor > b.paidMinor ? b.invoicedMinor - b.paidMinor : 0n;
    b.overdueDays = b.oldestUnpaidDue && b.oldestUnpaidDue < today ? Math.floor((today.getTime() - b.oldestUnpaidDue.getTime()) / DAY) : 0;
  }
  return out;
}

/**
 * Suspends ACTIVE clinics whose oldest unpaid invoice is more than
 * `suspendAfterDays` past due (when auto-suspension is on). Returns how many.
 */
export async function suspendOverdueClinics(now = new Date()): Promise<number> {
  const settings = await billingSettings();
  if (!settings.autoSuspend) return 0;
  const balances = await clinicBalances(undefined, now);
  const overdue = [...balances.values()].filter((b) => b.debtMinor > 0n && b.overdueDays > settings.suspendAfterDays).map((b) => b.tenantId);
  if (overdue.length === 0) return 0;
  let n = 0;
  for (const tenantId of overdue) {
    const done = await withPlatform(async (tx) => {
      const t = await tx.tenant.findUnique({ where: { id: tenantId }, select: { status: true } });
      if (t?.status !== "ACTIVE") return false;
      await tx.tenant.update({ where: { id: tenantId }, data: { status: "SUSPENDED", suspendedAt: now, suspensionReason: "Subscription payment overdue (automatic)" } });
      await tx.subscription.updateMany({ where: { tenantId }, data: { status: "SUSPENDED" } });
      await recordAudit(tx, { tenantId, actorType: "SYSTEM", action: "tenant.suspended_for_debt", entityType: "Tenant", entityId: tenantId, metadata: { from: "ACTIVE", to: "SUSPENDED" } });
      return true;
    });
    if (done) n++;
  }
  if (n) logger.info("billing.auto_suspended", { count: n });
  return n;
}

// ───────────── SuperAdmin actions ─────────────

export const paymentSchema = z.object({
  amount: z.string().trim().min(1, "validation.required"),
  method: z.enum(["CASH", "TRANSFER", "CARD", "OTHER"], "validation.required"),
  receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "validation.date"),
  note: z.string().trim().max(200, "validation.tooLong").optional(),
});

export async function recordClinicPayment(actor: PlatformPrincipal, tenantId: string, raw: unknown, meta: RequestMeta): Promise<void> {
  requireSuperAdmin(actor);
  const input = paymentSchema.parse(raw);
  const tenant = await platformDb().tenant.findUnique({ where: { id: tenantId }, select: { id: true, currency: true } });
  if (!tenant) throw new DomainError("errors.notFound");
  const amount = parseMoney(input.amount, tenant.currency);
  if (!amount || amount <= 0n) throw new DomainError("validation.amount");
  if (dateOnly(input.receivedOn).getTime() > Date.now() + DAY) throw new DomainError("validation.date");
  const id = uuidv7();
  await withPlatform(async (tx) => {
    await tx.clinicPayment.create({
      data: { id, tenantId, amountMinor: amount, currency: tenant.currency, method: input.method, receivedOn: dateOnly(input.receivedOn), note: input.note || null, recordedById: actor.user.id },
    });
    // The note is free text; only its presence goes into the audit trail.
    await recordAudit(tx, { tenantId, actorType: "PLATFORM_USER", actorId: actor.user.id, action: "billing.payment_recorded", entityType: "ClinicPayment", entityId: id, ipHash: hashIp(meta.ip), userAgent: meta.userAgent, metadata: { amountMinor: amount.toString(), method: input.method } });
  });
}

export async function voidClinicPayment(actor: PlatformPrincipal, paymentId: string, meta: RequestMeta): Promise<string> {
  requireSuperAdmin(actor);
  return withPlatform(async (tx) => {
    const p = await tx.clinicPayment.findUnique({ where: { id: paymentId }, select: { tenantId: true, voidedAt: true } });
    if (!p || p.voidedAt) throw new DomainError("errors.notFound");
    await tx.clinicPayment.update({ where: { id: paymentId }, data: { voidedAt: new Date() } });
    await recordAudit(tx, { tenantId: p.tenantId, actorType: "PLATFORM_USER", actorId: actor.user.id, action: "billing.payment_voided", entityType: "ClinicPayment", entityId: paymentId, ipHash: hashIp(meta.ip), userAgent: meta.userAgent });
    return p.tenantId;
  });
}

export async function voidClinicInvoice(actor: PlatformPrincipal, invoiceId: string, meta: RequestMeta): Promise<string> {
  requireSuperAdmin(actor);
  return withPlatform(async (tx) => {
    const i = await tx.clinicInvoice.findUnique({ where: { id: invoiceId }, select: { tenantId: true, voidedAt: true } });
    if (!i || i.voidedAt) throw new DomainError("errors.notFound");
    await tx.clinicInvoice.update({ where: { id: invoiceId }, data: { voidedAt: new Date() } });
    await recordAudit(tx, { tenantId: i.tenantId, actorType: "PLATFORM_USER", actorId: actor.user.id, action: "billing.invoice_voided", entityType: "ClinicInvoice", entityId: invoiceId, ipHash: hashIp(meta.ip), userAgent: meta.userAgent });
    return i.tenantId;
  });
}

export const settingsSchema = z.object({
  dueDays: z.coerce.number().int().min(0, "validation.range").max(60, "validation.range"),
  suspendAfterDays: z.coerce.number().int().min(1, "validation.range").max(180, "validation.range"),
  autoSuspend: z.preprocess((v) => v === "on" || v === true || v === "true", z.boolean()),
});

export async function updateBillingSettings(actor: PlatformPrincipal, raw: unknown, meta: RequestMeta) {
  requireSuperAdmin(actor);
  const input = settingsSchema.parse(raw);
  await withPlatform(async (tx) => {
    await tx.billingSettings.update({ where: { id: 1 }, data: input });
    await recordAudit(tx, { actorType: "PLATFORM_USER", actorId: actor.user.id, action: "billing.settings_changed", ipHash: hashIp(meta.ip), userAgent: meta.userAgent, metadata: { ...input } });
  });
}

export async function clinicBillingDetail(actor: PlatformPrincipal, tenantId: string) {
  requireSuperAdmin(actor);
  const [invoices, payments, balances] = await Promise.all([
    platformDb().clinicInvoice.findMany({ where: { tenantId }, orderBy: { periodStart: "desc" }, take: 24 }),
    platformDb().clinicPayment.findMany({ where: { tenantId }, orderBy: [{ receivedOn: "desc" }, { createdAt: "desc" }], take: 24 }),
    clinicBalances(tenantId),
  ]);
  return { invoices, payments, balance: balances.get(tenantId) ?? null };
}

// ───────────── Activity (counts only) ─────────────

export interface ClinicActivity {
  tenantId: string;
  lastLoginAt: Date | null;
  activeStaff: number;
  staff7d: number;
  staff30d: number;
  branches: number;
  appointments30d: number;
  appointmentsToday: number;
  newPatients30d: number;
  invoices30d: number;
}

/** Per-clinic activity figures, computed in the database (no clinical rows reach the platform role). */
export async function clinicActivity(): Promise<Map<string, ClinicActivity>> {
  const rows = await platformDb().$queryRaw<ClinicActivity[]>`SELECT * FROM platform_tenant_activity()`;
  return new Map(rows.map((r) => [r.tenantId, r]));
}

/** Everything the console's overview needs, for the SuperAdmin. */
export async function billingOverview(actor: PlatformPrincipal, now = new Date()) {
  requireSuperAdmin(actor);
  const [tenants, balances, activity, settings] = await Promise.all([
    platformDb().tenant.findMany({
      where: { status: { not: "ARCHIVED" } },
      select: { id: true, name: true, slug: true, status: true, subscription: { select: { status: true, trialEndsAt: true, plan: { select: { code: true, name: true, priceMonthlyMinor: true, currency: true, maxUsers: true, maxBranches: true } } } } },
      orderBy: { name: "asc" },
    }),
    clinicBalances(undefined, now),
    clinicActivity(),
    billingSettings(),
  ]);
  const rows = tenants.map((t) => {
    const a = activity.get(t.id);
    const b = balances.get(t.id);
    const plan = t.subscription?.plan;
    const daysSinceLogin = a?.lastLoginAt ? Math.floor((now.getTime() - new Date(a.lastLoginAt).getTime()) / DAY) : null;
    const nearLimit =
      (plan?.maxUsers != null && (a?.activeStaff ?? 0) >= Math.ceil(plan.maxUsers * 0.9)) || (plan?.maxBranches != null && (a?.branches ?? 0) >= plan.maxBranches);
    return { tenant: t, activity: a ?? null, balance: b ?? null, daysSinceLogin, nearLimit };
  });
  const active = rows.filter((r) => r.tenant.status === "ACTIVE");
  const mrr = active.reduce((s, r) => (r.tenant.subscription?.status === "ACTIVE" ? s + (r.tenant.subscription.plan.priceMonthlyMinor ?? 0n) : s), 0n);
  const debt = rows.reduce((s, r) => s + (r.balance?.debtMinor ?? 0n), 0n);
  return { rows, settings, mrr, debt, inactiveAfterDays: 7 };
}
