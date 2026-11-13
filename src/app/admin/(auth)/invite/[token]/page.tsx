import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthLayout } from "@/components/shell/auth-layout";
import { Form, SubmitButton, TextField } from "@/components/ui/form";
import { Alert } from "@/components/ui/primitives";
import { previewPlatformInvitation } from "@/server/platform/staff";
import { acceptStaffInvitationAction } from "../../../actions";

// The token is a credential: keep it out of referrers and search engines.
export const metadata: Metadata = { referrer: "no-referrer", robots: { index: false } };

/** Public by design: the invited employee has no account yet. The token is the only credential. */
export default async function StaffInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [t, preview] = await Promise.all([getTranslations(), previewPlatformInvitation(token)]);
  if (!preview.valid) {
    const key = ({ not_found: "notFound", expired: "expired", used: "used" } as const)[preview.reason];
    return (
      <AuthLayout eyebrow={t("auth.adminTitle")} title={t("staffInvite.title")}>
        <Alert tone="warning">{t(`invite.${key}`)}</Alert>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout eyebrow={t("auth.adminTitle")} title={t("staffInvite.title")} subtitle={t("staffInvite.subtitle", { role: t(`platformRole.${preview.role}`) })}>
      <Form action={acceptStaffInvitationAction}>
        <input type="hidden" name="token" value={token} />
        <div className="rounded-[var(--radius-control)] bg-sunken px-3.5 py-2.5 text-[14px]">
          <p className="text-[12px] text-text-3">{t("invite.email")}</p>
          <p className="font-medium">{preview.email}</p>
        </div>
        <TextField name="fullName" label={t("invite.fullName")} defaultValue={preview.fullName} autoComplete="name" required />
        <TextField name="password" type="password" label={t("invite.password")} hint={t("invite.passwordHint")} autoComplete="new-password" required />
        <TextField name="confirmPassword" type="password" label={t("invite.confirmPassword")} autoComplete="new-password" required />
        <Alert tone="neutral">{t("staffInvite.mfaNote")}</Alert>
        <SubmitButton full>{t("staffInvite.accept")}</SubmitButton>
      </Form>
    </AuthLayout>
  );
}
