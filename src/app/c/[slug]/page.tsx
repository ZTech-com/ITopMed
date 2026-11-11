import { CalendarClock, CheckCircle2, Circle, DoorOpen, Stethoscope, UserRound, UserX } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Alert, Badge, ButtonLink, Card, CardBody, CardHeader, EmptyState, PageHeader, Stat } from "@/components/ui/primitives";
import { roleLabel } from "@/lib/role-label";
import { requireClinic } from "@/server/auth/guards";
import { doctorsWorkingOn, getDoctorDetail, getMyDoctorProfileId, listDoctors } from "@/server/clinic/doctors";
import { listRooms, listServices } from "@/server/clinic/resources";
import { withAppContext } from "@/server/db";
import { MODULES } from "@/server/modules/catalog";
import { formatHm, isoWeekday, todayIn } from "@/server/scheduling/time";

/**
 * One dashboard, composed from role-specific sections:
 *  - Operations + setup (clinic owners/administrators)
 *  - Front desk: who works today (receptionists, managers — schedules.read)
 *  - My day (anyone with a practitioner profile)
 */
export default async function ClinicDashboard({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireClinic(slug);
  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);
  const has = (p: Parameters<typeof ctx.permissions.has>[0]) => ctx.permissions.has(p);
  const tz = ctx.tenant.timezone;
  const today = todayIn(tz);
  const todayLabel = format.dateTime(new Date(`${today}T12:00:00Z`), { dateStyle: "full", timeZone: "UTC" });
  const isAdmin = has("clinic.settings.manage");
  const base = `/c/${ctx.tenant.slug}`;

  const [subscription, branchCount, memberCount] = await withAppContext({ tenantId: ctx.tenant.id, userId: ctx.principal.user.id }, async (tx) => [
    await tx.subscription.findUnique({ where: { tenantId: ctx.tenant.id } }),
    await tx.branch.count({ where: { archivedAt: null } }),
    await tx.membership.count({ where: { tenantId: ctx.tenant.id, status: "ACTIVE" } }),
  ]);
  const working = has("schedules.read") ? await doctorsWorkingOn(ctx, today) : null;
  const myProfileId = await getMyDoctorProfileId(ctx);
  const myDetail = myProfileId ? await getDoctorDetail(ctx, myProfileId) : null;
  const myToday = myDetail && !myDetail.exceptions.some((e) => e.localDate === today) ? myDetail.schedules.filter((s) => s.weekday === isoWeekday(today)) : [];
  const ops = isAdmin
    ? await Promise.all([listServices(ctx), listDoctors(ctx), listRooms(ctx)]).then(([s, d, r]) => ({
        services: s.length,
        doctors: d.length,
        noSchedule: d.filter((x) => x.weeklyMinutes === 0).length,
        rooms: r.length,
      }))
    : null;

  const steps = ops
    ? [
        { done: true, label: t("clinic.dashboard.setupSettings"), href: `${base}/settings` },
        { done: branchCount > 1, label: t("clinic.dashboard.setupBranches"), href: `${base}/branches` },
        { done: memberCount > 1, label: t("clinic.dashboard.setupStaff"), href: `${base}/staff` },
        { done: ops.services > 0, label: t("clinic.dashboard.setupServices"), href: `${base}/services` },
        { done: ops.doctors > 0 && ops.noSchedule === 0, label: t("clinic.dashboard.setupDoctors"), href: `${base}/doctors` },
        { done: ctx.principal.user.mfaEnrolled, label: t("clinic.dashboard.setupMfa"), href: undefined },
      ]
    : [];

  return (
    <>
      <PageHeader eyebrow={`${ctx.tenant.name} · ${todayLabel}`} title={t("clinic.dashboard.welcome", { name: ctx.principal.user.fullName })} />
      {subscription?.status === "TRIALING" && subscription.trialEndsAt ? (
        <div className="mb-6">
          <Alert tone="accent">{t("clinic.dashboard.trial", { date: format.dateTime(subscription.trialEndsAt, { dateStyle: "long" }) })}</Alert>
        </div>
      ) : null}

      <div className="space-y-6">
        {myDetail ? (
          <Card>
            <CardHeader title={t("clinic.dashboard.myDay")} action={<ButtonLink href={`${base}/my-schedule`} variant="ghost" size="sm">{t("clinic.dashboard.openMySchedule")}</ButtonLink>} />
            <CardBody>
              <p className="text-[13px] font-medium text-text-2">{t("clinic.dashboard.myHoursToday")}</p>
              {myToday.length === 0 ? (
                <p className="mt-1 text-[15px]">{t("clinic.dashboard.notWorkingToday")}</p>
              ) : (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {myToday.map((b) => (
                    <li key={b.id} className="rounded-xl bg-accent-soft px-3 py-2 text-[14px] text-accent">
                      <span className="font-semibold tabular-nums">{formatHm(b.startMinute)}–{formatHm(b.endMinute)}</span> · {b.branch.name}
                      {b.room ? ` · ${b.room.name}` : ""}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-4 text-[13px] text-text-3">{t("clinic.dashboard.appointmentsNext")}</p>
            </CardBody>
          </Card>
        ) : null}

        {working ? (
          <Card>
            <CardHeader title={t("clinic.dashboard.frontDesk")} description={t("clinic.dashboard.working", { date: todayLabel })} />
            {working.length === 0 ? (
              <EmptyState icon={<CalendarClock className="size-6" />} title={t("clinic.dashboard.nobodyWorking")} description={t("clinic.dashboard.appointmentsNext")} />
            ) : (
              <>
                <ul className="divide-y divide-border">
                  {working.map((d) => (
                    <li key={d.profileId} className="flex flex-wrap items-center justify-between gap-3 px-6 py-3">
                      <div className="min-w-0">
                        <p className="font-medium">{d.fullName}</p>
                        <p className="text-[13px] text-text-2">{t(`specialties.${d.specialty}` as never)}</p>
                      </div>
                      <ul className="flex flex-wrap gap-1.5">
                        {d.blocks.map((b, i) => (
                          <li key={i} className="rounded-lg bg-sunken px-2.5 py-1 text-[13px] tabular-nums">
                            {formatHm(b.startMinute)}–{formatHm(b.endMinute)} · {b.branchName}
                            {b.roomName ? ` · ${b.roomName}` : ""}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
                <p className="border-t border-border px-6 py-3 text-[13px] text-text-3">{t("clinic.dashboard.appointmentsNext")}</p>
              </>
            )}
          </Card>
        ) : null}

        {ops ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              <Stat label={t("clinic.dashboard.opsServices")} value={format.number(ops.services)} icon={<Stethoscope className="size-4" />} />
              <Stat label={t("clinic.dashboard.opsDoctors")} value={format.number(ops.doctors)} icon={<UserRound className="size-4" />} />
              <Stat label={t("clinic.dashboard.opsNoSchedule")} value={format.number(ops.noSchedule)} icon={<UserX className="size-4" />} />
              <Stat label={t("clinic.dashboard.opsRooms")} value={format.number(ops.rooms)} icon={<DoorOpen className="size-4" />} />
            </div>
            <Card>
              <CardHeader title={t("clinic.dashboard.setup")} />
              <ul className="divide-y divide-border">
                {steps.map((s) => {
                  const Icon = s.done ? CheckCircle2 : Circle;
                  const body = (
                    <span className="flex items-center gap-3">
                      <Icon aria-hidden className={s.done ? "size-5 text-success" : "size-5 text-text-3"} />
                      <span className={s.done ? "text-text-2" : "font-medium"}>{s.label}</span>
                    </span>
                  );
                  return (
                    <li key={s.label} className="px-6 py-3.5 text-[14px]">
                      {s.href ? <Link href={s.href} className="block hover:text-accent">{body}</Link> : body}
                    </li>
                  );
                })}
              </ul>
            </Card>
          </>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-3">
          <Card>
            <CardHeader title={t("clinic.dashboard.yourRoles")} />
            <CardBody className="flex flex-wrap gap-2">
              {ctx.roleKeys.map((r) => (
                <Badge key={r} tone="accent">
                  {roleLabel(t as never, r)}
                </Badge>
              ))}
            </CardBody>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader title={t("clinic.dashboard.modules")} description={t("clinic.dashboard.modulesHint")} />
            <CardBody className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {MODULES.filter((m) => !m.core && ctx.modules.has(m.key)).map((m) => (
                <div key={m.key} className="rounded-xl border border-border bg-surface-2 px-4 py-3">
                  <p className="text-[14px] font-medium">{t(`modules.${m.key}`)}</p>
                  <p className="mt-1 text-[12px] text-text-3">{t("common.planned")}</p>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
