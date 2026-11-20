import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AuthLayout } from "@/components/shell/auth-layout";
import { Form, SubmitButton, TextField } from "@/components/ui/form";
import { clinicSlugFromInput } from "@/server/auth/telegram-login";
import { clinicPublic } from "@/server/telegram/clinic-bot";
import { forgotPasswordAction } from "../../clinic-actions";

/**
 * Password reset without email: the clinic's own Telegram bot sends the link to
 * the person's linked Telegram. Opened from /login/<slug> the clinic is known;
 * from /login the person types the clinic's address too.
 */
export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ clinic?: string }> }) {
  const sp = await searchParams;
  const slug = clinicSlugFromInput(sp.clinic);
  const clinic = slug ? await clinicPublic(slug) : null;
  const t = await getTranslations("auth");
  return (
    <AuthLayout title={t("resetRequestTitle")} subtitle={clinic ? `${clinic.name} · ${t("resetTelegramSubtitle")}` : t("resetTelegramSubtitle")}>
      <Form action={forgotPasswordAction}>
        {clinic ? (
          <input type="hidden" name="clinic" value={clinic.slug} />
        ) : (
          <TextField name="clinic" label={t("clinicAddress")} hint={t("clinicAddressHint")} autoComplete="off" required autoFocus />
        )}
        <TextField name="username" label={t("username")} autoComplete="username" required autoFocus={Boolean(clinic)} />
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
