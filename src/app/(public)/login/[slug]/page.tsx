import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuthLayout } from "@/components/shell/auth-layout";
import { Form, SubmitButton, TextField } from "@/components/ui/form";
import { getClinicPrincipal } from "@/server/auth/guards";
import { clinicPublic } from "@/server/telegram/clinic-bot";
import { clinicLoginAction } from "../../../clinic-actions";

/** A clinic's own sign-in page (its name on top): login + password. Public by nature (sign-in). */
export default async function ClinicOwnLoginPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const clinic = await clinicPublic(slug);
  if (!clinic) notFound();
  if (await getClinicPrincipal()) redirect(`/c/${clinic.slug}`);
  const t = await getTranslations();
  return (
    <AuthLayout title={clinic.name} subtitle={t("auth.clinicSubtitle")}>
      <Form action={clinicLoginAction}>
        <input type="hidden" name="$slug" value={clinic.slug} />
        <TextField name="username" label={t("auth.username")} autoComplete="username" required autoFocus />
        <TextField name="password" type="password" label={t("auth.password")} autoComplete="current-password" required />
        <SubmitButton full>{t("auth.submit")}</SubmitButton>
        <p className="text-center text-[13px]">
          <Link href="/forgot-password" className="text-accent hover:underline">
            {t("auth.forgot")}
          </Link>
        </p>
      </Form>
    </AuthLayout>
  );
}
