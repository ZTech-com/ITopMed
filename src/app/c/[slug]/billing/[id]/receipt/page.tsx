import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { moneyFormatter } from "@/components/money";
import { patientName } from "@/components/patients";
import { PrintButton } from "@/components/print-button";
import { requireClinic } from "@/server/auth/guards";
import { getInvoice } from "@/server/billing/billing";
import { withAppContext } from "@/server/db";

/**
 * Printable payment receipt (A5/80 mm friendly). Clearly marked as NOT a
 * fiscal receipt: fiscal (OFD) integration is an external dependency.
 * Contains no clinical information — services and amounts only.
 */
export default async function ReceiptPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const ctx = await requireClinic(slug, "billing.read");
  const inv = await getInvoice(ctx, id);
  if (!inv || inv.status === "DRAFT") notFound();
  const [t, format, money] = await Promise.all([getTranslations(), getFormatter(), moneyFormatter()]);
  const tenant = await withAppContext({ tenantId: ctx.tenant.id, userId: ctx.principal.user.id }, (tx) =>
    tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenant.id }, select: { name: true, legalName: true, taxId: true, address: true, contactPhone: true } }),
  );
  const tz = ctx.tenant.timezone;

  return (
    <div className="mx-auto max-w-md space-y-4 print:max-w-none">
      <div className="flex justify-end print:hidden">
        <PrintButton label={t("clinic.billing.printReceipt")} />
      </div>
      <article className="rounded-[16px] border border-border bg-surface p-6 text-[14px] print:border-0 print:p-0">
        <header className="border-b border-dashed border-border pb-3 text-center">
          <p className="text-[16px] font-semibold">{tenant.legalName ?? tenant.name}</p>
          {tenant.taxId ? <p className="text-[12px] text-text-2">STIR / ИНН {tenant.taxId}</p> : null}
          {tenant.address ? <p className="text-[12px] text-text-2">{tenant.address}</p> : null}
          {tenant.contactPhone ? <p className="text-[12px] text-text-2">{tenant.contactPhone}</p> : null}
        </header>
        <div className="space-y-1 border-b border-dashed border-border py-3">
          <p className="text-center font-semibold">{t("clinic.billing.receiptTitle")}</p>
          <p className="flex justify-between"><span className="text-text-2">{t("clinic.billing.colNumber")}</span><span className="font-mono">{inv.number}</span></p>
          <p className="flex justify-between"><span className="text-text-2">{t("clinic.billing.patient")}</span><span>{patientName(inv.patient)}</span></p>
          <p className="flex justify-between"><span className="text-text-2">{t("clinic.patients.mrn")}</span><span>{inv.patient.mrn}</span></p>
        </div>
        <ul className="space-y-1 border-b border-dashed border-border py-3">
          {inv.lines.map((l) => (
            <li key={l.id} className="flex justify-between gap-3">
              <span>{l.description}{l.quantity > 1 ? ` × ${l.quantity}` : ""}</span>
              <span className="tabular-nums">{money(l.totalMinor, inv.currency)}</span>
            </li>
          ))}
        </ul>
        <div className="space-y-1 border-b border-dashed border-border py-3">
          <p className="flex justify-between font-semibold"><span>{t("clinic.billing.total")}</span><span className="tabular-nums">{money(inv.totalMinor, inv.currency)}</span></p>
          {inv.payments.map((p) => (
            <p key={p.id} className="flex justify-between text-text-2">
              <span>{t(`paymentMethod.${p.method}`)} · {format.dateTime(p.receivedAt, { dateStyle: "short", timeStyle: "short", timeZone: tz })}</span>
              <span className="tabular-nums">{money(p.amountMinor - p.refundedMinor, p.currency)}</span>
            </p>
          ))}
          <p className="flex justify-between"><span>{t("clinic.billing.outstanding")}</span><span className="tabular-nums">{money(inv.totalMinor - inv.paidMinor, inv.currency)}</span></p>
        </div>
        <p className="pt-3 text-center text-[12px] text-text-3">{t("clinic.billing.receiptNotFiscal")}</p>
      </article>
    </div>
  );
}
