import "server-only";
import { z } from "zod";
import { Prisma, type InventoryCategory, type StockReason } from "@/generated/prisma/client";
import { parseMoney } from "@/lib/money";
import type { ClinicContext } from "../auth/clinic-auth";
import type { RequestMeta } from "../auth/platform-auth";
import { assertBranch, auditClinic, branchWhere, inClinic, requirePermission } from "../clinic/context";
import type { Tx } from "../db";
import { addDays, isLocalDate, localDateToDbDate, todayIn } from "../scheduling/time";
import { uuidv7 } from "../security/crypto";
import { DomainError } from "../tenancy/provisioning";
import { sequential } from "../db";

/**
 * Pharmacy & inventory. Stock is a ledger: every change is an append-only
 * StockMovement, and the database (trigger + CHECK) maintains batch
 * quantities, refuses negative stock and refuses to issue expired batches.
 * Issuing picks batches first-expiry-first-out (FEFO).
 */
const uuid = z.uuid();
export const INVENTORY_CATEGORIES = ["MEDICINE", "CONSUMABLE", "REAGENT", "EQUIPMENT", "OTHER"] as const satisfies readonly InventoryCategory[];
export const INVENTORY_UNITS = ["pcs", "pack", "tablet", "capsule", "ampoule", "vial", "bottle", "ml", "g", "pair", "set"] as const;
export const WRITE_OFF_REASONS = ["EXPIRED", "DAMAGED", "LOST", "RECALLED", "OTHER"] as const satisfies readonly StockReason[];
/** Batches expiring within this many days are flagged. */
export const EXPIRY_WARNING_DAYS = 60;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "validation.tooLong")
    .transform((v) => (v === "" ? undefined : v))
    .optional();
const qty = z.coerce.number({ error: "validation.number" }).int("validation.wholeNumber").min(1, "validation.positive").max(1_000_000, "validation.tooLarge");

export const itemSchema = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9._-]{1,32}$/, "validation.code"),
  name: z.string().trim().min(2, "validation.required").max(160, "validation.tooLong"),
  category: z.enum(INVENTORY_CATEGORIES),
  form: optionalText(60),
  strength: optionalText(60),
  unit: z.enum(INVENTORY_UNITS),
  minStock: z.coerce.number().int().min(0).max(1_000_000).default(0),
  barcode: optionalText(64),
});

export const supplierSchema = z.object({
  name: z.string().trim().min(2, "validation.required").max(160, "validation.tooLong"),
  taxId: z.union([z.literal("").transform(() => undefined), z.string().trim().regex(/^\d{9}$/, "validation.taxId")]).optional(),
  phone: optionalText(32),
});

export const receiptSchema = z.object({
  branchId: uuid,
  lotNumber: z.string().trim().min(1, "validation.required").max(64, "validation.tooLong"),
  expiresOn: z.union([z.literal("").transform(() => undefined), z.string().refine(isLocalDate, "validation.date")]).optional(),
  quantity: qty,
  unitCost: optionalText(20),
  supplierId: z.union([z.literal("").transform(() => undefined), uuid]).optional(),
  documentRef: optionalText(64),
});

export const issueSchema = z
  .object({
    branchId: uuid,
    quantity: qty,
    kind: z.enum(["ISSUE", "DISPENSE"]),
    /** DISPENSE: the patient, identified by medical record number (no wider patient search for pharmacy). */
    patientMrn: optionalText(20),
    departmentId: z.union([z.literal("").transform(() => undefined), uuid]).optional(),
  })
  .refine((v) => v.kind !== "DISPENSE" || Boolean(v.patientMrn), { message: "validation.required", path: ["patientMrn"] });

export const writeOffSchema = z.object({ quantity: qty, reason: z.enum(WRITE_OFF_REASONS) });
export const countSchema = z.object({ counted: z.coerce.number({ error: "validation.number" }).int("validation.wholeNumber").min(0).max(1_000_000) });

/** Maps the ledger's database guards to user-facing errors. */
function mapStockError(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError || e instanceof Prisma.PrismaClientUnknownRequestError) {
    const msg = e.message + JSON.stringify((e as { meta?: unknown }).meta ?? {});
    if (/StockBatch_quantity_chk/.test(msg)) throw new DomainError("errors.insufficientStock");
    if (/Expired stock/.test(msg)) throw new DomainError("errors.stockExpired");
  }
  throw e;
}

// ───────────── Catalogue ─────────────

