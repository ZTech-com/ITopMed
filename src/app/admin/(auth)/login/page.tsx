import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuthLayout } from "@/components/shell/auth-layout";
import { Form, SubmitButton, TextField } from "@/components/ui/form";
import { Alert } from "@/components/ui/primitives";
import { getPlatformPrincipal } from "@/server/auth/guards";
import { adminLoginAction } from "../../actions";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ activated?: string }> }) {
  const p = await getPlatformPrincipal();
  if (p?.mfaVerified) redirect("/admin");
  const [t, sp] = await Promise.all([getTranslations("auth"), searchParams]);
  return (
    <AuthLayout eyebrow="ITop Med" title={t("adminTitle")} subtitle={t("adminSubtitle")}>
      <Form action={adminLoginAction}>
        {sp.activated ? <Alert tone="success">{t("staffActivated")}</Alert> : null}
        <TextField name="email" type="email" label={t("email")} autoComplete="username" inputMode="email" required autoFocus />
        <TextField name="password" type="password" label={t("password")} autoComplete="current-password" required />
        <SubmitButton full>{t("submit")}</SubmitButton>
      </Form>
    </AuthLayout>
  );
}
