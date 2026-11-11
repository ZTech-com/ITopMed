import "server-only";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { parseMoney } from "@/lib/money";
import type { ClinicContext } from "../auth/clinic-auth";
import type { RequestMeta } from "../auth/platform-auth";
import { uuidv7 } from "../security/crypto";
import { DomainError } from "../tenancy/provisioning";
import { assertBranch, auditClinic, branchWhere, inClinic, requirePermission } from "./context";

const uuid = z.uuid();
const optionalUuid = z.union([z.literal("").transform(() => undefined), uuid]).optional();
const name = z.string().trim().min(2, "validation.required").max(120, "validation.tooLong");

function uniqueViolation(e: unknown, code: string): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new DomainError(code);
  throw e;
}

// ───────────── Departments ─────────────

export async function listDepartments(ctx: ClinicContext) {
  requirePermission(ctx, "clinic.settings.read", "services.read", "schedules.read");
  return inClinic(ctx, (tx) => tx.department.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" }, include: { branch: { select: { name: true } } } }));
}

export const departmentSchema = z.object({ name, branchId: optionalUuid });

export async function createDepartment(ctx: ClinicContext, raw: unknown, meta: RequestMeta) {
  requirePermission(ctx, "clinic.branches.manage");
  const input = departmentSchema.parse(raw);
  if (input.branchId) assertBranch(ctx, input.branchId);
  const id = uuidv7();
  await inClinic(ctx, async (tx) => {
    await tx.department.create({ data: { id, tenantId: ctx.tenant.id, name: input.name, branchId: input.branchId } });
    await auditClinic(tx, ctx, meta, { action: "department.created", entityType: "Department", entityId: id });
  }).catch((e) => uniqueViolation(e, "errors.nameTaken"));
  return id;
}

export async function archiveDepartment(ctx: ClinicContext, id: string, meta: RequestMeta) {
  requirePermission(ctx, "clinic.branches.manage");
  await inClinic(ctx, async (tx) => {
    const d = await tx.department.findUnique({ where: { id: uuid.parse(id) } });
    if (!d || d.archivedAt) throw new DomainError("errors.notFound");
    if (d.branchId) assertBranch(ctx, d.branchId);
    await tx.department.update({ where: { id: d.id }, data: { archivedAt: new Date() } });
    await auditClinic(tx, ctx, meta, { action: "department.archived", entityType: "Department", entityId: d.id });
  });
}

// ───────────── Rooms ─────────────

export const ROOM_KINDS = ["CONSULTATION", "PROCEDURE", "LABORATORY", "IMAGING", "WARD", "OTHER"] as const;

export async function listRooms(ctx: ClinicContext) {
  requirePermission(ctx, "clinic.settings.read", "schedules.read");
  return inClinic(ctx, (tx) =>
    tx.room.findMany({ where: { archivedAt: null, ...branchWhere(ctx) }, orderBy: [{ branchId: "asc" }, { name: "asc" }], include: { branch: { select: { name: true } } } }),
  );
}

export const roomSchema = z.object({ name, branchId: uuid, kind: z.enum(ROOM_KINDS) });

export async function createRoom(ctx: ClinicContext, raw: unknown, meta: RequestMeta) {
  requirePermission(ctx, "clinic.branches.manage");
  const input = roomSchema.parse(raw);
  assertBranch(ctx, input.branchId);
  const id = uuidv7();
  await inClinic(ctx, async (tx) => {
    const branch = await tx.branch.findFirst({ where: { id: input.branchId, archivedAt: null } });
    if (!branch) throw new DomainError("errors.notFound");
    await tx.room.create({ data: { id, tenantId: ctx.tenant.id, ...input } });
    await auditClinic(tx, ctx, meta, { action: "room.created", entityType: "Room", entityId: id });
  }).catch((e) => uniqueViolation(e, "errors.nameTaken"));
  return id;
}

export async function archiveRoom(ctx: ClinicContext, id: string, meta: RequestMeta) {
  requirePermission(ctx, "clinic.branches.manage");
  await inClinic(ctx, async (tx) => {
    const r = await tx.room.findUnique({ where: { id: uuid.parse(id) } });
    if (!r || r.archivedAt) throw new DomainError("errors.notFound");
    assertBranch(ctx, r.branchId);
    await tx.room.update({ where: { id: r.id }, data: { archivedAt: new Date() } });
    await tx.workSchedule.updateMany({ where: { roomId: r.id }, data: { roomId: null } });
    await auditClinic(tx, ctx, meta, { action: "room.archived", entityType: "Room", entityId: r.id });
  });
}

// ───────────── Services & prices ─────────────

export const SERVICE_KINDS = ["CONSULTATION", "PROCEDURE", "LAB_TEST", "IMAGING", "OTHER"] as const;

export const serviceSchema = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9._-]{0,31}$/, "validation.serviceCode"),
    name: z.string().trim().min(2, "validation.required").max(200, "validation.tooLong"),
    kind: z.enum(SERVICE_KINDS),
    departmentId: optionalUuid,
    durationMinutes: z.coerce.number().int("validation.invalid").min(5, "validation.durationRange").max(480, "validation.durationRange"),
    price: z.string(),
    currency: z.enum(["UZS", "USD"]),
  })
  .transform((v, c) => {
    const { price, ...rest } = v;
    const priceMinor = parseMoney(price, v.currency);
    if (priceMinor === null) {
      c.addIssue({ code: "custom", message: "validation.price", path: ["price"] });
      return z.NEVER;
    }
    return { ...rest, priceMinor };
  });

