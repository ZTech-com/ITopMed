import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthLayout } from "@/components/shell/auth-layout";
import { Form, SubmitButton, TextField } from "@/components/ui/form";
import { Alert, ButtonLink, buttonClass } from "@/components/ui/primitives";
import { getClinicPrincipal } from "@/server/auth/guards";
import { previewInvitation } from "@/server/tenancy/invitations";
import { acceptExistingInvitationAction, acceptInvitationAction, switchAccountAction } from "../../../clinic-actions";

// The token is a credential: keep it out of referrers and search engines.
export const metadata: Metadata = { referrer: "no-referrer", robots: { index: false } };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [t, preview] = await Promise.all([getTranslations("invite"), previewInvitation(token)]);

  if (!preview.valid) {
    const key = ({ not_found: "notFound", expired: "expired", used: "used", clinic_unavailable: "clinicUnavailable" } as const)[preview.reason];
    return (
      <AuthLayout title={t("title")}>
        <Alert tone="warning">{t(key)}</Alert>
      </AuthLayout>
    );
  }

  const here = `/invite/${token}`;
  const subtitle = t("subtitle", { clinic: preview.clinicName });

  if (preview.accountExists) {
    const p = await getClinicPrincipal();
    const signedIn = p;
    return (
      <AuthLayout title={t("title")} subtitle={subtitle}>
        {!signedIn ? (
          <div className="space-y-5">
            <Alert tone="neutral">{t("accountExists")}</Alert>
            <ButtonLink href={`/login?next=${encodeURIComponent(here)}`} className="w-full" size="lg">
              {t("signInToAccept")}
            </ButtonLink>
          </div>
        ) : signedIn.user.email !== preview.email ? (
          <div className="space-y-5">
            <Alert tone="warning">{t("wrongAccount", { email: signedIn.user.email })}</Alert>
            <form action={switchAccountAction}>
              <input type="hidden" name="next" value={here} />
              <button className={buttonClass("secondary", "lg", "w-full")}>{t("signOutAndSwitch")}</button>
            </form>
          </div>
        ) : (
          <Form action={acceptExistingInvitationAction}>
            <input type="hidden" name="token" value={token} />
            <p className="text-[14px] text-text-2">{t("signedInAs", { email: signedIn.user.email })}</p>
            <SubmitButton full>{t("acceptExisting")}</SubmitButton>
          </Form>
        )}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t("title")} subtitle={subtitle}>
      <Form action={acceptInvitationAction}>
        <input type="hidden" name="token" value={token} />
        <div className="rounded-[var(--radius-control)] bg-sunken px-3.5 py-2.5 text-[14px]">
          <p className="text-[12px] text-text-3">{t("email")}</p>
          <p className="font-medium">{preview.email}</p>
        </div>
        <TextField name="fullName" label={t("fullName")} defaultValue={preview.fullName} autoComplete="name" required />
        <TextField name="username" label={t("username")} hint={t("usernameHint")} autoComplete="username" required />
        <TextField name="password" type="password" label={t("password")} hint={t("passwordHint")} autoComplete="new-password" required />
        <TextField name="confirmPassword" type="password" label={t("confirmPassword")} autoComplete="new-password" required />
        <SubmitButton full>{t("accept")}</SubmitButton>
      </Form>
    </AuthLayout>
  );
}
