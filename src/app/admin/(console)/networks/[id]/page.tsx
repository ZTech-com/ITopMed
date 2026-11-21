import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Form, SelectField, SubmitButton, TextField } from "@/components/ui/form";
import { Alert, Badge, ButtonLink, Card, CardBody, CardHeader, EmptyState, PageHeader, STATUS_TONE, Table, Td, Th, buttonClass } from "@/components/ui/primitives";
import { platformCan } from "@/server/authz/platform";
import { requirePlatform } from "@/server/auth/guards";
import { getNetwork } from "@/server/platform/networks";
import { suggestPassword } from "@/server/security/password";
import { networkAdminAction, tenantNetworkAction } from "../../../actions";

export default async function NetworkPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const p = await requirePlatform("networks.manage");
  const { id } = await params;
  const sp = await searchParams;
  const [data, t, format] = await Promise.all([getNetwork(p, id), getTranslations(), getFormatter()]);
  if (!data) notFound();
  const { network, unassigned } = data;
  const canAppoint = platformCan(p.user.role, "staff.manage");

  return (
    <>
      <PageHeader
        eyebrow={t("admin.networks.title")}
        title={network.name}
        description={t("admin.networks.detailHint")}
        action={<ButtonLink href={`/admin/clinics/new?network=${network.id}`}>{t("admin.networks.newClinic")}</ButtonLink>}
      />
      {sp.created ? (
        <div className="mb-6">
          <Alert tone="success">{t("admin.networks.created")}</Alert>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title={t("admin.networks.clinics")} />
            {network.tenants.length === 0 ? (
              <EmptyState title={t("admin.networks.noClinics")} />
            ) : (
              <Table caption={t("admin.networks.clinics")}>
                <thead>
                  <tr>
                    <Th>{t("admin.networks.clinic")}</Th>
                    <Th>{t("admin.clinicNew.sectionType")}</Th>
                    <Th>{t("admin.clinics.colStatus")}</Th>
                    <Th className="text-right">{t("admin.clinicDetail.people")}</Th>
                    <Th>
                      <span className="sr-only">{t("admin.networks.removeClinic")}</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {network.tenants.map((c) => (
                    <tr key={c.id}>
                      <Td>
                        <Link href={`/admin/clinics/${c.id}`} className="font-medium text-accent hover:underline">
                          {c.name}
                        </Link>
                        <span className="block font-mono text-[12px] text-text-3">{c.slug}</span>
                      </Td>
                      <Td label={t("admin.clinicNew.sectionType")}>{t(`practiceType.${c.practiceType}.name`)}</Td>
                      <Td label={t("admin.clinics.colStatus")}>
                        <Badge tone={STATUS_TONE[c.status]}>{t(`status.${c.status}`)}</Badge>
                      </Td>
                      <Td className="text-right tabular-nums" label={t("admin.clinicDetail.people")}>
                        {format.number(c._count.memberships)}
                      </Td>
                      <Td>
                        <Form action={tenantNetworkAction}>
                          <input type="hidden" name="networkId" value={network.id} />
                          <input type="hidden" name="tenantId" value={c.id} />
                          <button name="op" value="remove" className={buttonClass("ghost", "sm")}>
                            {t("admin.networks.removeClinic")}
                          </button>
                        </Form>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            {unassigned.length > 0 ? (
              <CardBody className="border-t border-border">
                <Form action={tenantNetworkAction}>
                  <input type="hidden" name="networkId" value={network.id} />
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="min-w-0 flex-1 sm:max-w-sm">
                      <SelectField name="tenantId" label={t("admin.networks.addClinic")} options={unassigned.map((u) => ({ value: u.id, label: u.name }))} />
                    </div>
                    <SubmitButton variant="secondary">{t("admin.networks.add")}</SubmitButton>
                  </div>
                </Form>
              </CardBody>
            ) : null}
          </Card>

          <Card>
            <CardHeader title={t("admin.networks.admins")} description={t("admin.networks.adminsHint")} />
            {network.admins.length === 0 ? (
              <EmptyState title={t("admin.networks.noAdmins")} />
            ) : (
              <ul className="divide-y divide-border">
                {network.admins.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6">
                    <div className="min-w-0">
                      <p className="font-medium">{a.fullName}</p>
                      <p className="break-all text-[13px] text-text-2">{a.username}</p>
                    </div>
                    <Badge tone={a.status === "ACTIVE" ? "success" : "neutral"}>{t(`status.${a.status}`)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {canAppoint ? (
          <Card>
            <CardHeader title={t("admin.networks.appoint")} description={t("admin.networks.appointHint")} />
            <CardBody>
              <Form action={networkAdminAction}>
                <input type="hidden" name="networkId" value={network.id} />
                <TextField name="fullName" label={t("admin.staff.colName")} autoComplete="off" required />
                <TextField name="username" label={t("admin.clinicNew.ownerUsername")} hint={t("admin.clinicNew.ownerUsernameHint")} autoComplete="off" required />
                <TextField name="password" label={t("admin.clinicNew.ownerPassword")} hint={t("admin.clinicNew.ownerPasswordHint")} defaultValue={suggestPassword()} autoComplete="new-password" required />
                <SubmitButton full>{t("admin.networks.appointSubmit")}</SubmitButton>
              </Form>
            </CardBody>
          </Card>
        ) : null}
      </div>
    </>
  );
}
