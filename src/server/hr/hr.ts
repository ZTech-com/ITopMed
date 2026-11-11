import "server-only";
import { z } from "zod";
import { Prisma, type CredentialKind, type EmploymentType, type LeaveKind, type ScheduleExceptionKind } from "@/generated/prisma/client";
import type { ClinicContext } from "../auth/clinic-auth";
import type { RequestMeta } from "../auth/platform-auth";
import { auditClinic, inClinic, requirePermission } from "../clinic/context";
import type { Tx } from "../db";
import { addDays, isLocalDate, localDateToDbDate, localToInstant, todayIn } from "../scheduling/time";
import { uuidv7 } from "../security/crypto";
import { DomainError } from "../tenancy/provisioning";
import { sequential } from "../db";

/**
 * HR records: deliberately minimal personal data (no home address, passport
 * or health details). Leave is stored by category only; for doctors, approved
 * leave blocks their bookable days through ScheduleException rows linked to
 * the leave, with sick leave shown to colleagues only as a generic absence.
 */
const uuid = z.uuid();
export const EMPLOYMENT_TYPES = ["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN"] as const satisfies readonly EmploymentType[];
export const CREDENTIAL_KINDS = ["MEDICAL_LICENSE", "SPECIALIST_CERTIFICATE", "QUALIFICATION_CATEGORY", "TRAINING", "OTHER"] as const satisfies readonly CredentialKind[];
export const LEAVE_KINDS = ["VACATION", "SICK_LEAVE", "TRAINING", "UNPAID", "OTHER"] as const satisfies readonly LeaveKind[];
/** Credentials expiring within this many days are flagged. */
export const CREDENTIAL_WARNING_DAYS = 60;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "validation.tooLong")
    .transform((v) => (v === "" ? undefined : v))
    .optional();
const optionalDate = z.union([z.literal("").transform(() => undefined), z.string().refine(isLocalDate, "validation.date")]).optional();

export const profileSchema = z.object({
  personnelNumber: optionalText(32),
  position: optionalText(120),
  departmentId: z.union([z.literal("").transform(() => undefined), uuid]).optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  hiredOn: optionalDate,
  workPhone: optionalText(32),
});

export const credentialSchema = z
  .object({
    kind: z.enum(CREDENTIAL_KINDS),
    title: z.string().trim().min(2, "validation.required").max(160, "validation.tooLong"),
    number: optionalText(64),
    issuer: optionalText(160),
    issuedOn: optionalDate,
    expiresOn: optionalDate,
  })
  .refine((v) => !v.issuedOn || !v.expiresOn || v.expiresOn >= v.issuedOn, { message: "validation.rangeOrder", path: ["expiresOn"] });

export const leaveSchema = z
  .object({
    kind: z.enum(LEAVE_KINDS),
    startsOn: z.string().refine(isLocalDate, "validation.date"),
    endsOn: z.string().refine(isLocalDate, "validation.date"),
  })
  .refine((v) => v.endsOn >= v.startsOn, { message: "validation.rangeOrder", path: ["endsOn"] })
  .refine((v) => (Date.parse(v.endsOn) - Date.parse(v.startsOn)) / 86_400_000 <= 365, { message: "validation.tooLong", path: ["endsOn"] });

/** What colleagues see in the doctor's schedule. Sick leave is never named. */
const EXCEPTION_FOR: Record<LeaveKind, ScheduleExceptionKind> = {
  VACATION: "VACATION",
  TRAINING: "TRAINING",
  SICK_LEAVE: "OTHER_ABSENCE",
  UNPAID: "OTHER_ABSENCE",
  OTHER: "OTHER_ABSENCE",
};

async function loadMember(tx: Tx, ctx: ClinicContext, membershipId: string) {
  const id = uuid.safeParse(membershipId);
  if (!id.success) throw new DomainError("errors.notFound");
  // Membership's policy also exposes the caller's own memberships elsewhere: filter by tenant explicitly.
  const m = await tx.membership.findFirst({ where: { id: id.data, tenantId: ctx.tenant.id }, include: { doctorProfile: { select: { id: true } } } });
  if (!m) throw new DomainError("errors.notFound");
  return m;
}

