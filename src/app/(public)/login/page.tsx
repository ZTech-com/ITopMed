import { Send } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { AuthLayout } from "@/components/shell/auth-layout";
import { Form, SubmitButton, TextField } from "@/components/ui/form";
import { Alert, buttonClass } from "@/components/ui/primitives";
import { TelegramNotice } from "@/components/telegram-login";
import { safeNext } from "@/lib/safe-next";
import { getClinicPrincipal } from "@/server/auth/guards";
import { clinicSlugFromInput, telegramPossible } from "@/server/auth/telegram-login";
import { clinicPublic } from "@/server/telegram/clinic-bot";
import { needsFirstRun } from "@/server/local/first-run";
import { clinicLoginAction } from "../../clinic-actions";

export default async function ClinicLoginPage({ searchParams }: { searchParams: Promise<{ activated?: string; reset?: string; next?: string; welcome?: string; tg?: string; clinic?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  if (await needsFirstRun()) redirect("/welcome");
  const p = await getClinicPrincipal();
  if (p) redirect(next ?? "/clinics");
  const telegram = telegramPossible();
  // "Log in with Telegram" belongs to each clinic's own bot: the address leads to /login/<slug>.
  let clinicNotFound = false;
  if (telegram && sp.clinic !== undefined) {
    const slug = clinicSlugFromInput(sp.clinic);
    const clinic = slug ? await clinicPublic(slug) : null;
    if (clinic) redirect(`/login/${clinic.slug}`);
    clinicNotFound = true;
  }
  const t = await getTranslations();
  return (
    <AuthLayout title={t("auth.clinicTitle")} subtitle={t("auth.clinicSubtitle")}>
      {sp.welcome ? (
        <div className="mb-5">
          <Alert tone="success">{t("welcome.done")}</Alert>
        </div>
      ) : null}
      {sp.activated || sp.reset ? (
        <div className="mb-5">
          <Alert tone="success">{sp.reset ? t("auth.resetDone") : t("invite.success")}</Alert>
        </div>
      ) : null}
      <TelegramNotice code={sp.tg} />
      {telegram ? (
        <div className="mb-5 space-y-3">
          <form method="get" action="/login" className="space-y-3">
            <TextField name="clinic" label={t("auth.clinicAddress")} hint={t("auth.clinicAddressHint")} defaultValue={sp.clinic ?? ""} autoComplete="off" required />
            {clinicNotFound ? <Alert tone="warning">{t("auth.clinicNotFound")}</Alert> : null}
            <button type="submit" className={buttonClass("primary", "lg", "w-full")}>
              <Send aria-hidden className="size-4" />
              {t("auth.telegram")}
            </button>
          </form>
          <p className="flex items-center gap-3 pt-2 text-[13px] text-text-3">
            <span aria-hidden className="h-px flex-1 bg-border" />
            {t("auth.orPassword")}
            <span aria-hidden className="h-px flex-1 bg-border" />
          </p>
        </div>
      ) : null}
      <Form action={clinicLoginAction}>
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <TextField name="username" label={t("auth.username")} autoComplete="username" required autoFocus={!telegram} />
        <TextField name="password" type="password" label={t("auth.password")} autoComplete="current-password" required />
        <SubmitButton full variant={telegram ? "secondary" : "primary"}>{t("auth.submit")}</SubmitButton>
        <p className="text-center text-[13px]">
          <Link href="/forgot-password" className="text-accent hover:underline">
            {t("auth.forgot")}
          </Link>
        </p>
        {process.env.LOCAL_MODE === "1" ? (
          <p className="text-center text-[13px]">
            <Link href="/connect" className="text-accent hover:underline">
              {t("connect.link")}
            </Link>
          </p>
        ) : null}
      </Form>
    </AuthLayout>
  );
}
