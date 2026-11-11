import "server-only";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { parseMoney } from "@/lib/money";
import type { ClinicContext } from "../auth/clinic-auth";
import type { RequestMeta } from "../auth/platform-auth";
import { assertBranch, auditClinic, inClinic, requirePermission } from "../clinic/context";
import type { Tx } from "../db";
import { uuidv7 } from "../security/crypto";
import { DomainError } from "../tenancy/provisioning";

const uuid = z.uuid();

/** Cash expected in the drawer: opening float + cash payments − cash refunds of this shift. */
async function expectedCash(tx: Tx, shift: { id: string; openingFloatMinor: bigint }) {
  const [paid, refunded] = await Promise.all([
    tx.payment.aggregate({ where: { cashShiftId: shift.id, method: "CASH" }, _sum: { amountMinor: true } }),
    tx.refund.aggregate({ where: { cashShiftId: shift.id }, _sum: { amountMinor: true } }),
  ]);
  return {
    cashIn: paid._sum.amountMinor ?? 0n,
    cashOut: refunded._sum.amountMinor ?? 0n,
    expected: shift.openingFloatMinor + (paid._sum.amountMinor ?? 0n) - (refunded._sum.amountMinor ?? 0n),
  };
}

export const openShiftSchema = z.object({ branchId: uuid, openingFloat: z.string().default("0"), currency: z.enum(["UZS", "USD"]).default("UZS") });

export async function openShift(ctx: ClinicContext, raw: unknown, meta: RequestMeta): Promise<string> {
  requirePermission(ctx, "cash.shift");
  const input = openShiftSchema.parse(raw);
  assertBranch(ctx, input.branchId);
  const float = parseMoney(input.openingFloat || "0", input.currency);
  if (float === null) throw new DomainError("errors.invalidAmount");
  const id = uuidv7();
  await inClinic(ctx, async (tx) => {
    const branch = await tx.branch.findFirst({ where: { id: input.branchId, archivedAt: null } });
    if (!branch) throw new DomainError("errors.notFound");
    await tx.cashShift.create({ data: { id, tenantId: ctx.tenant.id, branchId: input.branchId, cashierId: ctx.principal.user.id, currency: input.currency, openingFloatMinor: float } });
    await auditClinic(tx, ctx, meta, { action: "cash_shift.opened", entityType: "CashShift", entityId: id, metadata: { openingFloatMinor: float.toString(), currency: input.currency } });
  }).catch((e) => {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new DomainError("errors.shiftAlreadyOpen");
    throw e;
  });
  return id;
}

/** Closes the caller's shift with the counted cash; the difference is recorded and audited. */
export async function closeShift(ctx: ClinicContext, shiftId: string, countedRaw: string, meta: RequestMeta) {
  requirePermission(ctx, "cash.shift");
  return inClinic(ctx, async (tx) => {
    const s = await tx.cashShift.findUnique({ where: { id: uuid.parse(shiftId) } });
    if (!s || s.status !== "OPEN") throw new DomainError("errors.notFound");
    if (s.cashierId !== ctx.principal.user.id) throw new DomainError("errors.notYourShift");
    const counted = parseMoney(countedRaw, s.currency);
    if (counted === null) throw new DomainError("errors.invalidAmount");
    await tx.$queryRaw`SELECT id FROM "CashShift" WHERE id = ${s.id}::uuid FOR UPDATE`;
    const { expected } = await expectedCash(tx, s);
    const difference = counted - expected;
    await tx.cashShift.update({ where: { id: s.id }, data: { status: "CLOSED", closedAt: new Date(), expectedCashMinor: expected, countedCashMinor: counted, differenceMinor: difference } });
    await auditClinic(tx, ctx, meta, {
      action: "cash_shift.closed",
      entityType: "CashShift",
      entityId: s.id,
      metadata: { expectedMinor: expected.toString(), countedMinor: counted.toString(), differenceMinor: difference.toString() },
    });
    return { expected, counted, difference };
  });
}

/** The caller's open shifts with live totals, plus their recently closed shifts. */
export async function myShifts(ctx: ClinicContext) {
  requirePermission(ctx, "cash.shift");
  return inClinic(ctx, async (tx) => {
    const shifts = await tx.cashShift.findMany({
      where: { cashierId: ctx.principal.user.id },
      include: { branch: { select: { name: true } } },
      orderBy: { openedAt: "desc" },
      take: 10,
    });
    return Promise.all(shifts.map(async (s) => ({ ...s, live: s.status === "OPEN" ? await expectedCash(tx, s) : null })));
  });
}

// ───────────── Expenses ─────────────

export const EXPENSE_CATEGORIES = ["SALARY", "RENT", "UTILITIES", "MEDICAL_SUPPLIES", "EQUIPMENT", "TAXES", "MARKETING", "OTHER"] as const;

export const expenseSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES),
  amount: z.string(),
  currency: z.enum(["UZS", "USD"]),
  spentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "validation.date"),
  branchId: z.union([z.literal("").transform(() => undefined), uuid]).optional(),
  description: z
    .string()
    .trim()
    .max(300, "validation.tooLong")
    .transform((v) => (v === "" ? undefined : v))
    .optional(),
});

export async function createExpense(ctx: ClinicContext, raw: unknown, meta: RequestMeta) {
  requirePermission(ctx, "finance.manage");
  const input = expenseSchema.parse(raw);
  if (input.branchId) assertBranch(ctx, input.branchId);
  const amount = parseMoney(input.amount, input.currency);
  if (amount === null || amount <= 0n) throw new DomainError("errors.invalidAmount");
  const id = uuidv7();
  await inClinic(ctx, async (tx) => {
    await tx.expense.create({
      data: { id, tenantId: ctx.tenant.id, branchId: input.branchId, category: input.category, amountMinor: amount, currency: input.currency, spentOn: new Date(`${input.spentOn}T00:00:00Z`), description: input.description, createdById: ctx.principal.user.id },
    });
    await auditClinic(tx, ctx, meta, { action: "expense.recorded", entityType: "Expense", entityId: id, metadata: { category: input.category, amountMinor: amount.toString(), currency: input.currency } });
  });
}

export async function voidExpense(ctx: ClinicContext, expenseId: string, meta: RequestMeta) {
  requirePermission(ctx, "finance.manage");
  await inClinic(ctx, async (tx) => {
    const e = await tx.expense.findUnique({ where: { id: uuid.parse(expenseId) } });
    if (!e || e.voidedAt) throw new DomainError("errors.notFound");
    await tx.expense.update({ where: { id: e.id }, data: { voidedAt: new Date() } });
    await auditClinic(tx, ctx, meta, { action: "expense.voided", entityType: "Expense", entityId: e.id });
  });
}

export async function listExpenses(ctx: ClinicContext, from: string, to: string) {
  requirePermission(ctx, "finance.manage", "finance.reports");
  return inClinic(ctx, (tx) =>
    tx.expense.findMany({
      where: { spentOn: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } },
      include: { branch: { select: { name: true } } },
      orderBy: [{ spentOn: "desc" }, { createdAt: "desc" }],
      take: 300,
    }),
  );
}
