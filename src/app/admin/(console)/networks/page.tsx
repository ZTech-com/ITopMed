import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Form, SubmitButton, TextField } from "@/components/ui/form";
import { Card, CardBody, CardHeader, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui/primitives";
import { requirePlatform } from "@/server/auth/guards";
import { listNetworks } from "@/server/platform/networks";
import { createNetworkAction } from "../../actions";

/** Networks (franchises, chains, holdings): groups of clinics with their own network admins. Super admin only. */
export default async function NetworksPage() {
  const p = await requirePlatform("networks.manage");
  const [t, format, networks] = await Promise.all([getTranslations(), getFormatter(), listNetworks(p)]);
  const optional = t("common.optional");

  return (
    <>
      <PageHeader title={t("admin.networks.title")} description={t("admin.networks.subtitle")} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            {networks.length === 0 ? (
              <EmptyState title={t("admin.networks.empty")} description={t("admin.networks.emptyHint")} />
            ) : (
              <Table caption={t("admin.networks.title")}>
                <thead>
                  <tr>
                    <Th>{t("admin.networks.name")}</Th>
                    <Th className="text-right">{t("admin.networks.clinics")}</Th>
                    <Th className="text-right">{t("admin.networks.admins")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {networks.map((n) => (
                    <tr key={n.id}>
                      <Td>
                        <Link href={`/admin/networks/${n.id}`} className="font-medium text-accent hover:underline">
                          {n.name}
                        </Link>
                        {n.contactName ? <span className="block text-[13px] text-text-2">{n.contactName}</span> : null}
                      </Td>
                      <Td className="text-right tabular-nums" label={t("admin.networks.clinics")}>
                        {format.number(n._count.tenants)}
                      </Td>
                      <Td className="text-right tabular-nums" label={t("admin.networks.admins")}>
                        {format.number(n._count.admins)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
        <Card>
          <CardHeader title={t("admin.networks.create")} description={t("admin.networks.createHint")} />
          <CardBody>
            <Form action={createNetworkAction}>
              <TextField name="name" label={t("admin.networks.name")} required />
              <TextField name="contactName" label={t("admin.networks.contactName")} optionalLabel={optional} />
              <TextField name="contactPhone" type="tel" label={t("admin.networks.contactPhone")} inputMode="tel" placeholder="+998" optionalLabel={optional} />
              <SubmitButton full>{t("admin.networks.createSubmit")}</SubmitButton>
            </Form>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
