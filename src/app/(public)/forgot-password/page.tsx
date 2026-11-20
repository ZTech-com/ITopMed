import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AuthLayout } from "@/components/shell/auth-layout";
import { Form, SubmitButton, TextField } from "@/components/ui/form";
import { clinicPublic } from "@/server/telegram/clinic-bot";
import { forgotPasswordAction } from "../../clinic-actions";

/**
 * Password reset without email: only the login is asked (the clinic comes from
 * the account); a Telegram bot sends the link to the person's linked Telegram.
 * Opened from /login/<slug>, the clinic's name is shown and the way back leads there.
 */
export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ clinic?: string }> }) {
  const sp = await searchParams;
  const slug = sp.clinic && /^[a-z0-9-]{3,48}$/.test(sp.clinic) ? sp.clinic : null;
  const clinic = slug ? await clinicPublic(slug) : null;
  const t = await getTranslations("auth");
  return (
    <AuthLayout title={t("resetRequestTitle")} subtitle={clinic ? `${clinic.name} · ${t("resetTelegramSubtitle")}` : t("resetTelegramSubtitle")}>
      <Form action={forgotPasswordAction}>
        <TextField name="username" label={t("username")} autoComplete="username" required autoFocus />
        <SubmitButton full>{t("resetRequestSubmit")}</SubmitButton>
        <p className="text-center text-[13px] text-text-2">{t("resetTelegramNoLink")}</p>
        <p className="text-center text-[13px]">
          <Link href={clinic ? `/login/${clinic.slug}` : "/login"} className="text-accent hover:underline">
            {t("backToSignIn")}
          </Link>
        </p>
      </Form>
    </AuthLayout>
  );
}
