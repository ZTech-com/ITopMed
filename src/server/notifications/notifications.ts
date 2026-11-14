import "server-only";
import { createTranslator } from "use-intl/core";
import { z } from "zod";
import type { ConsentPurpose, NotificationChannel, NotificationKind } from "@/generated/prisma/client";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";
import type { ClinicContext } from "../auth/clinic-auth";
import type { RequestMeta } from "../auth/platform-auth";
import { auditClinic, inClinic, requirePermission } from "../clinic/context";
import { escapeHtml, sendEmail } from "../email";
import { env } from "../env";
import { withAppContext, type Tx } from "../db";
import { logger } from "../logger";
import { uuidv7 } from "../security/crypto";
import { sendSms, smsEnabled } from "./sms";

/**
 * Patient notifications through a transactional outbox.
 *
 *  - Enqueued inside the same transaction as the event (booking, cancellation,
 *    result release), only for channels the patient has consented to.
 *  - The outbox stores no text, address or clinical content. At send time the
 *    dispatcher re-checks consent, recipient and relevance (e.g. a reminder for
 *    a cancelled visit is skipped), renders the message in the patient's
 *    language and sends it.
 *  - Messages never contain clinical details: no diagnoses, no results, no
 *    doctor specialty — only clinic, date/time, branch and portal links.
 *  - Email uses the configured transport (SMTP, or the simulated dev mailbox);
 *    SMS is SIMULATED until a real provider is contracted (see ./sms.ts).
 */

export const NOTIFICATION_KINDS = ["APPOINTMENT_BOOKED", "APPOINTMENT_REMINDER", "APPOINTMENT_CANCELLED", "RESULTS_READY"] as const satisfies readonly NotificationKind[];
const CONSENT_FOR: Record<NotificationChannel, ConsentPurpose> = { SMS: "SMS_REMINDERS", EMAIL: "EMAIL_NOTIFICATIONS" };
const MAX_ATTEMPTS = 3;
const RETRY_MINUTES = [5, 30, 120];

export interface Settings {
  appointmentBooked: boolean;
  appointmentReminder: boolean;
  reminderHoursBefore: number;
  appointmentCancelled: boolean;
  resultsReady: boolean;
}
const DEFAULTS: Settings = { appointmentBooked: true, appointmentReminder: true, reminderHoursBefore: 24, appointmentCancelled: true, resultsReady: true };

async function settingsIn(tx: Tx, tenantId: string): Promise<Settings> {
  const s = await tx.notificationSettings.findUnique({ where: { tenantId } });
  return s ?? DEFAULTS;
}

function enabled(s: Settings, kind: NotificationKind) {
  return {
    APPOINTMENT_BOOKED: s.appointmentBooked,
    APPOINTMENT_REMINDER: s.appointmentReminder,
    APPOINTMENT_CANCELLED: s.appointmentCancelled,
    RESULTS_READY: s.resultsReady,
  }[kind];
}

/** Channels this patient can be reached on right now (address present + consent active + transport available). */
async function reachableChannels(tx: Tx, patientId: string): Promise<{ channel: NotificationChannel; to: string }[]> {
  const p = await tx.patient.findUnique({ where: { id: patientId }, select: { phone: true, email: true, status: true } });
  if (!p || p.status !== "ACTIVE") return [];
  const consents = await tx.patientConsent.findMany({ where: { patientId, withdrawnAt: null, purpose: { in: ["SMS_REMINDERS", "EMAIL_NOTIFICATIONS"] } }, select: { purpose: true } });
  const has = (c: ConsentPurpose) => consents.some((x) => x.purpose === c);
  const out: { channel: NotificationChannel; to: string }[] = [];
  if (p.phone && smsEnabled() && has("SMS_REMINDERS")) out.push({ channel: "SMS", to: p.phone });
  if (p.email && has("EMAIL_NOTIFICATIONS")) out.push({ channel: "EMAIL", to: p.email });
  return out;
}

