import "server-only";
import type { AppointmentStatus } from "@/generated/prisma/client";
import type { ClinicContext } from "../auth/clinic-auth";
import { MFA_REQUIRED_ROLES } from "../auth/clinic-auth";
import { sequential, type Tx } from "../db";
import { addDays, instantToLocalDate, localToInstant } from "../scheduling/time";
import { DomainError } from "../errors";
import { inClinic } from "./context";

const DAY = 86_400_000;

export interface StaffAmount {
  userId: string | null;
  name: string | null;
  count: number;
  amountMinor: bigint;
  grossMinor?: bigint;
}

/**
 * Owner's control centre: what is happening today and what needs attention —
 * money, cash, discounts, refunds, unsigned notes, unbilled visits, no-shows,
 * security. Built only from data the clinic already has; no clinical content
 * (counts and names of staff only). Money sections need `finance.reports`.
 */
export async function controlCenter(ctx: ClinicContext) {
  if (!ctx.permissions.has("audit.read")) throw new DomainError("errors.forbidden");
  const finance = ctx.permissions.has("finance.reports");
  const tz = ctx.tenant.timezone;
  const cur = ctx.tenant.currency;
  const today = instantToLocalDate(new Date(), tz);
  const dayStart = localToInstant(today, 0, tz);
  const dayEnd = localToInstant(addDays(today, 1), 0, tz);
  const monthStart = localToInstant(`${today.slice(0, 8)}01`, 0, tz);
  const dayOfMonth = Number(today.slice(8, 10));
  const prevMonthFirst = (() => {
    const [y, m] = today.split("-").map(Number) as [number, number];
    const py = m === 1 ? y - 1 : y;
    const pm = m === 1 ? 12 : m - 1;
    return `${py}-${String(pm).padStart(2, "0")}-01`;
  })();
  const prevStart = localToInstant(prevMonthFirst, 0, tz);
  const prevSamePoint = localToInstant(addDays(prevMonthFirst, dayOfMonth), 0, tz);
  const since30 = new Date(Date.now() - 30 * DAY);
  const before24h = new Date(Date.now() - DAY);

  return inClinic(ctx, async (tx) => {
    const t = ctx.tenant.id;
    const [apptToday, noShow30, total30, draftNotes, openEncounters, unbilled, breakGlass, supportGrants] = await sequential([
      tx.appointment.groupBy({ by: ["status"], where: { tenantId: t, startsAt: { gte: dayStart, lt: dayEnd } }, _count: { _all: true } }),
      tx.appointment.count({ where: { tenantId: t, status: "NO_SHOW", startsAt: { gte: since30 } } }),
      tx.appointment.count({ where: { tenantId: t, startsAt: { gte: since30, lt: new Date() }, status: { not: "CANCELLED" } } }),
      tx.clinicalNote.groupBy({ by: ["authorId"], where: { tenantId: t, status: "DRAFT", createdAt: { lt: before24h } }, _count: { _all: true } }),
      tx.encounter.count({ where: { tenantId: t, status: "OPEN", startedAt: { lt: before24h } } }),
      tx.appointment.count({ where: { tenantId: t, status: "COMPLETED", startsAt: { gte: since30 }, invoice: null } }),
      tx.auditEvent.count({ where: { tenantId: t, action: "emr.break_glass", createdAt: { gte: since30 } } }),
      tx.supportAccessGrant.count({ where: { tenantId: t, status: "APPROVED", expiresAt: { gt: new Date() } } }),
    ]);

    const appointments = Object.fromEntries(apptToday.map((g) => [g.status, g._count._all])) as Partial<Record<AppointmentStatus, number>>;

    // Privileged staff who still sign in without two-step verification.
    const privileged = await tx.membership.findMany({
      where: { tenantId: t, status: "ACTIVE", roles: { some: { role: { key: { in: [...MFA_REQUIRED_ROLES] } } } }, user: { mfaEnabledAt: null } },
      select: { user: { select: { fullName: true } } },
    });

    let money = null;
    const shifts: { id: string; cashier: string | null; branch: string; openedAt: Date; expectedMinor: bigint; currency: string }[] = [];
    let shiftDifferences: { cashier: string | null; closedAt: Date; differenceMinor: bigint; currency: string }[] = [];
    let discounts: StaffAmount[] = [];
    let refunds: StaffAmount[] = [];
    let voids = 0;
    if (finance) {
      const net = async (from: Date, to: Date) => {
        const [p, r] = await sequential([
          tx.payment.aggregate({ where: { tenantId: t, currency: cur, receivedAt: { gte: from, lt: to } }, _sum: { amountMinor: true } }),
          tx.refund.aggregate({ where: { tenantId: t, createdAt: { gte: from, lt: to }, payment: { currency: cur } }, _sum: { amountMinor: true } }),
        ]);
        return (p._sum.amountMinor ?? 0n) - (r._sum.amountMinor ?? 0n);
      };
      const todayNet = await net(dayStart, dayEnd);
      const monthNet = await net(monthStart, dayEnd);
      const prevMonthNet = await net(prevStart, prevSamePoint);
      const open = await tx.invoice.findMany({ where: { tenantId: t, currency: cur, status: { in: ["ISSUED", "PARTIALLY_PAID"] } }, select: { totalMinor: true, paidMinor: true } });
      money = {
        currency: cur,
        todayNet,
        monthNet,
        prevMonthNet,
        outstandingMinor: open.reduce((s, i) => s + i.totalMinor - i.paidMinor, 0n),
        outstandingInvoices: open.length,
      };

      const openShifts = await tx.cashShift.findMany({ where: { tenantId: t, status: "OPEN" }, include: { branch: { select: { name: true } } }, orderBy: { openedAt: "asc" } });
      for (const s of openShifts) {
        const [paid, refunded] = await sequential([
          tx.payment.aggregate({ where: { cashShiftId: s.id, method: "CASH" }, _sum: { amountMinor: true } }),
          tx.refund.aggregate({ where: { cashShiftId: s.id }, _sum: { amountMinor: true } }),
        ]);
        shifts.push({ id: s.id, cashier: s.cashierId, branch: s.branch.name, openedAt: s.openedAt, expectedMinor: s.openingFloatMinor + (paid._sum.amountMinor ?? 0n) - (refunded._sum.amountMinor ?? 0n), currency: s.currency });
      }
      const diffs = await tx.cashShift.findMany({ where: { tenantId: t, status: "CLOSED", closedAt: { gte: since30 }, differenceMinor: { not: 0n } }, orderBy: { closedAt: "desc" }, take: 20 });
      shiftDifferences = diffs.map((d) => ({ cashier: d.cashierId, closedAt: d.closedAt!, differenceMinor: d.differenceMinor ?? 0n, currency: d.currency }));

      const disc = await tx.invoiceLine.groupBy({
        by: ["createdById"],
        where: { tenantId: t, discountMinor: { gt: 0n }, createdAt: { gte: since30 }, invoice: { currency: cur, status: { not: "VOID" } } },
        _count: { _all: true },
        _sum: { discountMinor: true, totalMinor: true },
      });
      discounts = disc
        .map((d) => ({ userId: d.createdById, name: null, count: d._count._all, amountMinor: d._sum.discountMinor ?? 0n, grossMinor: (d._sum.totalMinor ?? 0n) + (d._sum.discountMinor ?? 0n) }))
        .sort((a, b) => Number(b.amountMinor - a.amountMinor));
      const ref = await tx.refund.groupBy({ by: ["createdById"], where: { tenantId: t, createdAt: { gte: since30 }, payment: { currency: cur } }, _count: { _all: true }, _sum: { amountMinor: true } });
      refunds = ref.map((r) => ({ userId: r.createdById, name: null, count: r._count._all, amountMinor: r._sum.amountMinor ?? 0n })).sort((a, b) => Number(b.amountMinor - a.amountMinor));
      voids = await tx.invoice.count({ where: { tenantId: t, status: "VOID", voidedAt: { gte: since30 } } });
    }

    // Names of the people involved (staff of this clinic only).
    const ids = new Set<string>([...draftNotes.map((d) => d.authorId), ...shifts.map((s) => s.cashier ?? ""), ...shiftDifferences.map((s) => s.cashier ?? ""), ...discounts.map((d) => d.userId ?? ""), ...refunds.map((r) => r.userId ?? "")].filter(Boolean));
    const users = ids.size ? await tx.user.findMany({ where: { id: { in: [...ids] }, memberships: { some: { tenantId: t } } }, select: { id: true, fullName: true } }) : [];
    const nameOf = (id: string | null) => (id ? (users.find((u) => u.id === id)?.fullName ?? null) : null);

    return {
      today,
      appointments,
      noShow: { count: noShow30, total: total30 },
      clinical: { draftNotes: draftNotes.map((d) => ({ name: nameOf(d.authorId), count: d._count._all })), openEncounters, unbilledVisits: unbilled },
      security: { breakGlass, supportGrants, withoutMfa: privileged.map((p) => p.user.fullName) },
      money,
      shifts: shifts.map((s) => ({ ...s, cashier: nameOf(s.cashier) })),
      shiftDifferences: shiftDifferences.map((s) => ({ ...s, cashier: nameOf(s.cashier) })),
      discounts: discounts.map((d) => ({ ...d, name: nameOf(d.userId) })),
      refunds: refunds.map((r) => ({ ...r, name: nameOf(r.userId) })),
      voids,
    };
  });
}

export type ControlCenter = Awaited<ReturnType<typeof controlCenter>>;
export type { Tx };