export async function listServices(ctx: ClinicContext, opts: { includeArchived?: boolean } = {}) {
  requirePermission(ctx, "services.read", "services.manage");
  return inClinic(ctx, (tx) =>
    tx.service.findMany({
      where: opts.includeArchived ? {} : { archivedAt: null },
      orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { code: "asc" }],
      include: { department: { select: { name: true } }, _count: { select: { doctors: true } } },
    }),
  );
}

export async function createService(ctx: ClinicContext, raw: unknown, meta: RequestMeta) {
  requirePermission(ctx, "services.manage");
  const input = serviceSchema.parse(raw);
  const id = uuidv7();
  await inClinic(ctx, async (tx) => {
    await tx.service.create({ data: { id, tenantId: ctx.tenant.id, ...input } });
    await auditClinic(tx, ctx, meta, { action: "service.created", entityType: "Service", entityId: id, metadata: { ref: input.code, priceMinor: input.priceMinor.toString(), currency: input.currency } });
  }).catch((e) => uniqueViolation(e, "errors.codeTaken"));
  return id;
}

/** Price and attribute changes are audited with before/after prices (no clinical data involved). */
export async function updateService(ctx: ClinicContext, id: string, raw: unknown, meta: RequestMeta) {
  requirePermission(ctx, "services.manage");
  const input = serviceSchema.parse(raw);
  await inClinic(ctx, async (tx) => {
    const s = await tx.service.findUnique({ where: { id: uuid.parse(id) } });
    if (!s) throw new DomainError("errors.notFound");
    await tx.service.update({ where: { id: s.id }, data: input });
    await auditClinic(tx, ctx, meta, {
      action: "service.updated",
      entityType: "Service",
      entityId: s.id,
      metadata: { priceBefore: s.priceMinor.toString(), priceAfter: input.priceMinor.toString(), currency: input.currency },
    });
  }).catch((e) => uniqueViolation(e, "errors.codeTaken"));
}

export async function setServiceArchived(ctx: ClinicContext, id: string, archived: boolean, meta: RequestMeta) {
  requirePermission(ctx, "services.manage");
  await inClinic(ctx, async (tx) => {
    const s = await tx.service.findUnique({ where: { id: uuid.parse(id) } });
    if (!s) throw new DomainError("errors.notFound");
    await tx.service.update({ where: { id: s.id }, data: { archivedAt: archived ? new Date() : null } });
    await auditClinic(tx, ctx, meta, { action: archived ? "service.archived" : "service.restored", entityType: "Service", entityId: s.id });
  });
}

export async function getService(ctx: ClinicContext, id: string) {
  requirePermission(ctx, "services.manage");
  if (!uuid.safeParse(id).success) return null;
  return inClinic(ctx, (tx) => tx.service.findUnique({ where: { id } }));
}