async function enqueue(tx: Tx, tenantId: string, e: { patientId: string; kind: NotificationKind; subjectId: string; dueAt: Date }) {
  const s = await settingsIn(tx, tenantId);
  if (!enabled(s, e.kind)) return 0;
  if (e.kind === "RESULTS_READY") {
    const portal = await tx.tenantModule.findUnique({ where: { tenantId_moduleKey: { tenantId, moduleKey: "patient_portal" } }, select: { enabled: true } });
    if (!portal?.enabled) return 0;
    const acc = await tx.patientAccount.findFirst({ where: { patientId: e.patientId, tenantId }, select: { status: true } });
    if (acc?.status !== "ACTIVE") return 0; // nothing to point the patient to
  }
  const channels = await reachableChannels(tx, e.patientId);
  if (channels.length === 0) return 0;
  const r = await tx.notification.createMany({
    data: channels.map((c) => ({
      id: uuidv7(),
      tenantId,
      patientId: e.patientId,
      channel: c.channel,
      kind: e.kind,
      subjectId: e.subjectId,
      dueAt: e.dueAt,
      dedupeKey: `${e.kind}:${e.subjectId}:${c.channel}`,
    })),
    skipDuplicates: true,
  });
  return r.count;
}

// ───────────── Event hooks (call inside the event's transaction) ─────────────

export async function notifyAppointmentBooked(tx: Tx, tenantId: string, a: { id: string; patientId: string; startsAt: Date }) {
  const now = new Date();
  await enqueue(tx, tenantId, { patientId: a.patientId, kind: "APPOINTMENT_BOOKED", subjectId: a.id, dueAt: now });
  const s = await settingsIn(tx, tenantId);
  const remindAt = new Date(a.startsAt.getTime() - s.reminderHoursBefore * 3_600_000);
  // Only when the reminder would still arrive meaningfully before the visit.
  if (remindAt.getTime() > now.getTime() + 30 * 60_000) {
    await enqueue(tx, tenantId, { patientId: a.patientId, kind: "APPOINTMENT_REMINDER", subjectId: a.id, dueAt: remindAt });
  }
}

/** The visit moved: the pending reminder follows the new time (or is skipped when too late now). */
export async function notifyAppointmentRescheduled(tx: Tx, tenantId: string, a: { id: string; patientId: string; startsAt: Date }) {
  const s = await settingsIn(tx, tenantId);
  const remindAt = new Date(a.startsAt.getTime() - s.reminderHoursBefore * 3_600_000);
  const inTime = remindAt.getTime() > Date.now() + 30 * 60_000;
  await tx.notification.updateMany({
    where: { tenantId, subjectId: a.id, kind: "APPOINTMENT_REMINDER", status: "PENDING" },
    data: inTime ? { dueAt: remindAt } : { status: "SKIPPED", lastError: "rescheduled" },
  });
  if (inTime) await enqueue(tx, tenantId, { patientId: a.patientId, kind: "APPOINTMENT_REMINDER", subjectId: a.id, dueAt: remindAt });
}

export async function notifyAppointmentCancelled(tx: Tx, tenantId: string, a: { id: string; patientId: string; startsAt: Date }) {
  if (a.startsAt.getTime() < Date.now()) return;
  await enqueue(tx, tenantId, { patientId: a.patientId, kind: "APPOINTMENT_CANCELLED", subjectId: a.id, dueAt: new Date() });
}

export async function notifyResultsReady(tx: Tx, tenantId: string, o: { id: string; patientId: string }) {
  await enqueue(tx, tenantId, { patientId: o.patientId, kind: "RESULTS_READY", subjectId: o.id, dueAt: new Date() });
}

// ───────────── Rendering ─────────────

async function translator(locale: Locale) {
  const messages = (await import(`../../../messages/${locale}.json`)).default;
  return createTranslator({ locale, messages, namespace: "notifications" });
}

interface Rendered {
  sms: string;
  subject: string;
  text: string;
}

async function render(
  kind: NotificationKind,
  locale: Locale,
  v: { clinic: string; slug: string; timeZone: string; startsAt?: Date; branch?: string; branchPhone?: string | null },
): Promise<Rendered> {
  const t = await translator(locale);
  const when = v.startsAt
    ? {
        date: new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone: v.timeZone }).format(v.startsAt),
        time: new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: v.timeZone }).format(v.startsAt),
      }
    : { date: "", time: "" };
  const values = { clinic: v.clinic, branch: v.branch ?? "", phone: v.branchPhone ?? "", ...when, link: `${env().APP_URL.replace(/\/$/, "")}/p/${v.slug}` };
  const k = kind as string;
  const contact = v.branchPhone ? ` ${t("contact", { phone: v.branchPhone })}` : "";
  const sms = `${t(`${k}.sms` as never, values as never)}${kind === "RESULTS_READY" ? "" : contact}`;
  const text = `${t(`${k}.body` as never, values as never)}${kind === "RESULTS_READY" ? "" : contact}\n\n${t("footer", { clinic: v.clinic })}`;
  return { sms, subject: t(`${k}.subject` as never, values as never), text };
}

