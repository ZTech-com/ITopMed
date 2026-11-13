import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { MfaPanel } from "@/components/mfa-panel";
import { AuthLayout } from "@/components/shell/auth-layout";
import { getPlatformPrincipal } from "@/server/auth/guards";
import { beginPlatformMfaEnrollment } from "@/server/auth/platform-auth";
import { adminMfaAction, adminRecoveryCodeAction } from "../../actions";

export default async function AdminMfaPage() {
  const p = await getPlatformPrincipal();
  if (!p) redirect("/admin/login");
  if (p.mfaVerified) redirect("/admin");
  const t = await getTranslations("auth");
  const enrollment = p.user.mfaEnrolled ? null : await beginPlatformMfaEnrollment(p);
  return (
    <AuthLayout
      eyebrow={t("adminTitle")}
      title={enrollment ? t("mfaEnrollTitle") : t("mfaTitle")}
      subtitle={enrollment ? undefined : t("mfaSubtitle")}
    >
      <MfaPanel enrollment={enrollment} action={adminMfaAction} recoveryAction={adminRecoveryCodeAction} />
    </AuthLayout>
  );
}
