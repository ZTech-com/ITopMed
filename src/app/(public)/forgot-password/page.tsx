import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AuthLayout } from "@/components/shell/auth-layout";
import { Form, SubmitButton, TextField } from "@/components/ui/form";
import { forgotPasswordAction } from "../../clinic-actions";

export default async function ForgotPasswordPage() {
  const t = await getTranslations("auth");
  return (
    <AuthLayout title={t("resetRequestTitle")} subtitle={t("resetRequestSubtitle")}>
      <Form action={forgotPasswordAction}>
        <TextField name="email" type="email" label={t("email")} autoComplete="username" inputMode="email" required autoFocus />
        <SubmitButton full>{t("resetRequestSubmit")}</SubmitButton>
        <p className="text-center text-[13px]">
          <Link href="/login" className="text-accent hover:underline">
            {t("backToSignIn")}
          </Link>
        </p>
      </Form>
    </AuthLayout>
  );
}
