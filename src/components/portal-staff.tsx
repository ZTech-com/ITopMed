import { getFormatter, getTranslations } from "next-intl/server";
import type { FormState } from "@/lib/form-state";
import { Form, SelectField, SubmitButton } from "./ui/form";
import { Badge, Card, CardBody, CardHeader } from "./ui/primitives";

interface Account {
  status: string;
  login: string | null;
  activationExpiresAt: Date | null;
  activatedAt: Date | null;
  lastLoginAt: Date | null;
  lockedUntil: Date | null;
}

/**
 * Front-desk view of a patient's portal access. Staff hand over a one-time
 * activation code in person; they never set or see the patient's password.
 */
export async function PortalAccessCard({
  slug,
  patientId,
  account,
  hasConsent,
  canManage,
  action,
  timeZone,
}: {
  slug: string;
  patientId: string;
  account: Account | null;
  hasConsent: boolean;
  canManage: boolean;
  action: (s: FormState, fd: FormData) => Promise<FormState>;
  timeZone: string;
}) {
  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);
  const dt = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeStyle: "short", timeZone });
  const status = account?.status ?? "NONE";
  const tone = status === "ACTIVE" ? "success" : status === "INVITED" ? "accent" : "neutral";
  const expired = account?.status === "INVITED" && account.activationExpiresAt && account.activationExpiresAt < new Date();
  return (
    <Card>
      <CardHeader title={t("clinic.portal.title")} description={t("clinic.portal.hint")} action={<Badge tone={tone}>{t(`clinic.portal.status.${status}` as never)}</Badge>} />
      <CardBody className="space-y-4">
        {account?.status === "ACTIVE" ? (
          <p className="text-[14px] text-text-2">
            {t("clinic.portal.activeInfo", { phone: account.login ?? "—", date: account.activatedAt ? dt(account.activatedAt) : "—" })}
            {account.lastLoginAt ? ` ${t("clinic.portal.lastLogin", { date: dt(account.lastLoginAt) })}` : ""}
          </p>
        ) : account?.status === "INVITED" ? (
          <p className="text-[14px] text-text-2">{expired ? t("clinic.portal.codeExpired") : t("clinic.portal.waiting", { date: account.activationExpiresAt ? dt(account.activationExpiresAt) : "—" })}</p>
        ) : account?.status === "DISABLED" ? (
          <p className="text-[14px] text-text-2">{t("clinic.portal.disabledInfo")}</p>
        ) : (
          <p className="text-[14px] text-text-2">{t("clinic.portal.none")}</p>
        )}
        {account?.lockedUntil && account.lockedUntil > new Date() ? <p className="text-[13px] text-danger">{t("clinic.portal.locked", { date: dt(account.lockedUntil) })}</p> : null}

        {canManage ? (
          <div className="flex flex-wrap items-start gap-3">
            <Form action={action} className="min-w-[260px] flex-1 space-y-3">
              <input type="hidden" name="$slug" value={slug} />
              <input type="hidden" name="patientId" value={patientId} />
              {!hasConsent ? (
                <SelectField
                  name="consentMethod"
                  label={t("clinic.portal.consent")}
                  hint={t("clinic.portal.consentHint")}
                  options={(["PAPER_SIGNED", "VERBAL_RECORDED"] as const).map((m) => ({ value: m, label: t(`consentMethod.${m}`) }))}
                />
              ) : null}
              <SubmitButton variant={account ? "secondary" : "primary"}>{account ? t("clinic.portal.reissue") : t("clinic.portal.issue")}</SubmitButton>
            </Form>
            {account && account.status !== "DISABLED" ? (
              <Form action={action} className="space-y-0">
                <input type="hidden" name="$slug" value={slug} />
                <input type="hidden" name="patientId" value={patientId} />
                <input type="hidden" name="op" value="disable" />
                <SubmitButton variant="danger">{t("clinic.portal.disable")}</SubmitButton>
              </Form>
            ) : null}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
