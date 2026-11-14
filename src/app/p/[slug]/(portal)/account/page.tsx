import { getFormatter, getTranslations } from "next-intl/server";
import { Form, SelectField, SubmitButton, TextField } from "@/components/ui/form";
import { Card, CardBody, CardHeader, PageHeader, buttonClass } from "@/components/ui/primitives";
import { SELF_SERVICE_PURPOSES, listMyConsents } from "@/server/portal/data";
import { requirePatient } from "@/server/portal/guards";
import { portalConsentAction, portalPasswordAction, portalTelegramDisconnectAction, portalTelegramLinkAction } from "../../../../portal-actions";
import { TelegramConnect } from "@/components/telegram-connect";
import { myTelegram } from "@/server/notifications/telegram";

export default async function PortalAccountPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = await requirePatient(slug);
  const [t, format, consents, telegram] = await Promise.all([getTranslations(), getFormatter(), listMyConsents(p), myTelegram(p)]);
  const active = consents.filter((c) => !c.withdrawnAt);
  const missing = SELF_SERVICE_PURPOSES.filter((pp) => !active.some((c) => c.purpose === pp));
  const tz = p.tenant.timezone;
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title={t("portal.account.title")} description={t("portal.account.subtitle")} />
      {telegram.bot ? (
        <Card>
          <CardHeader title={t("portal.telegram.title")} description={t("portal.telegram.hint", { bot: telegram.bot })} />
          <CardBody className="space-y-3 text-[14px]">
            {telegram.linked ? (
              <>
                <p className="font-medium text-success">{t("portal.telegram.linked", { date: format.dateTime(telegram.linked.linkedAt, { dateStyle: "medium", timeZone: tz }) })}</p>
                <Form action={portalTelegramDisconnectAction} className="space-y-0">
                  <input type="hidden" name="$slug" value={p.tenant.slug} />
                  <button className={buttonClass("ghost", "md")}>{t("portal.telegram.disconnect")}</button>
                </Form>
              </>
            ) : (
              <TelegramConnect action={portalTelegramLinkAction} slug={p.tenant.slug} />
            )}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title={t("portal.account.consents")} description={t("portal.account.consentsHint")} />
        <ul className="divide-y divide-border">
          {consents.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 sm:px-6">
              <div>
                <p className="text-[14px] font-medium">{t(`consentPurpose.${c.purpose}`)}</p>
                <p className="text-[12.5px] text-text-3">
                  {t(`consentMethod.${c.method}`)} · {format.dateTime(c.grantedAt, { dateStyle: "medium", timeZone: tz })}
                  {c.withdrawnAt ? ` · ${t("portal.account.withdrawnOn", { date: format.dateTime(c.withdrawnAt, { dateStyle: "medium", timeZone: tz }) })}` : ""}
                </p>
              </div>
              {!c.withdrawnAt && c.purpose !== "PATIENT_PORTAL" ? (
                <Form action={portalConsentAction} className="space-y-0">
                  <input type="hidden" name="$slug" value={p.tenant.slug} />
                  <input type="hidden" name="consentId" value={c.id} />
                  <button name="op" value="withdraw" className={buttonClass("ghost", "sm")}>
                    {t("portal.account.withdraw")}
                  </button>
                </Form>
              ) : null}
            </li>
          ))}
        </ul>
        {missing.length > 0 ? (
          <CardBody className="border-t border-border">
            <Form action={portalConsentAction}>
              <input type="hidden" name="$slug" value={p.tenant.slug} />
              <SelectField name="purpose" label={t("portal.account.grant")} options={missing.map((pp) => ({ value: pp, label: t(`consentPurpose.${pp}`) }))} />
              <SubmitButton variant="secondary">{t("portal.account.grantSubmit")}</SubmitButton>
            </Form>
          </CardBody>
        ) : null}
      </Card>

      <Card>
        <CardHeader title={t("portal.account.password")} description={t("portal.account.passwordHint")} />
        <CardBody>
          <Form action={portalPasswordAction}>
            <input type="hidden" name="$slug" value={p.tenant.slug} />
            <TextField name="currentPassword" type="password" label={t("portal.account.currentPassword")} autoComplete="current-password" required />
            <TextField name="password" type="password" label={t("invite.password")} hint={t("invite.passwordHint")} autoComplete="new-password" required />
            <TextField name="confirmPassword" type="password" label={t("invite.confirmPassword")} autoComplete="new-password" required />
            <SubmitButton>{t("portal.account.changePassword")}</SubmitButton>
          </Form>
        </CardBody>
      </Card>
      <p className="text-[13px] text-text-3">{t("portal.account.contactClinic")}</p>
    </div>
  );
}
