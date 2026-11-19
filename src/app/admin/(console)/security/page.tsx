import { getTranslations } from "next-intl/server";
import { TelegramLinkLink, TelegramNotice } from "@/components/telegram-login";
import { Form, SubmitButton } from "@/components/ui/form";
import { Badge, Card, CardBody, CardHeader, DescriptionList, PageHeader } from "@/components/ui/primitives";
import { requirePlatform } from "@/server/auth/guards";
import { telegramLogin } from "@/server/env";
import { adminUnlinkTelegramAction } from "../../actions";

/** The employee's own sign-in settings: login name and the optional Telegram sign-in. */
export default async function AdminSecurityPage({ searchParams }: { searchParams: Promise<{ tg?: string }> }) {
  const p = await requirePlatform();
  const sp = await searchParams;
  const t = await getTranslations("security");
  const telegramOn = Boolean(telegramLogin());
  return (
    <div className="max-w-3xl">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <TelegramNotice code={sp.tg} />
      <Card className="mb-6">
        <CardBody>
          <DescriptionList
            items={[
              { label: t("login"), value: <span className="break-all font-mono">{p.user.username}</span> },
              { label: t("telegram"), value: p.user.telegramLinked ? <Badge tone="success">{t("telegramOn")}</Badge> : <Badge tone="neutral">{t("telegramOff")}</Badge> },
            ]}
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t("telegram")} />
        <CardBody className="space-y-4">
          <p className="text-[14px] text-text-2">{telegramOn ? t("telegramIntro") : t("telegramUnavailable")}</p>
          {p.user.telegramLinked ? (
            <Form action={adminUnlinkTelegramAction}>
              <SubmitButton variant="secondary">{t("telegramUnlink")}</SubmitButton>
            </Form>
          ) : (
            <TelegramLinkLink kind="admin" />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
