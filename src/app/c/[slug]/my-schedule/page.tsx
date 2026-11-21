import { getFormatter, getTranslations } from "next-intl/server";
import { ScheduleView } from "@/components/schedule-view";
import { Alert, Card, CardBody, CardHeader, PageHeader } from "@/components/ui/primitives";
import { requireClinic } from "@/server/auth/guards";
import { getDoctorDetail, getMyDoctorProfileId } from "@/server/clinic/doctors";

/** A doctor's own schedule. Needs no schedule permission: it is the caller's own data. */
export default async function MySchedulePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireClinic(slug);
  const [t, format, profileId] = await Promise.all([getTranslations(), getFormatter(), getMyDoctorProfileId(ctx)]);
  const detail = profileId ? await getDoctorDetail(ctx, profileId) : null;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <PageHeader title={t("clinic.mySchedule.title")} description={t("clinic.mySchedule.subtitle")} />
      {!detail ? (
        <Alert tone="neutral">{t("clinic.mySchedule.noProfile")}</Alert>
      ) : (
        <>
          <Card>
            <CardHeader title={t("clinic.doctors.schedule")} />
            <ScheduleView blocks={detail.schedules} />
          </Card>
          <Card>
            <CardHeader title={t("clinic.doctors.exceptions")} />
            <CardBody>
              {detail.exceptions.length === 0 ? (
                <p className="text-[14px] text-text-2">{t("clinic.doctors.noExceptions")}</p>
              ) : (
                <ul className="space-y-1.5 text-[14px]">
                  {detail.exceptions.map((e) => (
                    <li key={e.id}>
                      <span className="font-medium">{format.dateTime(new Date(`${e.localDate}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" })}</span>
                      <span className="text-text-2"> · {t(`exceptionKind.${e.kind}`)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
