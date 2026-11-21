import { getTranslations } from "next-intl/server";
import { Card, CardBody, DescriptionList, PageHeader } from "@/components/ui/primitives";
import { requirePlatform } from "@/server/auth/guards";

/** The employee's own sign-in details: login + password only. */
export default async function AdminSecurityPage() {
  const p = await requirePlatform();
  const t = await getTranslations("security");
  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <Card>
        <CardBody>
          <DescriptionList items={[{ label: t("login"), value: <span className="break-all font-mono">{p.user.username}</span> }]} />
        </CardBody>
      </Card>
    </div>
  );
}
