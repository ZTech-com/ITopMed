import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuthLayout } from "@/components/shell/auth-layout";
import { TelegramLoginButton, TelegramNotice, telegramLoginAvailable } from "@/components/telegram-login";
import { Form, SubmitButton, TextField } from "@/components/ui/form";
import { getClinicPrincipal } from "@/server/auth/guards";
import { clinicPublic } from "@/server/telegram/clinic-bot";
import { clinicLoginAction } from "../../../clinic-actions";

/**
 * A clinic's own sign-in page: "Sign in with Telegram" through THIS clinic's bot
 * first, login + password below as the second way. Public by nature (sign-in).
 */
export default async function ClinicOwnLoginPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ tg?: string }> }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const clinic = await clinicPublic(slug);
  if (!clinic) notFound();
  if (await getClinicPrincipal()) redirect(`/c/${clinic.slug}`);
  const [t, telegram] = await Promise.all([getTranslations(), telegramLoginAvailable("clinic", clinic.slug)]);
  return (
    <AuthLayout title={clinic.name} subtitle={t("auth.clinicSubtitle")}>
      <TelegramNotice code={sp.tg} />
      <TelegramLoginButton kind="clinic" slug={clinic.slug} />
      <Form action={clinicLoginAction}>
        <input type="hidden" name="$slug" value={clinic.slug} />
        <TextField name="username" label={t("auth.username")} autoComplete="username" required autoFocus={!telegram} />
        <TextField name="password" type="password" label={t("auth.password")} autoComplete="current-password" required />
        <SubmitButton full variant={telegram ? "secondary" : "primary"}>{t("auth.submit")}</SubmitButton>
        <p className="text-center text-[13px]">
          <Link href={`/forgot-password?clinic=${clinic.slug}`} className="text-accent hover:underline">
            {t("auth.forgot")}
          </Link>
        </p>
      </Form>
    </AuthLayout>
  );
}