function emailHtml(locale: string, r: Rendered) {
  const paragraphs = r.text.split("\n\n").map((p) => `<p>${escapeHtml(p)}</p>`).join("");
  return `<!doctype html><html lang="${locale}"><body style="font-family:-apple-system,Segoe UI,Inter,sans-serif;color:#1d1d1f;max-width:560px;margin:auto;padding:24px"><p style="font-size:13px;color:#6e6e73">ITop Med</p>${paragraphs}</body></html>`;
}

// ───────────── Dispatcher ─────────────

export interface DispatchResult {
  sent: number;
  failed: number;
  skipped: number;
  retried: number;
}

/**
 * Sends due notifications of one clinic. Each message is claimed with a row
 * lock (SKIP LOCKED) so parallel workers never send twice. Runs as the clinic
 * role with tenant context only (system job, no user).
 */
export async function processDueNotifications(tenantId: string, opts: { now?: Date; limit?: number } = {}): Promise<DispatchResult> {
  const now = opts.now ?? new Date();
  const result: DispatchResult = { sent: 0, failed: 0, skipped: 0, retried: 0 };
  const due = await withAppContext({ tenantId }, (tx) =>
    tx.notification.findMany({ where: { status: "PENDING", dueAt: { lte: now } }, select: { id: true }, orderBy: { dueAt: "asc" }, take: opts.limit ?? 100 }),
  );
  for (const { id } of due) {
    const outcome = await withAppContext({ tenantId }, (tx) => dispatchOne(tx, tenantId, id, now));
    if (outcome) result[outcome] += 1;
  }
  return result;
}

async function dispatchOne(tx: Tx, tenantId: string, id: string, now: Date): Promise<keyof DispatchResult | null> {
  const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Notification" WHERE id = ${id}::uuid AND status = 'PENDING' FOR UPDATE SKIP LOCKED`;
  if (!locked[0]) return null; // another worker has it, or it is done
  const n = await tx.notification.findUniqueOrThrow({ where: { id } });
  const skip = async (code: string) => {
    await tx.notification.update({ where: { id }, data: { status: "SKIPPED", lastError: code } });
    return "skipped" as const;
  };

  const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true, slug: true, timezone: true, defaultLocale: true, status: true } });
  if (!tenant || (tenant.status !== "ACTIVE" && tenant.status !== "TRIAL")) return skip("clinic_inactive");
  const patient = await tx.patient.findUnique({ where: { id: n.patientId }, select: { phone: true, email: true, preferredLocale: true, status: true } });
  if (!patient || patient.status !== "ACTIVE") return skip("patient_inactive");
  const consent = await tx.patientConsent.findFirst({ where: { patientId: n.patientId, purpose: CONSENT_FOR[n.channel], withdrawnAt: null }, select: { id: true } });
  if (!consent) return skip("no_consent");
  const to = n.channel === "SMS" ? patient.phone : patient.email;
  if (!to) return skip("no_address");
  if (n.channel === "SMS" && !smsEnabled()) return skip("sms_off");

  let startsAt: Date | undefined;
  let branch: { name: string; phone: string | null } | undefined;
  if (n.kind !== "RESULTS_READY") {
    const a = n.subjectId ? await tx.appointment.findUnique({ where: { id: n.subjectId }, select: { status: true, startsAt: true, branch: { select: { name: true, phone: true } } } }) : null;
    if (!a) return skip("subject_missing");
    if (n.kind === "APPOINTMENT_CANCELLED" ? a.status !== "CANCELLED" : a.status !== "BOOKED") return skip("stale");
    if (n.kind === "APPOINTMENT_REMINDER" && a.startsAt <= now) return skip("stale");
    startsAt = a.startsAt;
    branch = a.branch;
  } else {
    const acc = await tx.patientAccount.findFirst({ where: { patientId: n.patientId, tenantId }, select: { status: true } });
    if (acc?.status !== "ACTIVE") return skip("portal_inactive");
  }

  const locale: Locale = isLocale(patient.preferredLocale) ? patient.preferredLocale : isLocale(tenant.defaultLocale) ? tenant.defaultLocale : DEFAULT_LOCALE;
  const msg = await render(n.kind, locale, { clinic: tenant.name, slug: tenant.slug, timeZone: tenant.timezone, startsAt, branch: branch?.name, branchPhone: branch?.phone });

  let delivered = false;
  let transport: string | null = null;
  if (n.channel === "SMS") {
    const r = await sendSms(to, msg.sms);
    delivered = r.delivered;
    transport = r.transport;
  } else {
    const r = await sendEmail({ to, subject: msg.subject, text: msg.text, html: emailHtml(locale, msg) });
    delivered = r.delivered;
    transport = env().EMAIL_TRANSPORT;
  }

  const attempts = n.attempts + 1;
  if (delivered) {
    await tx.notification.update({ where: { id }, data: { status: "SENT", attempts, sentAt: new Date(), transport, lastError: null } });
    return "sent";
  }
  logger.warn("notification.delivery_failed", { channel: n.channel, attempts });
  if (attempts >= MAX_ATTEMPTS) {
    await tx.notification.update({ where: { id }, data: { status: "FAILED", attempts, transport, lastError: "delivery_failed" } });
    return "failed";
  }
  await tx.notification.update({ where: { id }, data: { attempts, transport, lastError: "delivery_failed", dueAt: new Date(now.getTime() + RETRY_MINUTES[attempts - 1]! * 60_000) } });
  return "retried";
}

