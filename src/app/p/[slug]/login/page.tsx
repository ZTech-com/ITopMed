import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuthLayout } from "@/components/shell/auth-layout";
import { Form, SubmitButton, TextField } from "@/components/ui/form";
import { Alert } from "@/components/ui/primitives";
import { getPatientPrincipal, getPortalTenant } from "@/server/portal/guards";
import { portalLoginAction } from "../../../portal-actions";

export default async function PortalLoginPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ activated?: string }> }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const tenant = await getPortalTenant(slug);
  if (!tenant) notFound();
  const p = await getPatientPrincipal();
  if (p && p.tenant.id === tenant.id) redirect(`/p/${tenant.slug}`);
  const t = await getTranslations();
  return (
    <AuthLayout eyebrow={tenant.name} title={t("portal.login.title")} subtitle={t("portal.login.subtitle")}>
      {sp.activated ? (
        <div className="mb-5">
          <Alert tone="success">{t("portal.activate.done")}</Alert>
        </div>
      ) : null}
      <Form action={portalLoginAction}>
        <input type="hidden" name="$slug" value={tenant.slug} />
        <TextField name="phone" type="tel" label={t("portal.phone")} hint={t("portal.phoneHint")} autoComplete="username" inputMode="tel" placeholder="+998 90 123 45 67" required autoFocus />
        <TextField name="password" type="password" label={t("auth.password")} autoComplete="current-password" required />
        <SubmitButton full>{t("auth.submit")}</SubmitButton>
      </Form>
      <div className="mt-6 space-y-2 text-center text-[13.5px] text-text-2">
        <p>
          {t("portal.login.firstTime")}{" "}
          <Link href={`/p/${tenant.slug}/activate`} className="font-medium text-accent hover:underline">
            {t("portal.login.activate")}
          </Link>
        </p>
        <p className="text-[12.5px] text-text-3">{t("portal.login.forgot")}</p>
      </div>
    </AuthLayout>
  );
}
