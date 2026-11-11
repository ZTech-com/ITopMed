import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Card, PageHeader } from "@/components/ui/primitives";
import { listMyResults } from "@/server/portal/data";
import { requirePatient } from "@/server/portal/guards";

export default async function PortalResultsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = await requirePatient(slug);
  const [t, format, results] = await Promise.all([getTranslations(), getFormatter(), listMyResults(p)]);
  const base = `/p/${p.tenant.slug}`;
  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title={t("portal.results.title")} description={t("portal.results.subtitle")} />
      <Card>
        {results.length === 0 ? (
          <p className="px-5 py-6 text-[14px] text-text-2 sm:px-6">{t("portal.results.none")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {results.map((r) => {
              const abnormal = r.items.reduce((n, i) => n + i.results.filter((x) => x.flag !== "NORMAL").length, 0);
              return (
                <li key={r.id}>
                  <Link href={`${base}/results/${r.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-sunken sm:px-6">
                    <span className="min-w-0">
                      <span className="block text-[15px] font-medium">{r.items.map((i) => i.name).join(", ")}</span>
                      <span className="block text-[13px] text-text-3">
                        {format.dateTime(r.orderedAt, { dateStyle: "medium", timeZone: p.tenant.timezone })}
                        {r.doctor ? ` · ${r.doctor.fullName}` : ""} · {r.branch.name}
                      </span>
                    </span>
                    <span className={`text-[13px] font-medium ${abnormal > 0 ? "text-danger" : "text-success"}`}>
                      {abnormal > 0 ? t("portal.results.outOfRangeCount", { count: abnormal }) : t("portal.results.allNormal")}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <p className="text-[13px] text-text-3">{t("portal.results.disclaimer")}</p>
    </div>
  );
}
