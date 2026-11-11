import { getFormatter, getTranslations } from "next-intl/server";
import { moneyFormatter } from "@/components/money";
import { Badge, Card, CardBody, CardHeader, PageHeader, STATUS_TONE } from "@/components/ui/primitives";
import { listMyInvoices } from "@/server/portal/data";
import { requirePatient } from "@/server/portal/guards";

export default async function PortalInvoicesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = await requirePatient(slug);
  const [t, format, money, invoices] = await Promise.all([getTranslations(), getFormatter(), moneyFormatter(), listMyInvoices(p)]);
  const tz = p.tenant.timezone;
  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title={t("portal.invoices.title")} description={t("portal.invoices.subtitle")} />
      {invoices.length === 0 ? (
        <Card>
          <p className="px-5 py-6 text-[14px] text-text-2 sm:px-6">{t("portal.invoices.none")}</p>
        </Card>
      ) : (
        invoices.map((inv) => {
          const due = inv.status === "VOID" ? 0n : inv.totalMinor - inv.paidMinor;
          return (
            <Card key={inv.id}>
              <CardHeader
                title={<span className="font-mono">{inv.number ?? "—"}</span>}
                description={`${inv.issuedAt ? format.dateTime(inv.issuedAt, { dateStyle: "medium", timeZone: tz }) : ""} · ${inv.branch.name}`}
                action={<Badge tone={STATUS_TONE[inv.status] ?? "neutral"}>{t(`status.${inv.status}` as never)}</Badge>}
              />
              <CardBody className="space-y-3">
                <ul className="space-y-1.5 text-[14px]">
                  {inv.lines.map((l) => (
                    <li key={l.id} className="flex justify-between gap-3">
                      <span className="min-w-0">
                        {l.description}
                        {l.quantity > 1 ? <span className="text-text-3"> × {l.quantity}</span> : null}
                        {l.discountMinor > 0n ? <span className="text-text-3"> · {t("portal.invoices.discount")} −{money(l.discountMinor, inv.currency)}</span> : null}
                      </span>
                      <span className="tabular-nums">{money(l.totalMinor, inv.currency)}</span>
                    </li>
                  ))}
                </ul>
                <div className="space-y-1 border-t border-border pt-3 text-[14px]">
                  <p className="flex justify-between font-semibold">
                    <span>{t("portal.invoices.total")}</span>
                    <span className="tabular-nums">{money(inv.totalMinor, inv.currency)}</span>
                  </p>
                  <p className="flex justify-between text-text-2">
                    <span>{t("portal.invoices.paid")}</span>
                    <span className="tabular-nums">{money(inv.paidMinor, inv.currency)}</span>
                  </p>
                  {due > 0n ? (
                    <p className="flex justify-between font-semibold text-danger">
                      <span>{t("portal.invoices.due")}</span>
                      <span className="tabular-nums">{money(due, inv.currency)}</span>
                    </p>
                  ) : null}
                </div>
                {inv.payments.length > 0 ? (
                  <ul className="space-y-1 text-[13px] text-text-3">
                    {inv.payments.map((pay) => (
                      <li key={pay.id} className="flex justify-between gap-3">
                        <span>
                          {format.dateTime(pay.receivedAt, { dateStyle: "medium", timeStyle: "short", timeZone: tz })} · {t(`paymentMethod.${pay.method}` as never)}
                          {pay.refundedMinor > 0n ? ` · ${t("portal.invoices.refunded")} ${money(pay.refundedMinor, pay.currency)}` : ""}
                        </span>
                        <span className="tabular-nums">{money(pay.amountMinor, pay.currency)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </CardBody>
            </Card>
          );
        })
      )}
      <p className="text-[13px] text-text-3">{t("portal.invoices.payNote")}</p>
    </div>
  );
}
