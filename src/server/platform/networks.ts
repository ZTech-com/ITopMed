import "server-only";
import { z } from "zod";
import { personNameSchema, phoneSchema } from "@/lib/validation";
import { recordAudit } from "../audit";
import type { PlatformPrincipal, RequestMeta } from "../auth/platform-auth";
import { platformCan } from "../authz/platform";
import { platformDb, withPlatform } from "../db";
import { DomainError } from "../errors";
import { hashIp, uuidv7 } from "../security/crypto";

/**
 * Networks: a franchise, chain or holding that owns several clinics. The super
 * admin creates the network, puts clinics in it and appoints its network
 * admins (NETWORK_ADMIN), who then create and run those clinics themselves -
 * nothing else on the platform, and never clinical data.
 */
function authorize(actor: PlatformPrincipal) {
  if (!platformCan(actor.user.role, "networks.manage")) throw new DomainError("errors.forbidden");
}

export const networkSchema = z.object({
  name: z.string().trim().min(2, "validation.required").max(120, "validation.tooLong"),
  contactName: z.union([z.literal("").transform(() => undefined), personNameSchema]).optional(),
  contactPhone: z.union([z.literal("").transform(() => undefined), phoneSchema]).optional(),
});

export async function listNetworks(actor: PlatformPrincipal) {
  authorize(actor);
  return platformDb().network.findMany({
    where: { archivedAt: null },
    orderBy: { name: "asc" },
    include: { _count: { select: { tenants: true, admins: true } } },
  });
}

export async function createNetwork(actor: PlatformPrincipal, raw: unknown, meta: RequestMeta) {
  authorize(actor);
  const input = networkSchema.parse(raw);
  const id = uuidv7();
  await withPlatform(async (tx) => {
    await tx.network.create({ data: { id, name: input.name, contactName: input.contactName, contactPhone: input.contactPhone, createdById: actor.user.id } });
    await recordAudit(tx, { actorType: "PLATFORM_USER", actorId: actor.user.id, action: "network.created", entityType: "Network", entityId: id, ipHash: hashIp(meta.ip), userAgent: meta.userAgent });
  });
  return id;
}

export async function getNetwork(actor: PlatformPrincipal, id: string) {
  authorize(actor);
  if (!z.uuid().safeParse(id).success) return null;
  const db = platformDb();
  const network = await db.network.findFirst({
    where: { id, archivedAt: null },
    include: {
      tenants: { orderBy: { name: "asc" }, select: { id: true, name: true, slug: true, status: true, practiceType: true, _count: { select: { memberships: true } } } },
      admins: { orderBy: { fullName: "asc" }, select: { id: true, fullName: true, username: true, status: true, lastLoginAt: true } },
    },
  });
  if (!network) return null;
  const unassigned = await db.tenant.findMany({ where: { networkId: null, status: { not: "ARCHIVED" } }, orderBy: { name: "asc" }, select: { id: true, name: true }, take: 500 });
  return { network, unassigned };
}

/** Moves a clinic into a network (or out of it with networkId = null). Its network admins gain/lose it at once. */
export async function setTenantNetwork(actor: PlatformPrincipal, tenantId: string, networkId: string | null, meta: RequestMeta) {
  authorize(actor);
  if (!z.uuid().safeParse(tenantId).success || (networkId && !z.uuid().safeParse(networkId).success)) throw new DomainError("errors.notFound");
  await withPlatform(async (tx) => {
    if (networkId && !(await tx.network.findFirst({ where: { id: networkId, archivedAt: null }, select: { id: true } }))) throw new DomainError("errors.notFound");
    const t = await tx.tenant.findUnique({ where: { id: tenantId }, select: { networkId: true } });
    if (!t) throw new DomainError("errors.notFound");
    await tx.tenant.update({ where: { id: tenantId }, data: { networkId } });
    await recordAudit(tx, {
      tenantId,
      actorType: "PLATFORM_USER",
      actorId: actor.user.id,
      action: "tenant.network_changed",
      entityType: "Tenant",
      entityId: tenantId,
      ipHash: hashIp(meta.ip),
      userAgent: meta.userAgent,
      metadata: { from: t.networkId ?? "none", to: networkId ?? "none" },
    });
  });
}

/** Name of the network a network admin manages, for the console header. */
export async function networkName(networkId: string | null | undefined): Promise<string | null> {
  if (!networkId) return null;
  return (await platformDb().network.findUnique({ where: { id: networkId }, select: { name: true } }))?.name ?? null;
}
