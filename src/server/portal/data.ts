import "server-only";
import { z } from "zod";
import type { ConsentPurpose } from "@/generated/prisma/client";
import { recordAudit } from "../audit";
import type { RequestMeta } from "../auth/platform-auth";
import { withPortal, type Tx, sequential } from "../db";
import { hashIp, uuidv7 } from "../security/crypto";
import { DomainError } from "../tenancy/provisioning";
import type { PatientPrincipal } from "./auth";

/**
 * Patient-facing reads and the few actions a patient may take. Every query runs
 * as `itopmed_portal`: the database itself limits rows to the signed-in patient,
 * hides draft invoices and unreleased lab results, and has no grants on notes,
 * diagnoses, allergies, vitals or encounters. Explicit `select`s are required
 * because the role only has column-level grants.
 */
const uuid = z.uuid();

function inPortal<T>(p: PatientPrincipal, fn: (tx: Tx) => Promise<T>) {
  return withPortal({ sessionId: p.sessionId }, fn);
}

function audit(tx: Tx, p: PatientPrincipal, meta: RequestMeta, e: { action: string; entityType?: string; entityId?: string; metadata?: Record<string, string | number | boolean | null> }) {
  return recordAudit(tx, { tenantId: p.tenant.id, actorType: "PATIENT", actorId: p.accountId, ipHash: hashIp(meta.ip), userAgent: meta.userAgent, ...e });
}

async function doctorNames(tx: Tx, ids: string[]): Promise<Map<string, { fullName: string; specialty: string }>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await tx.$queryRaw<{ id: string; fullName: string; specialty: string }[]>`SELECT id, "fullName", specialty FROM portal_doctor_names(${unique}::uuid[])`;
  return new Map(rows.map((r) => [r.id, { fullName: r.fullName, specialty: r.specialty }]));
}

/** Patients may cancel up to this long before the visit (also enforced by the database policy). */
export const CANCEL_CUTOFF_MS = 2 * 60 * 60 * 1000;

const appointmentSelect = {
  id: true,
  startsAt: true,
  endsAt: true,
  status: true,
  doctorProfileId: true,
  branch: { select: { name: true, address: true, phone: true } },
  service: { select: { name: true } },
} as const;

export async function listMyAppointments(p: PatientPrincipal) {
  return inPortal(p, async (tx) => {
    const now = new Date();
    const [upcoming, past] = await sequential([
      tx.appointment.findMany({ where: { startsAt: { gte: new Date(now.getTime() - 60 * 60 * 1000) }, status: { in: ["BOOKED", "CHECKED_IN", "IN_PROGRESS"] } }, select: appointmentSelect, orderBy: { startsAt: "asc" }, take: 20 }),
      tx.appointment.findMany({ where: { OR: [{ startsAt: { lt: now } }, { status: { in: ["COMPLETED", "CANCELLED", "NO_SHOW"] } }] }, select: appointmentSelect, orderBy: { startsAt: "desc" }, take: 30 }),
    ]);
    const upcomingIds = new Set(upcoming.map((a) => a.id));
    const pastOnly = past.filter((a) => !upcomingIds.has(a.id));
    const names = await doctorNames(tx, [...upcoming, ...pastOnly].map((a) => a.doctorProfileId));
    const view = (a: (typeof upcoming)[number]) => ({
      ...a,
      doctor: names.get(a.doctorProfileId) ?? null,
      canCancel: a.status === "BOOKED" && a.startsAt.getTime() - now.getTime() > CANCEL_CUTOFF_MS,
    });
    return { upcoming: upcoming.map(view), past: pastOnly.map(view) };
  });
}

export async function cancelMyAppointment(p: PatientPrincipal, appointmentId: string, meta: RequestMeta) {
  const id = uuid.safeParse(appointmentId);
  if (!id.success) throw new DomainError("errors.notFound");
  await inPortal(p, async (tx) => {
    // The policy only matches the patient's own BOOKED appointment more than 2 hours ahead.
    const n = await tx.appointment.updateMany({
      where: { id: id.data, status: "BOOKED" },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancellationReason: "PATIENT_REQUEST" },
    });
    if (n.count !== 1) throw new DomainError("errors.portalCannotCancel");
    await audit(tx, p, meta, { action: "portal.appointment_cancelled", entityType: "Appointment", entityId: id.data });
  });
}

const resultSelect = {
  id: true,
  number: true,
  orderedAt: true,
  verifiedAt: true,
  releasedAt: true,
  doctorProfileId: true,
  branch: { select: { name: true } },
  items: {
    select: {
      id: true,
      name: true,
      results: { select: { id: true, value: true, unit: true, refLow: true, refHigh: true, flag: true, analyte: { select: { name: true, sortOrder: true } } } },
    },
  },
} as const;

