import { Search, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { formatBirthDate, patientName } from "@/components/patients";
import { ButtonLink, Card, EmptyState, PageHeader, Table, Td, Th, buttonClass } from "@/components/ui/primitives";
import { requireClinic } from "@/server/auth/guards";
import { searchPatients } from "@/server/patients/patients";

export default async function PatientsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ q?: string }> }) {
  const { slug } = await params;
  const ctx = await requireClinic(slug, "patients.read");
  const q = ((await searchParams).q ?? "").slice(0, 100);
  const [t, results] = await Promise.all([getTranslations(), q.trim().length >= 2 ? searchPatients(ctx, q) : Promise.resolve(null)]);
  const base = `/c/${ctx.tenant.slug}/patients`;

  return (
    <>
      <PageHeader
        title={t("clinic.patients.title")}
        description={t("clinic.patients.subtitle")}
        action={
          ctx.permissions.has("patients.create") ? (
            <ButtonLink href={`${base}/new`}>
              <UserPlus aria-hidden className="size-4" />
              {t("clinic.patients.register")}
            </ButtonLink>
          ) : null
        }
      />
      <form role="search" className="mb-4 flex gap-2">
        <label className="relative flex-1">
          <span className="sr-only">{t("common.search")}</span>
          <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-text-3" />
          <input name="q" defaultValue={q} autoFocus autoComplete="off" placeholder={t("clinic.patients.searchPlaceholder")} className="h-12 w-full rounded-[var(--radius-control)] border border-border-strong bg-surface pl-10 pr-3 text-[16px] focus:border-accent focus:outline-none focus:ring-4 focus:ring-[var(--focus)]" />
        </label>
        <button className={buttonClass("secondary", "lg")}>{t("common.search")}</button>
      </form>
      <Card className="overflow-hidden">
        {results === null ? (
          <EmptyState icon={<Users className="size-6" />} title={t("clinic.patients.startTyping")} />
        ) : results.length === 0 ? (
          <EmptyState icon={<Users className="size-6" />} title={t("clinic.patients.noResults")} />
        ) : (
          <Table caption={t("clinic.patients.title")}>
            <thead>
              <tr>
                <Th>{t("clinic.patients.colPatient")}</Th>
                <Th>{t("clinic.patients.colBirth")}</Th>
                <Th>{t("clinic.patients.colPhone")}</Th>
              </tr>
            </thead>
            <tbody>
              {await Promise.all(
                results.map(async (p) => (
                  <tr key={p.id} className="hover:bg-surface-2">
                    <Td>
                      <Link href={`${base}/${p.id}`} className="font-medium hover:text-accent">
                        {patientName(p)}
                      </Link>
                      <p className="font-mono text-[12px] text-text-3">{p.mrn}</p>
                    </Td>
                    <Td className="text-text-2">{await formatBirthDate(p.birthDate)}</Td>
                    <Td className="tabular-nums text-text-2">{p.phone ?? "—"}</Td>
                  </tr>
                )),
              )}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