export async function listStaffHr(ctx: ClinicContext) {
  requirePermission(ctx, "hr.read");
  const today = localDateToDbDate(todayIn(ctx.tenant.timezone));
  const soon = localDateToDbDate(addDays(todayIn(ctx.tenant.timezone), CREDENTIAL_WARNING_DAYS));
  return inClinic(ctx, async (tx) => {
    const members = await tx.membership.findMany({
      where: { tenantId: ctx.tenant.id, status: { in: ["ACTIVE", "SUSPENDED"] } },
      include: {
        user: { select: { fullName: true, email: true } },
        roles: { include: { role: { select: { key: true, name: true } } } },
        staffProfile: { include: { department: { select: { name: true } } } },
        credentials: { where: { archivedAt: null }, select: { expiresOn: true } },
        leaves: { where: { status: "APPROVED", endsOn: { gte: today } }, orderBy: { startsOn: "asc" }, take: 1 },
      },
      orderBy: { createdAt: "asc" },
    });
    return members.map((m) => ({
      ...m,
      expiredCredentials: m.credentials.filter((c) => c.expiresOn && c.expiresOn < today).length,
      expiringCredentials: m.credentials.filter((c) => c.expiresOn && c.expiresOn >= today && c.expiresOn <= soon).length,
      onLeaveNow: Boolean(m.leaves[0] && m.leaves[0].startsOn <= today),
      nextLeave: m.leaves[0] ?? null,
    }));
  });
}

export async function getStaffHr(ctx: ClinicContext, membershipId: string) {
  requirePermission(ctx, "hr.read");
  return inClinic(ctx, async (tx) => {
    const m = await loadMember(tx, ctx, membershipId);
    const [user, profile, credentials, leaves, roles] = await sequential([
      tx.user.findUnique({ where: { id: m.userId }, select: { fullName: true, email: true } }),
      tx.staffProfile.findUnique({ where: { membershipId: m.id } }),
      tx.staffCredential.findMany({ where: { membershipId: m.id, archivedAt: null }, orderBy: [{ expiresOn: { sort: "asc", nulls: "last" } }] }),
      tx.staffLeave.findMany({ where: { membershipId: m.id }, orderBy: { startsOn: "desc" }, take: 50 }),
      tx.membershipRole.findMany({ where: { membershipId: m.id, tenantId: ctx.tenant.id }, include: { role: { select: { key: true, name: true } } } }),
    ]);
    return { membership: m, user, profile, credentials, leaves, roles: roles.map((r) => r.role), isDoctor: Boolean(m.doctorProfile) };
  });
}

