import { FlaskConical } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { patientName } from "@/components/patients";
import { Badge, ButtonLink, Card, EmptyState, PageHeader, STATUS_TONE, buttonClass } from "@/components/ui/primitives";
import type { LabOrderStatus } from "@/generated/prisma/client";
import { requireClinic } from "@/server/auth/guards";
import { labWorklist } from "@/server/lab/lab";

const STAGES: Record<string, { statuses: LabOrderStatus[]; label: string }> = {
  collect: { statuses: ["ORDERED"], label: "toCollect" },
  progress: { statuses: ["COLLECTED"], label: "inProgress" },
  verify: { statuses: ["RESULTED"], label: "toVerify" },
  done: { statuses: ["VERIFIED"], label: "done" },
};

export default async function LabPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ stage?: string }> }) {
  const { slug } = await params;
  const ctx = await requireClinic(slug);
  const t = await getTranslations();
  if (!["lab.read", "lab.collect", "lab.process", "lab.verify"].some((p) => ctx.permissions.has(p as never))) return <p className="text-text-2">{t("errors.forbidden")}</p>;
  const stageKey = (await searchParams).stage ?? "collect";
  const stage = STAGES[stageKey] ?? STAGES.collect!;
  const [format, orders] = await Promise.all([getFormatter(), labWorklist(ctx, stage.statuses)]);
  const tz = ctx.tenant.timezone;
  const base = `/c/${ctx.tenant.slug}/lab`;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("clinic.lab.title")}
        description={t("clinic.lab.subtitle")}
        action={ctx.permissions.has("lab.manage") ? <ButtonLink href={`${base}/tests`} variant="secondary">{t("nav.labTests")}</ButtonLink> : null}
      />
      <nav className="flex flex-wrap gap-2" aria-label={t("clinic.lab.title")}>
        {Object.entries(STAGES).map(([k, v]) => (
          <Link key={k} href={`${base}?stage=${k}`} aria-current={k === stageKey ? "page" : undefined} className={buttonClass(k === stageKey ? "primary" : "secondary", "sm")}>
            {t(`clinic.lab.${v.label}` as never)}
          </Link>
        ))}
      </nav>
      <Card className="overflow-hidden">
        {orders.length === 0 ? (
          <EmptyState icon={<FlaskConical className="size-6" />} title={t("clinic.lab.empty")} />
        ) : (
          <ul className="divide-y divide-border">
            {orders.map((o) => (
              <li key={o.id}>
                <Link href={`${base}/${o.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 hover:bg-surface-2 sm:px-6">
                  <div className="min-w-0">
                    <p className="font-medium">
                      <span className="font-mono">{o.number}</span> · {patientName(o.patient)}
                    </p>
                    <p className="truncate text-[13px] text-text-2">
                      {o.items.map((i) => i.name).join(", ")} · {format.dateTime(o.orderedAt, { dateStyle: "short", timeStyle: "short", timeZone: tz })} · {o.branch.name}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {o.priority === "URGENT" ? <Badge tone="danger">{t("priority.URGENT")}</Badge> : null}
                    <Badge tone={STATUS_TONE[o.status] ?? "neutral"}>{t(`status.${o.status}`)}</Badge>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