/** Only verified results the doctor has released (enforced by the database policy). */
export async function listMyResults(p: PatientPrincipal) {
  return inPortal(p, async (tx) => {
    const orders = await tx.labOrder.findMany({ select: resultSelect, orderBy: { releasedAt: "desc" }, take: 50 });
    const names = await doctorNames(tx, orders.map((o) => o.doctorProfileId));
    return orders.map((o) => ({ ...o, doctor: names.get(o.doctorProfileId) ?? null }));
  });
}

export async function getMyResult(p: PatientPrincipal, orderId: string, meta: RequestMeta) {
  const id = uuid.safeParse(orderId);
  if (!id.success) return null;
  return inPortal(p, async (tx) => {
    const o = await tx.labOrder.findFirst({ where: { id: id.data }, select: resultSelect });
    if (!o) return null;
    const names = await doctorNames(tx, [o.doctorProfileId]);
    await audit(tx, p, meta, { action: "portal.result_viewed", entityType: "LabOrder", entityId: o.id });
    return { ...o, doctor: names.get(o.doctorProfileId) ?? null };
  });
}

/** Issued (not draft) invoices with their lines and payments. */
export async function listMyInvoices(p: PatientPrincipal) {
  return inPortal(p, (tx) =>
    tx.invoice.findMany({
      select: {
        id: true,
        number: true,
        status: true,
        currency: true,
        subtotalMinor: true,
        discountMinor: true,
        totalMinor: true,
        paidMinor: true,
        issuedAt: true,
        branch: { select: { name: true } },
        lines: { select: { id: true, description: true, quantity: true, unitPriceMinor: true, discountMinor: true, totalMinor: true } },
        payments: { select: { id: true, amountMinor: true, currency: true, method: true, refundedMinor: true, receivedAt: true }, orderBy: { receivedAt: "asc" } },
      },
      orderBy: { issuedAt: "desc" },
      take: 50,
    }),
  );
}

export async function portalOverview(p: PatientPrincipal) {
  const [appointments, results, invoices] = await Promise.all([listMyAppointments(p), listMyResults(p), listMyInvoices(p)]);
  const due = invoices.filter((i) => i.status === "ISSUED" || i.status === "PARTIALLY_PAID");
  return {
    next: appointments.upcoming.slice(0, 3),
    results: results.slice(0, 3),
    resultCount: results.length,
    balanceDueMinor: due.reduce((s, i) => s + (i.totalMinor - i.paidMinor), 0n),
    dueCount: due.length,
  };
}

// ───────────── Consents ─────────────

/** Purposes a patient may grant or withdraw online. Portal access itself is managed by the clinic. */
export const SELF_SERVICE_PURPOSES = ["SMS_REMINDERS", "TELEGRAM_NOTIFICATIONS", "EMAIL_NOTIFICATIONS", "MARKETING", "HEALTH_DATA_EXCHANGE"] as const satisfies readonly ConsentPurpose[];

export async function listMyConsents(p: PatientPrincipal) {
  return inPortal(p, (tx) =>
    tx.patientConsent.findMany({ select: { id: true, purpose: true, method: true, grantedAt: true, withdrawnAt: true }, orderBy: { grantedAt: "desc" } }),
  );
}

export async function grantMyConsent(p: PatientPrincipal, purposeRaw: string, meta: RequestMeta) {
  const purpose = z.enum(SELF_SERVICE_PURPOSES).safeParse(purposeRaw);
  if (!purpose.success) throw new DomainError("errors.invalidInput");
  await inPortal(p, async (tx) => {
    const active = await tx.patientConsent.findFirst({ where: { purpose: purpose.data, withdrawnAt: null }, select: { id: true } });
    if (active) return;
    const id = uuidv7();
    await tx.patientConsent.createMany({ data: [{ id, tenantId: p.tenant.id, patientId: p.patientId, purpose: purpose.data, method: "PORTAL", recordedById: p.accountId }] });
    await audit(tx, p, meta, { action: "portal.consent_granted", entityType: "PatientConsent", entityId: id, metadata: { purpose: purpose.data } });
  });
}

export async function withdrawMyConsent(p: PatientPrincipal, consentId: string, meta: RequestMeta) {
  const id = uuid.safeParse(consentId);
  if (!id.success) throw new DomainError("errors.notFound");
  await inPortal(p, async (tx) => {
    const n = await tx.patientConsent.updateMany({ where: { id: id.data, withdrawnAt: null }, data: { withdrawnAt: new Date() } });
    if (n.count !== 1) throw new DomainError("errors.notFound");
    await audit(tx, p, meta, { action: "portal.consent_withdrawn", entityType: "PatientConsent", entityId: id.data });
  });
}
