import { randomUUID } from "node:crypto";
import { Printer } from "lucide-react";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { moneyFormatter } from "@/components/money";
import { minorToDecimalString } from "@/lib/money";
import { patientName } from "@/components/patients";
import { Form, SelectField, SubmitButton, TextField } from "@/components/ui/form";
import { Alert, Badge, ButtonLink, Card, CardBody, CardHeader, DescriptionList, PageHeader, STATUS_TONE, buttonClass } from "@/components/ui/primitives";
import { requireClinic } from "@/server/auth/guards";
import { PAYMENT_METHODS, REFUND_REASONS, VOID_REASONS, getInvoice } from "@/server/billing/billing";
import { listServices } from "@/server/clinic/resources";
import { invoiceLineAction, issueInvoiceAction, paymentAction, refundAction, voidInvoiceAction } from "../../../../billing-actions";

export default async function InvoicePage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const ctx = await requireClinic(slug, "billing.read");
  const inv = await getInvoice(ctx, id);
  if (!inv) notFound();
  const [t, format, money] = await Promise.all([getTranslations(), getFormatter(), moneyFormatter()]);
  const tz = ctx.tenant.timezone;
  const s = ctx.tenant.slug;
  const draft = inv.status === "DRAFT";
  const payable = inv.status === "ISSUED" || inv.status === "PARTIALLY_PAID";
  const can = (p: Parameters<typeof ctx.permissions.has>[0]) => ctx.permissions.has(p);
  const services = draft && can("billing.invoice") ? (await listServices(ctx)).filter((x) => x.currency === inv.currency) : [];
  const outstanding = inv.totalMinor - inv.paidMinor;
  const hidden = (
    <>
      <input type="hidden" name="$slug" value={s} />
      <input type="hidden" name="invoiceId" value={inv.id} />
    </>
  );

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        eyebrow={t("clinic.billing.title")}
        title={inv.number ?? t("clinic.billing.newInvoice")}
        description={`${patientName(inv.patient)} · ${inv.patient.mrn}`}
        action={
          <>
            <Badge tone={STATUS_TONE[inv.status] ?? "neutral"}>{t(`status.${inv.status}`)}</Badge>
            {inv.payments.length > 0 ? (
              <ButtonLink href={`/c/${s}/billing/${inv.id}/receipt`} variant="secondary" size="sm">
                <Printer aria-hidden className="size-4" />
                {t("clinic.billing.receipt")}
              </ButtonLink>
            ) : null}
          </>
        }
      />

      <Card>
        <CardBody>
          <DescriptionList
            items={[
              { label: t("clinic.billing.branch"), value: inv.branch.name },
              { label: t("clinic.billing.createdAt"), value: format.dateTime(inv.createdAt, { dateStyle: "medium", timeStyle: "short", timeZone: tz }) },
              ...(inv.issuedAt ? [{ label: t("clinic.billing.issuedAt"), value: format.dateTime(inv.issuedAt, { dateStyle: "medium", timeStyle: "short", timeZone: tz }) }] : []),
              ...(inv.appointment ? [{ label: t("clinic.billing.visit"), value: `${format.dateTime(inv.appointment.startsAt, { dateStyle: "medium", timeStyle: "short", timeZone: tz })} · ${inv.appointment.doctor.membership.user.fullName}` }] : []),
            ]}
          />
        </CardBody>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title={t("clinic.billing.lines")} description={draft ? t("clinic.billing.issueHint") : undefined} />
        {/* Phone: one card per line — nothing to scroll sideways, every sum fully visible. */}
        <ul className="divide-y divide-border border-y border-border sm:hidden">
          {inv.lines.map((l) => (
            <li key={l.id} className="px-5 py-3 text-[14px]">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 font-medium">{l.description}</p>
                <p className="whitespace-nowrap text-right font-semibold tabular-nums">{money(l.totalMinor, inv.currency)}</p>
              </div>
              <p className="mt-0.5 text-[13px] tabular-nums text-text-2">
                {l.quantity} × {money(l.unitPriceMinor, inv.currency)}
                {l.discountMinor > 0n ? ` · ${t("clinic.billing.discount")} −${money(l.discountMinor, inv.currency)}` : ""}
              </p>
              {draft && can("billing.invoice") ? (
                <Form action={invoiceLineAction} className="mt-1 space-y-0">
                  {hidden}
                  <input type="hidden" name="lineId" value={l.id} />
                  <button name="op" value="remove" className="min-h-8 text-[13px] text-text-3 hover:text-danger">{t("clinic.billing.remove")}</button>
                </Form>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[560px] text-[14px]">
            <thead>
              <tr className="text-left text-[12px] uppercase tracking-[0.04em] text-text-3">
                <th className="px-6 py-2 font-medium">{t("clinic.billing.service")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("clinic.billing.quantity")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("clinic.billing.unitPrice")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("clinic.billing.discount")}</th>
                <th className="px-6 py-2 text-right font-medium">{t("clinic.billing.lineTotal")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border border-y border-border">
              {inv.lines.map((l) => (
                <tr key={l.id}>
                  <td className="px-6 py-2.5">
                    <span className="font-medium">{l.description}</span>
                    {draft && can("billing.invoice") ? (
                      <Form action={invoiceLineAction} className="inline-block space-y-0 pl-2 align-middle">
                        {hidden}
                        <input type="hidden" name="lineId" value={l.id} />
                        <button name="op" value="remove" className="text-[12px] text-text-3 hover:text-danger">{t("clinic.billing.remove")}</button>
                      </Form>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{l.quantity}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{money(l.unitPriceMinor, inv.currency)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-text-2">{l.discountMinor > 0n ? `−${money(l.discountMinor, inv.currency)}` : "—"}</td>
                  <td className="px-6 py-2.5 text-right font-medium tabular-nums">{money(l.totalMinor, inv.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {inv.lines.length === 0 ? <p className="px-6 py-3 text-[14px] text-text-2">{t("clinic.billing.noLines")}</p> : null}
        <dl className="ml-auto max-w-sm space-y-1 px-5 py-4 text-[14px] sm:px-6">
          <div className="flex justify-between gap-3"><dt className="text-text-2">{t("clinic.billing.subtotal")}</dt><dd className="text-right tabular-nums">{money(inv.subtotalMinor, inv.currency)}</dd></div>
          {inv.discountMinor > 0n ? <div className="flex justify-between gap-3"><dt className="text-text-2">{t("clinic.billing.discount")}</dt><dd className="text-right tabular-nums">−{money(inv.discountMinor, inv.currency)}</dd></div> : null}
          <div className="flex justify-between gap-3 text-[16px] font-semibold"><dt>{t("clinic.billing.total")}</dt><dd className="text-right tabular-nums">{money(inv.totalMinor, inv.currency)}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-text-2">{t("clinic.billing.paid")}</dt><dd className="text-right tabular-nums">{money(inv.paidMinor, inv.currency)}</dd></div>
          {payable ? <div className="flex justify-between gap-3 font-semibold text-accent"><dt>{t("clinic.billing.outstanding")}</dt><dd className="text-right tabular-nums">{money(outstanding, inv.currency)}</dd></div> : null}
        </dl>

        {draft && can("billing.invoice") ? (
          <CardBody className="space-y-4 border-t border-border">
            {services.length > 0 ? (
              <Form action={invoiceLineAction}>
                {hidden}
                <div className="grid gap-3 sm:grid-cols-[2fr_80px_1fr_auto] sm:items-end">
                  <SelectField name="serviceId" label={t("clinic.billing.service")} options={services.map((x) => ({ value: x.id, label: `${x.name} · ${money(x.priceMinor, x.currency)}` }))} />
                  <TextField name="quantity" label={t("clinic.billing.quantity")} inputMode="numeric" defaultValue="1" />
                  <TextField name="discount" label={t("clinic.billing.discount")} hint={t("clinic.billing.discountHint")} inputMode="numeric" />
                  <button name="op" value="add" className={buttonClass("secondary", "lg")}>{t("clinic.billing.addLine")}</button>
                </div>
              </Form>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Form action={voidInvoiceAction} className="space-y-0">
                {hidden}
                <input type="hidden" name="reason" value="CREATED_IN_ERROR" />
                <button className={buttonClass("ghost", "lg")}>{t("clinic.billing.void")}</button>
              </Form>
              <Form action={issueInvoiceAction} className="space-y-0">
                {hidden}
                <SubmitButton>{t("clinic.billing.issue")}</SubmitButton>
              </Form>
            </div>
          </CardBody>
        ) : null}
      </Card>

      {inv.status !== "DRAFT" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title={t("clinic.billing.payments")} />
            {inv.payments.length === 0 ? (
              <CardBody><p className="text-[14px] text-text-2">{t("clinic.billing.noPayments")}</p></CardBody>
            ) : (
              <ul className="divide-y divide-border">
                {inv.payments.map((p) => {
                  const refundable = p.amountMinor - p.refundedMinor;
                  return (
                    <li key={p.id} className="space-y-2 px-6 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[14px]">
                        <span>
                          <span className="font-semibold tabular-nums">{money(p.amountMinor, p.currency)}</span> · {t(`paymentMethod.${p.method}`)}
                          {p.externalRef ? <span className="font-mono text-[12px] text-text-3"> · {p.externalRef}</span> : null}
                        </span>
                        <span className="text-[12.5px] text-text-3">{format.dateTime(p.receivedAt, { dateStyle: "short", timeStyle: "short", timeZone: tz })}</span>
                      </div>
                      {p.refunds.map((r) => (
                        <p key={r.id} className="text-[13px] text-text-2">
                          −{money(r.amountMinor, p.currency)} · {t(`refundReason.${r.reason}`)} · {format.dateTime(r.createdAt, { dateStyle: "short", timeStyle: "short", timeZone: tz })}
                        </p>
                      ))}
                      {refundable > 0n && can("billing.refund") ? (
                        <details>
                          <summary className="cursor-pointer text-[13px] font-medium text-accent">{t("clinic.billing.refund")}</summary>
                          <Form action={refundAction} className="mt-2">
                            <input type="hidden" name="$slug" value={s} />
                            <input type="hidden" name="paymentId" value={p.id} />
                            <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                            <div className="grid gap-3 sm:grid-cols-2">
                              <TextField name="amount" label={t("clinic.billing.amount")} inputMode="numeric" defaultValue={minorToDecimalString(refundable, p.currency)} />
                              <SelectField name="reason" label={t("clinic.billing.refundReason")} options={REFUND_REASONS.map((r) => ({ value: r, label: t(`refundReason.${r}`) }))} />
                            </div>
                            <SubmitButton variant="secondary">{t("clinic.billing.refund")}</SubmitButton>
                          </Form>
                        </details>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {payable && can("billing.payment") ? (
            <Card>
              <CardHeader title={t("clinic.billing.recordPayment")} description={t("clinic.billing.providerManual")} />
              <CardBody>
                <Form action={paymentAction}>
                  {hidden}
                  <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <TextField name="amount" label={t("clinic.billing.amount")} inputMode="numeric" defaultValue={minorToDecimalString(outstanding, inv.currency)} />
                    <SelectField name="method" label={t("clinic.billing.method")} options={PAYMENT_METHODS.map((m) => ({ value: m, label: t(`paymentMethod.${m}`) }))} />
                  </div>
                  <TextField name="externalRef" label={t("clinic.billing.externalRef")} hint={t("clinic.billing.externalRefHint")} optionalLabel={t("common.optional")} />
                  <SubmitButton full>{t("clinic.billing.recordPayment")}</SubmitButton>
                </Form>
              </CardBody>
            </Card>
          ) : null}

          {inv.status === "ISSUED" && inv.paidMinor === 0n && can("billing.invoice") ? (
            <Card>
              <CardHeader title={t("clinic.billing.void")} />
              <CardBody>
                <Form action={voidInvoiceAction}>
                  {hidden}
                  <SelectField name="reason" label={t("clinic.billing.voidReason")} options={VOID_REASONS.map((r) => ({ value: r, label: t(`voidReason.${r}`) }))} />
                  <SubmitButton variant="danger">{t("clinic.billing.void")}</SubmitButton>
                </Form>
              </CardBody>
            </Card>
          ) : null}
          {inv.status === "VOID" ? <Alert tone="neutral">{t("clinic.billing.voided")}</Alert> : null}
        </div>
      ) : null}
    </div>
  );
}
