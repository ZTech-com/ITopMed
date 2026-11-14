import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { moneyFormatter } from "@/components/money";
import { patientName } from "@/components/patients";
import Link from "next/link";
import { Letterhead } from "@/components/letterhead";
import { PAPER_PREVIEW, PaperStyle, paperFrom } from "@/components/paper";
import { AutoPrint, PrintButton } from "@/components/print-button";
import { buttonClass } from "@/components/ui/primitives";
import { getLetterhead } from "@/server/clinic/branding";
import { requireClinic } from "@/server/auth/guards";
import { getInvoice } from "@/server/billing/billing";

/**
 * Printable payment receipt (A5/80 mm friendly). Clearly marked as NOT a
 * fiscal receipt: fiscal (OFD) integration is an external dependency.
 * Contains no clinical information — services and amounts only.
 */
export default async function ReceiptPage({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams: Promise<{ w?: string }> }) {
  const { slug, id } = await params;
  const width = paperFrom((await searchParams).w);
  const ctx = await requireClinic(slug, "billing.read");
  const inv = await getInvoice(ctx, id);
  if (!inv || inv.status === "DRAFT") notFound();
  const [t, format, money] = await Promise.all([getTranslations(), getFormatter(), moneyFormatter()]);
  const head = await getLetterhead(ctx);
  const tz = ctx.tenant.timezone;

  return (
    <div className={`mx-auto space-y-4 print:max-w-none ${width === "a4" ? "max-w-md" : PAPER_PREVIEW[width]}`}>
      <PaperStyle width={width} />
      <AutoPrint />
      <div className="flex flex-wrap justify-end gap-2 print:hidden">
        {(["80", "58", "a4"] as const).map((w) => (
          <Link key={w} href={`?w=${w}`} className={buttonClass(w === width ? "primary" : "ghost", "sm")}>
            {t(`clinic.desk.paper.${w}`)}
          </Link>
        ))}
        <PrintButton label={t("clinic.billing.printReceipt")} />
      </div>
      <article className={`rounded-[16px] border border-border bg-surface text-[14px] print:border-0 print:p-0 ${width === "a4" ? "p-6" : "p-3 text-[13px]"}`}>
        <Letterhead data={head} compact />
        {head.taxId ? <p className="pt-1 text-center text-[12px] text-text-2">STIR / ИНН {head.taxId}</p> : null}
        <div className="space-y-1 border-b border-dashed border-border py-3">
          <p className="text-center font-semibold">{t("clinic.billing.receiptTitle")}</p>
          <p className="flex justify-between"><span className="text-text-2">{t("clinic.billing.colNumber")}</span><span className="font-mono">{inv.number}</span></p>
          <p className="flex justify-between"><span className="text-text-2">{t("clinic.billing.patient")}</span><span>{patientName(inv.patient)}</span></p>
          <p className="flex justify-between"><span className="text-text-2">{t("clinic.patients.mrn")}</span><span>{inv.patient.mrn}</span></p>
        </div>
        <ul className="space-y-1 border-b border-dashed border-border py-3">
          {inv.lines.map((l) => (
            <li key={l.id} className="space-y-0.5">
              <p className="flex justify-between gap-3">
                <span>{l.description}{l.quantity > 1 ? ` × ${l.quantity}` : ""}</span>
                <span className="tabular-nums">{money(l.unitPriceMinor * BigInt(l.quantity), inv.currency)}</span>
              </p>
              {l.discountMinor > 0n ? (
                <p className="flex justify-between gap-3 text-[13px] text-text-2">
                  <span className="pl-3">{t("clinic.billing.discount")}</span>
                  <span className="tabular-nums">−{money(l.discountMinor, inv.currency)}</span>
                </p>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="space-y-1 border-b border-dashed border-border py-3">
          {inv.discountMinor > 0n ? (
            <>
              <p className="flex justify-between text-text-2"><span>{t("clinic.billing.subtotal")}</span><span className="tabular-nums">{money(inv.subtotalMinor, inv.currency)}</span></p>
              <p className="flex justify-between text-text-2"><span>{t("clinic.billing.discount")}</span><span className="tabular-nums">−{money(inv.discountMinor, inv.currency)}</span></p>
            </>
          ) : null}
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
