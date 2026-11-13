import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { MfaPanel } from "@/components/mfa-panel";
import { AuthLayout } from "@/components/shell/auth-layout";
import { safeNext } from "@/lib/safe-next";
import { beginClinicMfaEnrollment } from "@/server/auth/clinic-auth";
import { getClinicPrincipal } from "@/server/auth/guards";
import { clinicMfaAction, clinicRecoveryCodeAction } from "../../clinic-actions";

export default async function ClinicMfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  const p = await getClinicPrincipal();
  if (!p) redirect("/login");
  if (p.mfaVerified || !p.mfaRequired) redirect(next ?? "/clinics");
  const t = await getTranslations("auth");
  const enrollment = p.user.mfaEnrolled ? null : await beginClinicMfaEnrollment(p);
  return (
    <AuthLayout title={enrollment ? t("mfaEnrollTitle") : t("mfaTitle")} subtitle={enrollment ? undefined : t("mfaSubtitle")}>
      <MfaPanel enrollment={enrollment} action={clinicMfaAction} recoveryAction={clinicRecoveryCodeAction} hidden={next ? { next } : undefined} />
    </AuthLayout>
  );
}
