import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { AuthLayout } from "@/components/shell/auth-layout";
import { Form, SubmitButton, TextField } from "@/components/ui/form";
import { Alert } from "@/components/ui/primitives";
import { TelegramNotice } from "@/components/telegram-login";
import { safeNext } from "@/lib/safe-next";
import { getClinicPrincipal } from "@/server/auth/guards";
import { needsFirstRun } from "@/server/local/first-run";
import { clinicLoginAction } from "../../clinic-actions";

export default async function ClinicLoginPage({ searchParams }: { searchParams: Promise<{ activated?: string; reset?: string; next?: string; welcome?: string; tg?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  if (await needsFirstRun()) redirect("/welcome");
  const p = await getClinicPrincipal();
  if (p) redirect(next ?? "/clinics");
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
      <Form action={clinicLoginAction}>
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <TextField name="username" label={t("auth.username")} autoComplete="username" required autoFocus />
        <TextField name="password" type="password" label={t("auth.password")} autoComplete="current-password" required />
        <SubmitButton full>{t("auth.submit")}</SubmitButton>
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
