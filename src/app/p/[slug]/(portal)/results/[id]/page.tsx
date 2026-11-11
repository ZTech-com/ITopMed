import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { PortalResultTable } from "@/components/portal";
import { PrintButton } from "@/components/print-button";
import { Card, CardBody, DescriptionList, PageHeader } from "@/components/ui/primitives";
import { requestMeta } from "@/server/http";
import { getMyResult } from "@/server/portal/data";
import { requirePatient } from "@/server/portal/guards";

export default async function PortalResultPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const p = await requirePatient(slug);
  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);
  const r = await getMyResult(p, id, await requestMeta());
  if (!r) notFound();
  const tz = p.tenant.timezone;
  const name = [p.patient.lastName, p.patient.firstName, p.patient.middleName].filter(Boolean).join(" ");
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader eyebrow={`${p.tenant.name} · ${r.number}`} title={t("portal.results.detailTitle")} description={`${name} · ${p.patient.mrn}`} action={<PrintButton label={t("portal.results.print")} />} />
      <Card>
        <CardBody>
          <DescriptionList
            items={[
              { label: t("portal.results.ordered"), value: format.dateTime(r.orderedAt, { dateStyle: "medium", timeStyle: "short", timeZone: tz }) },
              { label: t("portal.results.verified"), value: r.verifiedAt ? format.dateTime(r.verifiedAt, { dateStyle: "medium", timeStyle: "short", timeZone: tz }) : "—" },
              { label: t("portal.results.doctor"), value: r.doctor?.fullName ?? "—" },
              { label: t("portal.results.branch"), value: r.branch.name },
            ]}
          />
        </CardBody>
      </Card>
      <Card>
        <CardBody>
          <PortalResultTable items={r.items} />
        </CardBody>
      </Card>
      <p className="text-[13px] text-text-3">{t("portal.results.disclaimer")}</p>
    </div>
  );
}
