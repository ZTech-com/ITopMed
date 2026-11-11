import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuthLayout } from "@/components/shell/auth-layout";
import { Form, SubmitButton, TextField } from "@/components/ui/form";
import { getPortalTenant } from "@/server/portal/guards";
import { portalActivateAction } from "../../../portal-actions";

export default async function PortalActivatePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tenant = await getPortalTenant(slug);
  if (!tenant) notFound();
  const t = await getTranslations();
  return (
    <AuthLayout eyebrow={tenant.name} title={t("portal.activate.title")} subtitle={t("portal.activate.subtitle")}>
      <Form action={portalActivateAction}>
        <input type="hidden" name="$slug" value={tenant.slug} />
        <TextField name="activationCode" label={t("portal.activate.code")} hint={t("portal.activate.codeHint")} placeholder="XXXX-XXXX-XXXX" autoComplete="one-time-code" required autoFocus />
        <TextField name="birthDate" type="date" label={t("portal.activate.birthDate")} required />
        <TextField name="phone" type="tel" label={t("portal.phone")} hint={t("portal.activate.phoneHint")} autoComplete="tel" inputMode="tel" placeholder="+998 90 123 45 67" required />
        <TextField name="password" type="password" label={t("invite.password")} hint={t("invite.passwordHint")} autoComplete="new-password" required />
        <TextField name="confirmPassword" type="password" label={t("invite.confirmPassword")} autoComplete="new-password" required />
        <SubmitButton full>{t("portal.activate.submit")}</SubmitButton>
      </Form>
      <p className="mt-6 text-center text-[13.5px] text-text-2">
        <Link href={`/p/${tenant.slug}/login`} className="font-medium text-accent hover:underline">
          {t("portal.activate.haveAccount")}
        </Link>
      </p>
    </AuthLayout>
  );
}
