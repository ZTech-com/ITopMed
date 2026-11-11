import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AuthLayout } from "@/components/shell/auth-layout";
import { Form, SubmitButton, TextField } from "@/components/ui/form";
import { Alert } from "@/components/ui/primitives";
import { isResetTokenValid } from "@/server/auth/password-reset";
import { resetPasswordAction } from "../../../clinic-actions";

// The token is a credential: keep it out of referrers and indexes.
export const metadata: Metadata = { referrer: "no-referrer", robots: { index: false } };

export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [t, tInvite, valid] = await Promise.all([getTranslations("auth"), getTranslations("invite"), isResetTokenValid(token)]);
  if (!valid) {
    return (
      <AuthLayout title={t("resetTitle")}>
        <Alert tone="warning">{t("resetInvalid")}</Alert>
        <p className="mt-5 text-center text-[14px]">
          <Link href="/forgot-password" className="text-accent hover:underline">
            {t("resetRequestTitle")}
          </Link>
        </p>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title={t("resetTitle")} subtitle={t("resetSubtitle")}>
      <Form action={resetPasswordAction}>
        <input type="hidden" name="token" value={token} />
        <TextField name="password" type="password" label={t("newPassword")} hint={tInvite("passwordHint")} autoComplete="new-password" required autoFocus />
        <TextField name="confirmPassword" type="password" label={tInvite("confirmPassword")} autoComplete="new-password" required />
        <SubmitButton full>{t("resetSubmit")}</SubmitButton>
      </Form>
    </AuthLayout>
  );
}