export async function saveStaffProfile(ctx: ClinicContext, membershipId: string, raw: unknown, meta: RequestMeta) {
  requirePermission(ctx, "hr.manage");
  const input = profileSchema.parse(raw);
  try {
    await inClinic(ctx, async (tx) => {
      const m = await loadMember(tx, ctx, membershipId);
      if (input.departmentId && !(await tx.department.findUnique({ where: { id: input.departmentId } }))) throw new DomainError("errors.notFound");
      const data = {
        personnelNumber: input.personnelNumber ?? null,
        position: input.position ?? null,
        departmentId: input.departmentId ?? null,
        employmentType: input.employmentType,
        hiredOn: input.hiredOn ? localDateToDbDate(input.hiredOn) : null,
        workPhone: input.workPhone ?? null,
        updatedById: ctx.principal.user.id,
      };
      await tx.staffProfile.upsert({ where: { membershipId: m.id }, create: { id: uuidv7(), tenantId: ctx.tenant.id, membershipId: m.id, ...data }, update: data });
      await auditClinic(tx, ctx, meta, { action: "hr.profile_saved", entityType: "Membership", entityId: m.id });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new DomainError("errors.personnelNumberTaken");
    throw e;
  }
}

export async function addCredential(ctx: ClinicContext, membershipId: string, raw: unknown, meta: RequestMeta) {
  requirePermission(ctx, "hr.manage");
  const input = credentialSchema.parse(raw);
  const id = uuidv7();
  await inClinic(ctx, async (tx) => {
    const m = await loadMember(tx, ctx, membershipId);
    await tx.staffCredential.create({
      data: {
        id,
        tenantId: ctx.tenant.id,
        membershipId: m.id,
        kind: input.kind,
        title: input.title,
        number: input.number,
        issuer: input.issuer,
        issuedOn: input.issuedOn ? localDateToDbDate(input.issuedOn) : null,
        expiresOn: input.expiresOn ? localDateToDbDate(input.expiresOn) : null,
        createdById: ctx.principal.user.id,
      },
    });
    await auditClinic(tx, ctx, meta, { action: "hr.credential_added", entityType: "Membership", entityId: m.id, metadata: { kind: input.kind } });
  });
  return id;
}

export async function archiveCredential(ctx: ClinicContext, credentialId: string, meta: RequestMeta) {
  requirePermission(ctx, "hr.manage");
  await inClinic(ctx, async (tx) => {
    const c = await tx.staffCredential.findUnique({ where: { id: uuid.parse(credentialId) } });
    if (!c || c.archivedAt) throw new DomainError("errors.notFound");
    await tx.staffCredential.update({ where: { id: c.id }, data: { archivedAt: new Date() } });
    await auditClinic(tx, ctx, meta, { action: "hr.credential_archived", entityType: "Membership", entityId: c.membershipId });
  });
}

/**
 * Records approved leave. For doctors, each day becomes a day off in their
 * schedule (booking is refused); existing active appointments in the period
 * are counted so the front desk can reschedule them.
 */
export async function recordLeave(ctx: ClinicContext, membershipId: string, raw: unknown, meta: RequestMeta): Promise<{ id: string; conflicts: number }> {
  requirePermission(ctx, "hr.manage");
  const input = leaveSchema.parse(raw);
  const tz = ctx.tenant.timezone;
  return inClinic(ctx, async (tx) => {
    const m = await loadMember(tx, ctx, membershipId);
    const overlap = await tx.staffLeave.findFirst({
      where: { membershipId: m.id, status: "APPROVED", startsOn: { lte: localDateToDbDate(input.endsOn) }, endsOn: { gte: localDateToDbDate(input.startsOn) } },
    });
    if (overlap) throw new DomainError("errors.leaveOverlap");
    const id = uuidv7();
    await tx.staffLeave.create({
      data: { id, tenantId: ctx.tenant.id, membershipId: m.id, kind: input.kind, startsOn: localDateToDbDate(input.startsOn), endsOn: localDateToDbDate(input.endsOn), createdById: ctx.principal.user.id },
    });
    let conflicts = 0;
    if (m.doctorProfile) {
      const days: string[] = [];
      for (let d = input.startsOn; d <= input.endsOn; d = addDays(d, 1)) days.push(d);
      const existing = await tx.scheduleException.findMany({ where: { doctorProfileId: m.doctorProfile.id, date: { in: days.map(localDateToDbDate) } }, select: { date: true } });
      const taken = new Set(existing.map((e) => e.date.toISOString().slice(0, 10)));
      const free = days.filter((d) => !taken.has(d));
      if (free.length > 0) {
        await tx.scheduleException.createMany({
          data: free.map((d) => ({ id: uuidv7(), tenantId: ctx.tenant.id, doctorProfileId: m.doctorProfile!.id, date: localDateToDbDate(d), kind: EXCEPTION_FOR[input.kind], leaveId: id })),
        });
      }
      conflicts = await tx.appointment.count({
        where: {
          doctorProfileId: m.doctorProfile.id,
          status: { in: ["BOOKED", "CHECKED_IN"] },
          startsAt: { gte: localToInstant(input.startsOn, 0, tz), lt: localToInstant(addDays(input.endsOn, 1), 0, tz) },
        },
      });
    }
    // Category stays out of the audit metadata (sick leave is health-adjacent).
    await auditClinic(tx, ctx, meta, { action: "hr.leave_recorded", entityType: "Membership", entityId: m.id, metadata: { days: days(input.startsOn, input.endsOn), conflicts } });
    return { id, conflicts };
  });
}

function days(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1;
}

export async function cancelLeave(ctx: ClinicContext, leaveId: string, meta: RequestMeta) {
  requirePermission(ctx, "hr.manage");
  await inClinic(ctx, async (tx) => {
    const l = await tx.staffLeave.findUnique({ where: { id: uuid.parse(leaveId) } });
    if (!l || l.status !== "APPROVED") throw new DomainError("errors.notFound");
    await tx.staffLeave.update({ where: { id: l.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    await tx.scheduleException.deleteMany({ where: { leaveId: l.id } });
    await auditClinic(tx, ctx, meta, { action: "hr.leave_cancelled", entityType: "Membership", entityId: l.membershipId });
  });
}

/** Dashboard alerts: credentials expired or expiring soon, people on leave today. */
export async function hrAlerts(ctx: ClinicContext) {
  const staff = await listStaffHr(ctx);
  return {
    credentials: staff.filter((s) => s.expiredCredentials + s.expiringCredentials > 0),
    onLeave: staff.filter((s) => s.onLeaveNow),
  };
}
