import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuthLayout } from "@/components/shell/auth-layout";
import { Form, SubmitButton, TextField } from "@/components/ui/form";
import { Alert } from "@/components/ui/primitives";
import { getPlatformPrincipal } from "@/server/auth/guards";
import { needsFirstRun } from "@/server/local/first-run";
import { adminLoginAction } from "../../actions";

export const metadata: Metadata = { title: "ITop Med Boshqaruv", manifest: "/admin.webmanifest" };

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ activated?: string; only?: string }> }) {
  if (await needsFirstRun()) redirect("/welcome");
  const p = await getPlatformPrincipal();
  if (p?.user.role === "SUPER_ADMIN") redirect("/admin");
  const [t, sp] = await Promise.all([getTranslations("auth"), searchParams]);
  return (
    <AuthLayout eyebrow="ITop Med" title={t("adminTitle")} subtitle={t("adminSubtitle")}>
      {sp.only ? (
        <div className="mb-5">
          <Alert tone="warning">{t("consoleSuperOnly")}</Alert>
        </div>
      ) : null}
      <Form action={adminLoginAction}>
        {sp.activated ? <Alert tone="success">{t("staffActivated")}</Alert> : null}
        <TextField name="username" label={t("username")} autoComplete="username" required autoFocus />
        <TextField name="password" type="password" label={t("password")} autoComplete="current-password" required />
        <SubmitButton full>{t("submit")}</SubmitButton>
        <p className="text-center text-[13px] text-text-2">{t("consoleWho")}</p>
        <p className="text-center text-[13px]">
          <Link href="/login" className="text-accent hover:underline">
            {t("toClinic")}
          </Link>
        </p>
      </Form>
    </AuthLayout>
  );
}