// ───────────── Clinic screens ─────────────

export const settingsSchema = z.object({
  appointmentBooked: z.boolean(),
  appointmentReminder: z.boolean(),
  reminderHoursBefore: z.coerce.number().int().min(1, "validation.range").max(72, "validation.range"),
  appointmentCancelled: z.boolean(),
  resultsReady: z.boolean(),
});

export async function getNotificationSettings(ctx: ClinicContext): Promise<Settings> {
  requirePermission(ctx, "clinic.settings.read");
  return inClinic(ctx, (tx) => settingsIn(tx, ctx.tenant.id));
}

export async function saveNotificationSettings(ctx: ClinicContext, raw: unknown, meta: RequestMeta) {
  requirePermission(ctx, "clinic.settings.manage");
  const input = settingsSchema.parse(raw);
  await inClinic(ctx, async (tx) => {
    await tx.notificationSettings.upsert({ where: { tenantId: ctx.tenant.id }, create: { tenantId: ctx.tenant.id, ...input, updatedById: ctx.principal.user.id }, update: { ...input, updatedById: ctx.principal.user.id } });
    await auditClinic(tx, ctx, meta, { action: "notifications.settings_saved", entityType: "Tenant", entityId: ctx.tenant.id });
  });
}

/** Delivery log (no message content exists to show). */
export async function listNotifications(ctx: ClinicContext, opts: { status?: string } = {}) {
  requirePermission(ctx, "clinic.settings.read");
  const status = z.enum(["PENDING", "SENT", "FAILED", "SKIPPED"]).safeParse(opts.status);
  return inClinic(ctx, async (tx) => {
    const [rows, counts] = [
      await tx.notification.findMany({
        where: status.success ? { status: status.data } : {},
        include: { patient: { select: { mrn: true } } },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      await tx.notification.groupBy({ by: ["status"], _count: { _all: true } }),
    ];
    return { rows, counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) as Partial<Record<string, number>> };
  });
}

/** "Send due now" for clinics without a running worker (and for checking delivery). */
export async function sendDueNow(ctx: ClinicContext, meta: RequestMeta) {
  requirePermission(ctx, "clinic.settings.manage");
  const r = await processDueNotifications(ctx.tenant.id);
  await inClinic(ctx, (tx) => auditClinic(tx, ctx, meta, { action: "notifications.dispatched", entityType: "Tenant", entityId: ctx.tenant.id, metadata: { sent: r.sent, failed: r.failed, skipped: r.skipped } }));
  return r;
}
