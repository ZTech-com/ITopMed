import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { moneyFormatter } from "@/components/money";
import { Alert, Badge, Card, CardBody, CardHeader, PageHeader, Stat } from "@/components/ui/primitives";
import { requireClinic } from "@/server/auth/guards";
import { controlCenter } from "@/server/clinic/oversight";

const STATUSES = ["BOOKED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED", "NO_SHOW", "CANCELLED"] as const;

/** Owner's control centre: today, money, cash, discounts, discipline and security in one place. */
export default async function ControlCenterPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireClinic(slug, "audit.read");
  const [t, format, money, c] = await Promise.all([getTranslations(), getFormatter(), moneyFormatter(), controlCenter(ctx)]);
  const base = `/c/${ctx.tenant.slug}`;
  const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
  const visitsToday = STATUSES.reduce((s, k) => s + (k === "CANCELLED" ? 0 : (c.appointments[k] ?? 0)), 0);
  const change = c.money && c.money.prevMonthNet > 0n ? Number(((c.money.monthNet - c.money.prevMonthNet) * 1000n) / c.money.prevMonthNet) / 10 : null;
  const draftTotal = c.clinical.draftNotes.reduce((s, d) => s + d.count, 0);
  const attention =
    draftTotal + c.clinical.openEncounters + c.clinical.unbilledVisits + c.security.withoutMfa.length + c.shiftDifferences.length + (c.security.breakGlass > 0 ? 1 : 0);

  return (
    <div className="space-y-6">
      <PageHeader title={t("control.title")} description={t("control.subtitle")} />

      {attention === 0 ? <Alert tone="success">{t("control.allGood")}</Alert> : <Alert tone="warning">{t("control.attention", { count: attention })}</Alert>}

      <section aria-labelledby="today-h" className="space-y-3">
        <h2 id="today-h" className="text-[18px] font-semibold">{t("control.today")}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-6">
          <Stat label={t("control.visitsToday")} value={format.number(visitsToday)} hint={t("control.completedOf", { done: c.appointments.COMPLETED ?? 0 })} />
          <Stat label={t("status.CHECKED_IN")} value={format.number((c.appointments.CHECKED_IN ?? 0) + (c.appointments.IN_PROGRESS ?? 0))} hint={t("control.waitingOrInRoom")} />
          <Stat label={t("status.NO_SHOW")} value={format.number(c.appointments.NO_SHOW ?? 0)} hint={t("control.noShowRate", { percent: pct(c.noShow.count, c.noShow.total) })} />
          {c.money ? (
            <>
              <Stat label={t("control.revenueToday")} value={money(c.money.todayNet, c.money.currency)} />
              <Stat
                label={t("control.revenueMonth")}
                value={money(c.money.monthNet, c.money.currency)}
                hint={change === null ? t("control.noPrevMonth") : t("control.vsPrevMonth", { change: `${change > 0 ? "+" : ""}${change}` })}
              />
              <Stat label={t("control.outstanding")} value={money(c.money.outstandingMinor, c.money.currency)} hint={t("control.unpaidInvoices", { count: c.money.outstandingInvoices })} />
            </>
          ) : null}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {c.money ? (
          <Card>
            <CardHeader title={t("control.cash")} description={t("control.cashHint")} />
            <CardBody className="space-y-4 text-[14px]">
              {c.shifts.length === 0 ? <p className="text-text-2">{t("control.noOpenShifts")}</p> : null}
              <ul className="space-y-2">
                {c.shifts.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="min-w-0">
                      <span className="font-medium">{s.cashier ?? "—"}</span> <span className="text-text-2">· {s.branch} · {format.relativeTime(s.openedAt)}</span>
                    </span>
                    <span className="whitespace-nowrap font-semibold tabular-nums">{money(s.expectedMinor, s.currency)}</span>
                  </li>
                ))}
              </ul>
              {c.shiftDifferences.length > 0 ? (
                <div className="border-t border-border pt-3">
                  <p className="mb-2 font-medium text-danger">{t("control.shiftDifferences")}</p>
                  <ul className="space-y-1.5">
                    {c.shiftDifferences.map((d, i) => (
                      <li key={i} className="flex flex-wrap justify-between gap-x-3">
                        <span className="min-w-0 text-text-2">
                          {d.cashier ?? "—"} · {format.dateTime(d.closedAt, { dateStyle: "medium", timeZone: ctx.tenant.timezone })}
                        </span>
                        <span className={d.differenceMinor < 0n ? "whitespace-nowrap font-semibold tabular-nums text-danger" : "whitespace-nowrap tabular-nums"}>
                          {d.differenceMinor > 0n ? "+" : ""}
                          {money(d.differenceMinor, d.currency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </CardBody>
          </Card>
        ) : null}

        {c.money ? (
          <Card>
            <CardHeader title={t("control.discounts")} description={t("control.discountsHint")} action={<Link className="text-[14px] text-accent" href={`${base}/settings`}>{t("control.limits")}</Link>} />
            <CardBody className="space-y-4 text-[14px]">
              {c.discounts.length === 0 ? <p className="text-text-2">{t("control.noDiscounts")}</p> : null}
              <ul className="space-y-2">
                {c.discounts.map((d, i) => (
                  <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="min-w-0">
                      <span className="font-medium">{d.name ?? t("control.unknownStaff")}</span>{" "}
                      <span className="text-text-2">· {t("control.times", { count: d.count })} · {pct(Number(d.amountMinor), Number(d.grossMinor ?? 0n))}%</span>
                    </span>
                    <span className="whitespace-nowrap font-semibold tabular-nums">−{money(d.amountMinor, c.money!.currency)}</span>
                  </li>
                ))}
              </ul>
              <div className="border-t border-border pt-3">
                <p className="mb-2 font-medium">{t("control.refunds")}</p>
                {c.refunds.length === 0 ? <p className="text-text-2">{t("control.noRefunds")}</p> : null}
                <ul className="space-y-1.5">
                  {c.refunds.map((r, i) => (
                    <li key={i} className="flex flex-wrap justify-between gap-x-3">
                      <span className="min-w-0 text-text-2">
                        {r.name ?? t("control.unknownStaff")} · {t("control.times", { count: r.count })}
                      </span>
                      <span className="whitespace-nowrap tabular-nums">{money(r.amountMinor, c.money!.currency)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-text-2">{t("control.voids", { count: c.voids })}</p>
              </div>
            </CardBody>
          </Card>
        ) : null}

        <Card>
          <CardHeader title={t("control.clinical")} description={t("control.clinicalHint")} />
          <CardBody className="space-y-3 text-[14px]">
            <p className="flex flex-wrap justify-between gap-x-3">
              <span>{t("control.draftNotes")}</span>
              <Badge tone={draftTotal ? "warning" : "success"}>{format.number(draftTotal)}</Badge>
            </p>
            {c.clinical.draftNotes.length > 0 ? (
              <ul className="space-y-1 text-text-2">
                {c.clinical.draftNotes.map((d, i) => (
                  <li key={i}>
                    {d.name ?? "—"}: {format.number(d.count)}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="flex flex-wrap justify-between gap-x-3">
              <span>{t("control.openEncounters")}</span>
              <Badge tone={c.clinical.openEncounters ? "warning" : "success"}>{format.number(c.clinical.openEncounters)}</Badge>
            </p>
            <p className="flex flex-wrap justify-between gap-x-3">
              <span>
                {t("control.unbilledVisits")}{" "}
                {c.clinical.unbilledVisits > 0 && ctx.permissions.has("billing.invoice") ? (
                  <Link className="text-accent" href={`${base}/billing`}>
                    {t("control.open")}
                  </Link>
                ) : null}
              </span>
              <Badge tone={c.clinical.unbilledVisits ? "warning" : "success"}>{format.number(c.clinical.unbilledVisits)}</Badge>
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("control.security")} description={t("control.securityHint")} action={<Link className="text-[14px] text-accent" href={`${base}/audit`}>{t("control.activityLog")}</Link>} />
          <CardBody className="space-y-3 text-[14px]">
            <p className="flex flex-wrap justify-between gap-x-3">
              <span>{t("control.withoutMfa")}</span>
              <Badge tone={c.security.withoutMfa.length ? "danger" : "success"}>{format.number(c.security.withoutMfa.length)}</Badge>
            </p>
            {c.security.withoutMfa.length > 0 ? <p className="text-text-2">{c.security.withoutMfa.join(", ")}</p> : null}
            <p className="flex flex-wrap justify-between gap-x-3">
              <span>{t("control.breakGlass")}</span>
              <Badge tone={c.security.breakGlass ? "warning" : "success"}>{format.number(c.security.breakGlass)}</Badge>
            </p>
            <p className="flex flex-wrap justify-between gap-x-3">
              <span>{t("control.supportAccess")}</span>
              <Badge tone={c.security.supportGrants ? "warning" : "neutral"}>{format.number(c.security.supportGrants)}</Badge>
            </p>
          </CardBody>
        </Card>
      </div>
      <p className="text-[13px] text-text-3">{t("control.period")}</p>
    </div>
  );
}
