import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Letterhead } from "@/components/letterhead";
import { PAPER_PREVIEW, PaperStyle, paperFrom } from "@/components/paper";
import { patientName } from "@/components/patients";
import { AutoPrint, PrintButton } from "@/components/print-button";
import { buttonClass } from "@/components/ui/primitives";
import { requireClinic } from "@/server/auth/guards";
import { getLetterhead } from "@/server/clinic/branding";
import { canUseBranch } from "@/server/clinic/context";
import { withAppContext } from "@/server/db";

/** Queue ticket for the patient: big number, doctor, room, time. No prices, no clinical data. */
export default async function TicketPage({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams: Promise<{ w?: string }> }) {
  const { slug, id } = await params;
  const ctx = await requireClinic(slug, "queue.manage");
  const width = paperFrom((await searchParams).w ?? "80");
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const a = await withAppContext({ tenantId: ctx.tenant.id, userId: ctx.principal.user.id }, (tx) =>
    tx.appointment.findUnique({
      where: { id },
      select: {
        queueNumber: true,
        startsAt: true,
        checkedInAt: true,
        branchId: true,
        patient: { select: { lastName: true, firstName: true, middleName: true } },
        doctor: { select: { specialty: true, membership: { select: { user: { select: { fullName: true } } } } } },
        room: { select: { name: true } },
      },
    }),
  );
  if (!a || !canUseBranch(ctx, a.branchId)) notFound();
  const [t, format, head] = await Promise.all([getTranslations(), getFormatter(), getLetterhead(ctx)]);
  const tz = ctx.tenant.timezone;
  const when = a.checkedInAt ?? a.startsAt;

  return (
    <div className={`mx-auto space-y-4 print:max-w-none ${PAPER_PREVIEW[width]}`}>
      <PaperStyle width={width} />
      <AutoPrint />
      <div className="flex flex-wrap justify-end gap-2 print:hidden">
        {(["80", "58", "a4"] as const).map((w) => (
          <Link key={w} href={`?w=${w}`} className={buttonClass(w === width ? "primary" : "ghost", "sm")}>
            {t(`clinic.desk.paper.${w}`)}
          </Link>
        ))}
        <PrintButton label={t("clinic.desk.printTicket")} />
      </div>
      <article className="space-y-3 rounded-[16px] border border-border bg-surface p-4 text-center print:border-0 print:p-0">
        <Letterhead data={head} compact />
        <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-text-2">{t("clinic.desk.ticketTitle")}</p>
        <p className="text-[64px] font-bold leading-none tabular-nums">{a.queueNumber ?? "—"}</p>
        <div className="space-y-0.5 text-[14px]">
          <p className="font-semibold">{patientName(a.patient)}</p>
          <p>
            {a.doctor.membership.user.fullName} · {t(`specialties.${a.doctor.specialty}` as never)}
          </p>
          {a.room ? <p>{t("clinic.desk.room", { name: a.room.name })}</p> : null}
          <p className="text-text-2">{format.dateTime(when, { dateStyle: "medium", timeStyle: "short", timeZone: tz })}</p>
        </div>
        <p className="border-t border-dashed border-border pt-2 text-[12px] text-text-3">{t("clinic.desk.ticketHint")}</p>
      </article>
    </div>
  );
}
