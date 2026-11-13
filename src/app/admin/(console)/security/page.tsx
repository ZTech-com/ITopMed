import { getTranslations } from "next-intl/server";
import { RecoveryCodesForm } from "@/components/recovery-codes";
import { Alert, Badge, Card, CardBody, CardHeader, DescriptionList, PageHeader } from "@/components/ui/primitives";
import { requirePlatform } from "@/server/auth/guards";
import { platformRecoveryCodeStatus } from "@/server/auth/platform-auth";
import { generateAdminRecoveryCodesAction } from "../../actions";

export default async function AdminSecurityPage({ searchParams }: { searchParams: Promise<{ setup?: string; used?: string }> }) {
  const p = await requirePlatform();
  const sp = await searchParams;
  const [t, status] = await Promise.all([getTranslations("security"), platformRecoveryCodeStatus(p.user.id)]);
  return (
    <div className="max-w-3xl">
      <PageHeader title={t("title")} description={t("subtitle")} />
      {sp.setup && !status.issued ? <div className="mb-6"><Alert tone="warning">{t("setupPrompt")}</Alert></div> : null}
      {sp.used ? <div className="mb-6"><Alert tone="warning">{t("usedNotice", { remaining: status.remaining })}</Alert></div> : null}
      <Card className="mb-6">
        <CardBody>
          <DescriptionList
            items={[
              { label: t("mfa"), value: <Badge tone="success">{t("mfaOn")}</Badge> },
              { label: t("recoveryTitle"), value: status.issued ? t("remaining", { remaining: status.remaining }) : t("notIssued") },
            ]}
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t("recoveryTitle")} />
        <CardBody className="space-y-4">
          <p className="text-[14px] text-text-2">{t("recoveryIntro")}</p>
          {status.issued && status.remaining <= 3 ? <Alert tone="warning">{t("runningLow")}</Alert> : null}
          {status.issued ? <p className="text-[13px] text-text-3">{t("regenerateNote")}</p> : null}
          <RecoveryCodesForm action={generateAdminRecoveryCodesAction} issued={status.issued} />
        </CardBody>
      </Card>
    </div>
  );
}
