import { LifeBuoy } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { Form } from "@/components/ui/form";
import { Badge, Card, EmptyState, PageHeader, STATUS_TONE, buttonClass } from "@/components/ui/primitives";
import { requireClinic } from "@/server/auth/guards";
import { effectiveStatus, listGrantsForClinic } from "@/server/support/access";
import { supportDecisionAction } from "../../../clinic-actions";

export default async function SupportAccessPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireClinic(slug, "support_access.decide");
  const [t, format, grants] = await Promise.all([getTranslations(), getFormatter(), listGrantsForClinic(ctx)]);
  const tz = ctx.tenant.timezone;

  return (
    <>
      <PageHeader title={t("clinic.supportAccess.title")} description={t("clinic.supportAccess.subtitle")} />
      <Card className="overflow-hidden">
        {grants.length === 0 ? (
          <EmptyState icon={<LifeBuoy className="size-6" />} title={t("clinic.supportAccess.empty")} />
        ) : (
          <ul className="divide-y divide-border">
            {grants.map((g) => {
              const status = effectiveStatus(g);
              return (
                <li key={g.id} className="space-y-3 px-5 py-4 sm:px-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{t(`supportScope.${g.scope}`)}</p>
                      <p className="text-[13px] text-text-2">
                        {t("clinic.supportAccess.requester")}: {g.requesterName} · {g.requesterEmail}
                      </p>
                    </div>
                    <Badge tone={STATUS_TONE[status] ?? (status === "APPROVED" ? "success" : "accent")}>{t(`status.${status}`)}</Badge>
                  </div>
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-3">
                    <div className="sm:col-span-3">
                      <dt className="text-text-3">{t("clinic.supportAccess.reason")}</dt>
                      <dd className="whitespace-pre-wrap break-words">{g.reason}</dd>
                    </div>
                    <div>
                      <dt className="text-text-3">{t("clinic.supportAccess.duration")}</dt>
                      <dd>{t("clinic.supportAccess.minutes", { count: g.durationMinutes })}</dd>
                    </div>
                    <div>
                      <dt className="text-text-3">{t("clinic.supportAccess.requestedAt")}</dt>
                      <dd>{format.dateTime(g.requestedAt, { dateStyle: "medium", timeStyle: "short", timeZone: tz })}</dd>
                    </div>
                    {g.ticketRef ? (
                      <div>
                        <dt className="text-text-3">{t("clinic.supportAccess.ticket")}</dt>
                        <dd className="font-mono">{g.ticketRef}</dd>
                      </div>
                    ) : null}
                  </dl>
                  {status === "APPROVED" && g.expiresAt ? (
                    <p className="text-[13px] text-success">{t("clinic.supportAccess.activeUntil", { date: format.dateTime(g.expiresAt, { timeStyle: "short", dateStyle: "short", timeZone: tz }) })}</p>
                  ) : null}
                  {status === "REQUESTED" || status === "APPROVED" ? (
                    <Form action={supportDecisionAction} className="space-y-3">
                      <input type="hidden" name="$slug" value={ctx.tenant.slug} />
                      <input type="hidden" name="grantId" value={g.id} />
                      <div className="flex flex-wrap gap-2">
                        {status === "REQUESTED" ? (
                          <>
                            <button name="op" value="approve" className={buttonClass("primary", "sm")}>{t("clinic.supportAccess.approve")}</button>
                            <button name="op" value="deny" className={buttonClass("secondary", "sm")}>{t("clinic.supportAccess.deny")}</button>
                          </>
                        ) : (
                          <button name="op" value="revoke" className={buttonClass("danger", "sm")}>{t("clinic.supportAccess.revoke")}</button>
                        )}
                      </div>
                    </Form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
