import { AlertTriangle, Building2, Clock, PauseCircle, TrendingUp, Users, Wallet, ZapOff } from "lucide-react";
import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { moneyFormatter } from "@/components/money";
import { Badge, ButtonLink, Card, CardHeader, EmptyState, PageHeader, STATUS_TONE, Stat, Table, Td, Th } from "@/components/ui/primitives";
import { localizedName } from "@/lib/localized";
import { requirePlatform } from "@/server/auth/guards";
import { billingOverview } from "@/server/platform/billing";

/**
 * The SuperAdmin's control room: every clinic's subscription, debt and activity
 * on one screen. Activity figures are counts computed in the database; no
 * clinical content reaches the console.
 */
export default async function AdminDashboard() {
  const p = await requirePlatform("tenants.read");
  const [t, format, locale, money, o] = await Promise.all([getTranslations(), getFormatter(), getLocale(), moneyFormatter(), billingOverview(p)]);
  const count = (s: string) => o.rows.filter((r) => r.tenant.status === s).length;
  const overdue = o.rows.filter((r) => (r.balance?.overdueDays ?? 0) > 0).sort((a, b) => (b.balance?.overdueDays ?? 0) - (a.balance?.overdueDays ?? 0));
  const inactive = o.rows.filter((r) => r.tenant.status === "ACTIVE" && (r.daysSinceLogin === null || r.daysSinceLogin >= o.inactiveAfterDays));
  const nearLimit = o.rows.filter((r) => r.nearLimit);
  const activeStaff = o.rows.reduce((s, r) => s + (r.activity?.staff7d ?? 0), 0);
  const currency = o.rows.find((r) => r.tenant.subscription)?.tenant.subscription?.plan.currency ?? "UZS";

  return (
    <>
      <PageHeader
        title={t("admin.dashboard.title")}
        description={t("admin.dashboard.subtitle")}
        action={
          <ButtonLink href="/admin/clinics/new">
            <Building2 aria-hidden className="size-4" />
            {t("admin.dashboard.newClinic")}
          </ButtonLink>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat label={t("admin.control.mrr")} value={money(o.mrr, currency)} icon={<TrendingUp className="size-4" />} />
        <Stat label={t("admin.control.debt")} value={money(o.debt, currency)} hint={t("admin.control.overdueCount", { count: overdue.length })} icon={<Wallet className="size-4" />} />
        <Stat label={t("admin.dashboard.tenantsActive")} value={format.number(count("ACTIVE"))} hint={t("admin.control.trialCount", { count: count("TRIAL") })} icon={<Building2 className="size-4" />} />
        <Stat label={t("admin.dashboard.tenantsSuspended")} value={format.number(count("SUSPENDED"))} icon={<PauseCircle className="size-4" />} />
        <Stat label={t("admin.control.staff7d")} value={format.number(activeStaff)} icon={<Users className="size-4" />} />
        <Stat label={t("admin.control.inactive", { days: o.inactiveAfterDays })} value={format.number(inactive.length)} icon={<ZapOff className="size-4" />} />
        <Stat label={t("admin.control.nearLimit")} value={format.number(nearLimit.length)} icon={<AlertTriangle className="size-4" />} />
        <Stat label={t("admin.control.suspendRule")} value={t("admin.control.days", { count: o.settings.suspendAfterDays })} hint={o.settings.autoSuspend ? t("admin.control.autoOn") : t("admin.control.autoOff")} icon={<Clock className="size-4" />} />
      </div>

      {overdue.length > 0 ? (
        <Card className="mt-6 overflow-hidden">
          <CardHeader title={t("admin.control.overdueTitle")} action={<ButtonLink href="/admin/billing" variant="ghost" size="sm">{t("nav.subscriptions")}</ButtonLink>} />
          <Table caption={t("admin.control.overdueTitle")}>
            <thead>
              <tr>
                <Th>{t("admin.clinics.colName")}</Th>
                <Th className="text-right">{t("admin.control.debt")}</Th>
                <Th className="text-right">{t("admin.control.overdueDays")}</Th>
                <Th>{t("admin.clinics.colStatus")}</Th>
              </tr>
            </thead>
            <tbody>
              {overdue.map((r) => (
                <tr key={r.tenant.id}>
                  <Td>
                    <Link href={`/admin/clinics/${r.tenant.id}#billing`} className="font-medium hover:text-accent">
                      {r.tenant.name}
                    </Link>
                  </Td>
                  <Td label={t("admin.control.debt")} className="text-right tabular-nums">{money(r.balance!.debtMinor, r.balance!.currency)}</Td>
                  <Td label={t("admin.control.overdueDays")} className="text-right tabular-nums">
                    <Badge tone={r.balance!.overdueDays > o.settings.suspendAfterDays ? "danger" : "warning"}>{format.number(r.balance!.overdueDays)}</Badge>
                  </Td>
                  <Td>
                    <Badge tone={STATUS_TONE[r.tenant.status]}>{t(`status.${r.tenant.status}`)}</Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : null}

      <Card className="mt-6 overflow-hidden">
        <CardHeader title={t("admin.control.allTitle")} description={t("admin.control.allHint")} />
        {o.rows.length === 0 ? (
          <EmptyState icon={<Building2 className="size-6" />} title={t("admin.clinics.empty")} />
        ) : (
          <Table caption={t("admin.control.allTitle")}>
            <thead>
              <tr>
                <Th>{t("admin.clinics.colName")}</Th>
                <Th>{t("admin.clinics.colPlan")}</Th>
                <Th className="text-right">{t("admin.control.debt")}</Th>
                <Th>{t("admin.control.lastActivity")}</Th>
                <Th className="text-right">{t("admin.control.staffCol")}</Th>
                <Th className="text-right">{t("admin.control.visits30d")}</Th>
                <Th className="text-right">{t("admin.control.patients30d")}</Th>
              </tr>
            </thead>
            <tbody>
              {o.rows.map((r) => {
                const plan = r.tenant.subscription?.plan;
                const a = r.activity;
                return (
                  <tr key={r.tenant.id} className="transition-colors hover:bg-surface-2">
                    <Td>
                      <Link href={`/admin/clinics/${r.tenant.id}`} className="font-medium hover:text-accent">
                        {r.tenant.name}
                      </Link>
                      <span className="mt-1 flex flex-wrap gap-1">
                        <Badge tone={STATUS_TONE[r.tenant.status]}>{t(`status.${r.tenant.status}`)}</Badge>
                        {r.nearLimit ? <Badge tone="warning">{t("admin.control.limitBadge")}</Badge> : null}
                      </span>
                    </Td>
                    <Td label={t("admin.clinics.colPlan")} className="text-text-2">
                      {plan ? localizedName(plan.name, locale) : "—"}
                      {r.tenant.subscription?.status === "TRIALING" && r.tenant.subscription.trialEndsAt ? (
                        <span className="block text-[12px] text-text-3">{t("admin.control.trialUntil", { date: format.dateTime(r.tenant.subscription.trialEndsAt, { dateStyle: "medium" }) })}</span>
                      ) : null}
                    </Td>
                    <Td label={t("admin.control.debt")} className="text-right tabular-nums">
                      {r.balance && r.balance.debtMinor > 0n ? (
                        <span className={r.balance.overdueDays > 0 ? "font-medium text-danger" : undefined}>{money(r.balance.debtMinor, r.balance.currency)}</span>
                      ) : (
                        <span className="text-text-3">—</span>
                      )}
                    </Td>
                    <Td label={t("admin.control.lastActivity")} className="text-text-2">
                      {a?.lastLoginAt ? format.relativeTime(new Date(a.lastLoginAt)) : t("common.never")}
                    </Td>
                    <Td label={t("admin.control.staffCol")} className="text-right tabular-nums">
                      {format.number(a?.staff7d ?? 0)} / {format.number(a?.activeStaff ?? 0)}
                      {plan?.maxUsers != null ? <span className="text-text-3"> ({format.number(plan.maxUsers)})</span> : null}
                    </Td>
                    <Td label={t("admin.control.visits30d")} className="text-right tabular-nums">{format.number(a?.appointments30d ?? 0)}</Td>
                    <Td label={t("admin.control.patients30d")} className="text-right tabular-nums">{format.number(a?.newPatients30d ?? 0)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