export async function listInventory(ctx: ClinicContext, opts: { branchId?: string; q?: string } = {}) {
  requirePermission(ctx, "inventory.read", "inventory.dispense");
  if (opts.branchId) assertBranch(ctx, opts.branchId);
  const today = localDateToDbDate(todayIn(ctx.tenant.timezone));
  const soon = localDateToDbDate(addDays(todayIn(ctx.tenant.timezone), EXPIRY_WARNING_DAYS));
  return inClinic(ctx, async (tx) => {
    const q = opts.q?.trim();
    const items = await tx.inventoryItem.findMany({
      where: { archivedAt: null, ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }, { barcode: q }] } : {}) },
      orderBy: { name: "asc" },
      take: 300,
    });
    const scope = opts.branchId ? { branchId: opts.branchId } : branchWhere(ctx);
    const batches = await tx.stockBatch.findMany({
      where: { itemId: { in: items.map((i) => i.id) }, quantity: { gt: 0 }, ...scope },
      select: { itemId: true, quantity: true, expiresOn: true },
    });
    return items.map((i) => {
      const mine = batches.filter((b) => b.itemId === i.id);
      const usable = mine.filter((b) => !b.expiresOn || b.expiresOn >= today);
      const onHand = usable.reduce((s, b) => s + b.quantity, 0);
      const expired = mine.filter((b) => b.expiresOn && b.expiresOn < today).reduce((s, b) => s + b.quantity, 0);
      const nextExpiry = usable.map((b) => b.expiresOn).filter((d): d is Date => Boolean(d)).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
      return { ...i, onHand, expired, nextExpiry, low: i.minStock > 0 && onHand < i.minStock, expiringSoon: Boolean(nextExpiry && nextExpiry <= soon) };
    });
  });
}

