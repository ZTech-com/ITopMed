import { getTranslations } from "next-intl/server";
import { RecoveryCodesForm } from "@/components/recovery-codes";
import { AuthLayout } from "@/components/shell/auth-layout";
import { Alert, ButtonLink } from "@/components/ui/primitives";
import { safeNext } from "@/lib/safe-next";
import { clinicRecoveryCodeStatus } from "@/server/auth/clinic-auth";
import { requireClinicUser } from "@/server/auth/guards";
import { generateClinicRecoveryCodesAction } from "../../../clinic-actions";

/** Account-level security for clinic staff (the account may belong to several clinics). */
export default async function AccountSecurityPage({ searchParams }: { searchParams: Promise<{ setup?: string; used?: string; next?: string }> }) {
  const p = await requireClinicUser();
  const sp = await searchParams;
  const next = safeNext(sp.next) ?? "/clinics";
  const t = await getTranslations("security");
  const enrolled = p.user.mfaEnrolled && p.mfaVerified;
  const status = enrolled ? await clinicRecoveryCodeStatus(p) : null;
  return (
    <AuthLayout title={t("title")} subtitle={p.user.email}>
      <div className="space-y-5">
        {!enrolled ? (
          <Alert tone="neutral">{t("mfaOffClinic")}</Alert>
        ) : (
          <>
            {sp.setup && !status!.issued ? <Alert tone="warning">{t("setupPrompt")}</Alert> : null}
            {sp.used ? <Alert tone="warning">{t("usedNotice", { remaining: status!.remaining })}</Alert> : null}
            <p className="text-[14px] text-text-2">{t("recoveryIntro")}</p>
            <p className="text-[14px] font-medium">{status!.issued ? t("remaining", { remaining: status!.remaining }) : t("notIssued")}</p>
            {status!.issued && status!.remaining <= 3 ? <Alert tone="warning">{t("runningLow")}</Alert> : null}
            {status!.issued ? <p className="text-[13px] text-text-3">{t("regenerateNote")}</p> : null}
            <RecoveryCodesForm action={generateClinicRecoveryCodesAction} issued={status!.issued} />
          </>
        )}
        <ButtonLink href={next} variant="secondary" className="w-full">
          {t("continue")}
        </ButtonLink>
      </div>
    </AuthLayout>
  );
}
