import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { moneyFormatter } from "@/components/money";
import { Form, SubmitButton, TextField } from "@/components/ui/form";
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, STATUS_TONE, Table, Td, Th } from "@/components/ui/primitives";
import { requirePlatform } from "@/server/auth/guards";
import { billingOverview } from "@/server/platform/billing";
import { billingSettingsAction, runBillingNowAction } from "../../actions";

/** ITop Med's own billing of clinics: rules, the monthly run, and every clinic's balance. */
export default async function BillingPage() {
  const p = await requirePlatform("subscriptions.manage");
  const [t, format, money, o] = await Promise.all([getTranslations(), getFormatter(), moneyFormatter(), billingOverview(p)]);
  const rows = o.rows.filter((r) => r.balance).sort((a, b) => Number((b.balance?.debtMinor ?? 0n) - (a.balance?.debtMinor ?? 0n)));

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader title={t("admin.billing.title")} description={t("admin.billing.subtitle")} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("admin.billing.rules")} description={t("admin.billing.rulesHint")} />
          <CardBody>
            <Form action={billingSettingsAction}>
              <TextField name="dueDays" label={t("admin.billing.dueDays")} hint={t("admin.billing.dueDaysHint")} defaultValue={String(o.settings.dueDays)} inputMode="numeric" required />
              <TextField name="suspendAfterDays" label={t("admin.billing.suspendAfterDays")} hint={t("admin.billing.suspendAfterDaysHint")} defaultValue={String(o.settings.suspendAfterDays)} inputMode="numeric" required />
              <label className="flex items-start gap-3 text-[14px]">
                <input type="checkbox" name="autoSuspend" defaultChecked={o.settings.autoSuspend} className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" />
                <span>{t("admin.billing.autoSuspend")}</span>
              </label>
              <SubmitButton>{t("common.save")}</SubmitButton>
            </Form>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("admin.billing.runTitle")} description={t("admin.billing.runHint")} />
          <CardBody>
            <Form action={runBillingNowAction}>
              <SubmitButton variant="secondary">{t("admin.billing.runNow")}</SubmitButton>
            </Form>
          </CardBody>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader title={t("admin.billing.balances")} />
        {rows.length === 0 ? (
          <EmptyState title={t("admin.billing.noInvoices")} />
        ) : (
          <Table caption={t("admin.billing.balances")}>
            <thead>
              <tr>
                <Th>{t("admin.clinics.colName")}</Th>
                <Th className="text-right">{t("admin.billing.invoiced")}</Th>
                <Th className="text-right">{t("admin.billing.paid")}</Th>
                <Th className="text-right">{t("admin.control.debt")}</Th>
                <Th className="text-right">{t("admin.control.overdueDays")}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const b = r.balance!;
                return (
                  <tr key={r.tenant.id}>
                    <Td>
                      <Link href={`/admin/clinics/${r.tenant.id}#billing`} className="font-medium hover:text-accent">
                        {r.tenant.name}
                      </Link>
                      <span className="mt-1 block">
                        <Badge tone={STATUS_TONE[r.tenant.status]}>{t(`status.${r.tenant.status}`)}</Badge>
                      </span>
                    </Td>
                    <Td label={t("admin.billing.invoiced")} className="text-right tabular-nums">{money(b.invoicedMinor, b.currency)}</Td>
                    <Td label={t("admin.billing.paid")} className="text-right tabular-nums">{money(b.paidMinor, b.currency)}</Td>
                    <Td label={t("admin.control.debt")} className="text-right tabular-nums">{b.debtMinor > 0n ? money(b.debtMinor, b.currency) : "—"}</Td>
                    <Td label={t("admin.control.overdueDays")} className="text-right tabular-nums">
                      {b.overdueDays > 0 ? <Badge tone={b.overdueDays > o.settings.suspendAfterDays ? "danger" : "warning"}>{format.number(b.overdueDays)}</Badge> : "—"}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
