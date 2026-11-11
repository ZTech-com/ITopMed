import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuthLayout } from "@/components/shell/auth-layout";
import { Alert, Badge, STATUS_TONE, buttonClass } from "@/components/ui/primitives";
import { requireClinicUser } from "@/server/auth/guards";
import { clinicLogoutAction } from "../../clinic-actions";

const USABLE = new Set(["TRIAL", "ACTIVE"]);
/** Targets of the app-icon shortcuts (manifest.ts). Allow-list prevents open redirects. */
const SHORTCUTS = new Set(["patients", "queue", "my-queue", "appointments"]);

export default async function ClinicChooserPage({ searchParams }: { searchParams: Promise<{ to?: string }> }) {
  const p = await requireClinicUser();
  const to = (await searchParams).to;
  const suffix = to && SHORTCUTS.has(to) ? `/${to}` : "";
  const usable = p.clinics.filter((c) => USABLE.has(c.status));
  if (usable.length === 1) redirect(`/c/${usable[0]!.slug}${suffix}`);
  const t = await getTranslations();
  return (
    <AuthLayout title={t("auth.chooseClinic")} subtitle={p.user.fullName}>
      {p.clinics.length === 0 ? (
        <Alert tone="neutral">{t("auth.noClinics")}</Alert>
      ) : (
        <ul className="-mx-2 space-y-1">
          {p.clinics.map((c) => (
            <li key={c.tenantId}>
              {USABLE.has(c.status) ? (
                <Link href={`/c/${c.slug}${suffix}`} className="flex items-center justify-between gap-3 rounded-xl px-3 py-3 hover:bg-sunken">
                  <span className="font-medium">{c.name}</span>
                  <ChevronRight aria-hidden className="size-4 text-text-3" />
                </Link>
              ) : (
                <div className="flex items-center justify-between gap-3 px-3 py-3 text-text-3">
                  <span>{c.name}</span>
                  <Badge tone={STATUS_TONE[c.status]}>{t(`status.${c.status}` as never)}</Badge>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <form action={clinicLogoutAction} className="mt-6">
        <button className={buttonClass("secondary", "md", "w-full")}>{t("common.signOut")}</button>
      </form>
    </AuthLayout>
  );
}