export async function createItem(ctx: ClinicContext, raw: unknown, meta: RequestMeta) {
  requirePermission(ctx, "inventory.manage");
  const input = itemSchema.parse(raw);
  const id = uuidv7();
  try {
    await inClinic(ctx, async (tx) => {
      await tx.inventoryItem.create({ data: { id, tenantId: ctx.tenant.id, ...input } });
      await auditClinic(tx, ctx, meta, { action: "inventory.item_created", entityType: "InventoryItem", entityId: id });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new DomainError("errors.codeTaken");
    throw e;
  }
  return id;
}

export async function updateItem(ctx: ClinicContext, itemId: string, raw: unknown, meta: RequestMeta) {
  requirePermission(ctx, "inventory.manage");
  const input = itemSchema.parse(raw);
  try {
    await inClinic(ctx, async (tx) => {
      const item = await tx.inventoryItem.findUnique({ where: { id: uuid.parse(itemId) } });
      if (!item) throw new DomainError("errors.notFound");
      await tx.inventoryItem.update({ where: { id: item.id }, data: input });
      await auditClinic(tx, ctx, meta, { action: "inventory.item_updated", entityType: "InventoryItem", entityId: item.id });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new DomainError("errors.codeTaken");
    throw e;
  }
}

export async function archiveItem(ctx: ClinicContext, itemId: string, meta: RequestMeta) {
  requirePermission(ctx, "inventory.manage");
  await inClinic(ctx, async (tx) => {
    const item = await tx.inventoryItem.findUnique({ where: { id: uuid.parse(itemId) } });
    if (!item || item.archivedAt) throw new DomainError("errors.notFound");
    const left = await tx.stockBatch.aggregate({ where: { itemId: item.id, quantity: { gt: 0 } }, _sum: { quantity: true } });
    if ((left._sum.quantity ?? 0) > 0) throw new DomainError("errors.itemHasStock");
    await tx.inventoryItem.update({ where: { id: item.id }, data: { archivedAt: new Date() } });
    await auditClinic(tx, ctx, meta, { action: "inventory.item_archived", entityType: "InventoryItem", entityId: item.id });
  });
}

export async function listSuppliers(ctx: ClinicContext) {
  requirePermission(ctx, "inventory.read", "inventory.manage");
  return inClinic(ctx, (tx) => tx.supplier.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" } }));
}

export async function createSupplier(ctx: ClinicContext, raw: unknown, meta: RequestMeta) {
  requirePermission(ctx, "inventory.manage");
  const input = supplierSchema.parse(raw);
  const id = uuidv7();
  try {
    await inClinic(ctx, async (tx) => {
      await tx.supplier.create({ data: { id, tenantId: ctx.tenant.id, ...input } });
      await auditClinic(tx, ctx, meta, { action: "inventory.supplier_created", entityType: "Supplier", entityId: id });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new DomainError("errors.supplierExists");
    throw e;
  }
  return id;
}

// ───────────── Item detail ─────────────

export async function getItem(ctx: ClinicContext, itemId: string) {
  requirePermission(ctx, "inventory.read", "inventory.dispense");
  const id = uuid.safeParse(itemId);
  if (!id.success) return null;
  return inClinic(ctx, async (tx) => {
    const item = await tx.inventoryItem.findUnique({ where: { id: id.data } });
    if (!item) return null;
    const [batches, movements] = await sequential([
      tx.stockBatch.findMany({
        where: { itemId: item.id, ...branchWhere(ctx), OR: [{ quantity: { gt: 0 } }, { receivedAt: { gte: new Date(Date.now() - 90 * 86_400_000) } }] },
        include: { branch: { select: { name: true } }, supplier: { select: { name: true } } },
        orderBy: [{ expiresOn: { sort: "asc", nulls: "last" } }, { receivedAt: "asc" }],
      }),
      tx.stockMovement.findMany({
        where: { itemId: item.id, ...branchWhere(ctx) },
        include: { batch: { select: { lotNumber: true } }, branch: { select: { name: true } }, patient: { select: { mrn: true } } },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    ]);
    const users = await tx.user.findMany({ where: { id: { in: [...new Set(movements.map((m) => m.createdById))] } }, select: { id: true, fullName: true } });
    const names = new Map(users.map((u) => [u.id, u.fullName]));
    return { item, batches, movements: movements.map((m) => ({ ...m, createdByName: names.get(m.createdById) ?? null })) };
  });
}

// ───────────── Stock movements ─────────────

/** Receives a new lot: creates the (empty) batch and a RECEIPT movement that fills it. */
export async function receiveStock(ctx: ClinicContext, itemId: string, raw: unknown, meta: RequestMeta) {
  requirePermission(ctx, "inventory.manage");
  const input = receiptSchema.parse(raw);
  assertBranch(ctx, input.branchId);
  const unitCostMinor = input.unitCost ? parseMoney(input.unitCost, ctx.tenant.currency) : null;
  if (input.unitCost && unitCostMinor === null) throw new DomainError("validation.money");
  if (input.expiresOn && input.expiresOn < todayIn(ctx.tenant.timezone)) throw new DomainError("errors.receiveExpired");
  return inClinic(ctx, async (tx) => {
    const item = await tx.inventoryItem.findUnique({ where: { id: uuid.parse(itemId) } });
    if (!item || item.archivedAt) throw new DomainError("errors.notFound");
    const branch = await tx.branch.findUnique({ where: { id: input.branchId } });
    if (!branch || branch.archivedAt) throw new DomainError("errors.notFound");
    if (input.supplierId && !(await tx.supplier.findUnique({ where: { id: input.supplierId } }))) throw new DomainError("errors.notFound");
    const batchId = uuidv7();
    await tx.stockBatch.create({
      data: {
        id: batchId,
        tenantId: ctx.tenant.id,
        itemId: item.id,
        branchId: branch.id,
        supplierId: input.supplierId,
        lotNumber: input.lotNumber,
        expiresOn: input.expiresOn ? localDateToDbDate(input.expiresOn) : null,
        unitCostMinor,
        currency: ctx.tenant.currency,
      },
    });
    await tx.stockMovement.create({
      data: { id: uuidv7(), tenantId: ctx.tenant.id, batchId, itemId: item.id, branchId: branch.id, kind: "RECEIPT", quantity: input.quantity, documentRef: input.documentRef, createdById: ctx.principal.user.id },
    });
    await auditClinic(tx, ctx, meta, { action: "inventory.received", entityType: "StockBatch", entityId: batchId, metadata: { quantity: input.quantity } });
    return batchId;
  });
}

/**
 * Issues stock to a department or dispenses it to a patient, taking batches
 * first-expiry-first-out. Expired batches are never used. All-or-nothing.
 */
export async function issueStock(ctx: ClinicContext, itemId: string, raw: unknown, meta: RequestMeta): Promise<{ batches: number }> {
  requirePermission(ctx, "inventory.dispense");
  const input = issueSchema.parse(raw);
  assertBranch(ctx, input.branchId);
  const today = todayIn(ctx.tenant.timezone);
  try {
    return await inClinic(ctx, async (tx) => {
      const item = await tx.inventoryItem.findUnique({ where: { id: uuid.parse(itemId) } });
      if (!item || item.archivedAt) throw new DomainError("errors.notFound");
      let patientId: string | undefined;
      if (input.kind === "DISPENSE") {
        const p = await tx.patient.findFirst({ where: { mrn: input.patientMrn!.toUpperCase(), status: "ACTIVE" }, select: { id: true } });
        if (!p) throw new DomainError("errors.patientNotFound");
        patientId = p.id;
      }
      if (input.departmentId && !(await tx.department.findUnique({ where: { id: input.departmentId } }))) throw new DomainError("errors.notFound");

      // Serialise stock-outs per item and branch so concurrent issues allocate from fresh quantities.
      await lockStock(tx, item.id, input.branchId);
      const batches = await tx.$queryRaw<{ id: string; quantity: number }[]>`
        SELECT id, quantity FROM "StockBatch"
         WHERE "itemId" = ${item.id}::uuid AND "branchId" = ${input.branchId}::uuid AND quantity > 0
           AND ("expiresOn" IS NULL OR "expiresOn" >= ${today}::date)
         ORDER BY "expiresOn" ASC NULLS LAST, "receivedAt" ASC`;
      let remaining = input.quantity;
      const take: { id: string; n: number }[] = [];
      for (const b of batches) {
        if (remaining === 0) break;
        const n = Math.min(b.quantity, remaining);
        take.push({ id: b.id, n });
        remaining -= n;
      }
      if (remaining > 0) throw new DomainError("errors.insufficientStock");
      for (const t of take) {
        await tx.stockMovement.create({
          data: {
            id: uuidv7(),
            tenantId: ctx.tenant.id,
            batchId: t.id,
            itemId: item.id,
            branchId: input.branchId,
            kind: input.kind,
            quantity: -t.n,
            patientId,
            departmentId: input.kind === "ISSUE" ? input.departmentId : undefined,
            createdById: ctx.principal.user.id,
          },
        });
      }
      await auditClinic(tx, ctx, meta, {
        action: input.kind === "DISPENSE" ? "inventory.dispensed" : "inventory.issued",
        entityType: input.kind === "DISPENSE" ? "Patient" : "InventoryItem",
        entityId: patientId ?? item.id,
        metadata: { quantity: input.quantity, batches: take.length },
      });
      return { batches: take.length };
    });
  } catch (e) {
    if (e instanceof DomainError) throw e;
    mapStockError(e);
  }
}

/**
 * Per item+branch transaction lock (the clinic role has no UPDATE right on batches,
 * so row locks are taken by the ledger trigger; this avoids allocating from stale reads).
 */
async function lockStock(tx: Tx, itemId: string, branchId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"stock:" + itemId + ":" + branchId}, 0))`;
}

async function loadBatch(tx: Tx, ctx: ClinicContext, batchId: string) {
  const b = await tx.stockBatch.findUnique({ where: { id: uuid.parse(batchId) } });
  if (!b) throw new DomainError("errors.notFound");
  assertBranch(ctx, b.branchId);
  return b;
}

/** Removes damaged, expired, lost or recalled stock from one batch. */
export async function writeOffStock(ctx: ClinicContext, batchId: string, raw: unknown, meta: RequestMeta) {
  requirePermission(ctx, "inventory.manage");
  const input = writeOffSchema.parse(raw);
  try {
    await inClinic(ctx, async (tx) => {
      const b = await loadBatch(tx, ctx, batchId);
      await tx.stockMovement.create({
        data: { id: uuidv7(), tenantId: ctx.tenant.id, batchId: b.id, itemId: b.itemId, branchId: b.branchId, kind: "WRITE_OFF", quantity: -input.quantity, reason: input.reason, createdById: ctx.principal.user.id },
      });
      await auditClinic(tx, ctx, meta, { action: "inventory.written_off", entityType: "StockBatch", entityId: b.id, metadata: { quantity: input.quantity, reason: input.reason } });
    });
  } catch (e) {
    if (e instanceof DomainError) throw e;
    mapStockError(e);
  }
}

/** Stock count: records the physical count as a COUNT_CORRECTION adjustment (no-op when equal). */
export async function recordCount(ctx: ClinicContext, batchId: string, raw: unknown, meta: RequestMeta): Promise<{ delta: number }> {
  requirePermission(ctx, "inventory.manage");
  const input = countSchema.parse(raw);
  return inClinic(ctx, async (tx) => {
    const found = await loadBatch(tx, ctx, batchId);
    await lockStock(tx, found.itemId, found.branchId);
    const b = await loadBatch(tx, ctx, batchId); // re-read under the lock
    const delta = input.counted - b.quantity;
    if (delta === 0) return { delta };
    await tx.stockMovement.create({
      data: { id: uuidv7(), tenantId: ctx.tenant.id, batchId: b.id, itemId: b.itemId, branchId: b.branchId, kind: "ADJUSTMENT", quantity: delta, reason: "COUNT_CORRECTION", createdById: ctx.principal.user.id },
    });
    await auditClinic(tx, ctx, meta, { action: "inventory.counted", entityType: "StockBatch", entityId: b.id, metadata: { delta } });
    return { delta };
  });
}

/** Dashboard alerts within the caller's branch scope. */
export async function inventoryAlerts(ctx: ClinicContext) {
  const items = await listInventory(ctx);
  return {
    low: items.filter((i) => i.low),
    expiringSoon: items.filter((i) => i.expiringSoon),
    expired: items.filter((i) => i.expired > 0),
  };
}

/** Departments that can receive internal issues (for the issue form; pharmacy roles lack admin lists). */
export async function listIssueDepartments(ctx: ClinicContext) {
  requirePermission(ctx, "inventory.dispense", "inventory.manage", "hr.manage");
  return inClinic(ctx, (tx) => tx.department.findMany({ where: { archivedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }));
}
