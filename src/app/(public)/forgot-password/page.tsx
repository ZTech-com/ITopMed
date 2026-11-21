import { getTranslations } from "next-intl/server";
import { AuthLayout } from "@/components/shell/auth-layout";
import { ButtonLink } from "@/components/ui/primitives";

/**
 * No self-service reset (no email, no Telegram): the clinic's Administrator
 * gives a new password on the Staff page. This page only says so.
 */
export default async function ForgotPasswordPage() {
  const t = await getTranslations("auth");
  return (
    <AuthLayout title={t("resetRequestTitle")} subtitle={t("forgotAskAdmin")}>
      <ButtonLink href="/login" variant="secondary" className="w-full">
        {t("backToSignIn")}
      </ButtonLink>
    </AuthLayout>
  );
}
