import { getTranslations } from "next-intl/server";
import { AuthLayout } from "@/components/shell/auth-layout";
import { ButtonLink, DescriptionList } from "@/components/ui/primitives";
import { safeNext } from "@/lib/safe-next";
import { requireClinicUser } from "@/server/auth/guards";

/** Account-level sign-in details for clinic staff: login + password only (the Administrator gives a new password). */
export default async function AccountSecurityPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const p = await requireClinicUser();
  const sp = await searchParams;
  const next = safeNext(sp.next) ?? "/clinics";
  const t = await getTranslations("security");
  return (
    <AuthLayout title={t("title")} subtitle={p.user.fullName}>
      <div className="space-y-5">
        <DescriptionList items={[{ label: t("login"), value: <span className="break-all font-mono">{p.user.username}</span> }]} />
        <p className="text-[14px] text-text-2">{t("passwordByAdmin")}</p>
        <ButtonLink href={next} variant="secondary" className="w-full">
          {t("continue")}
        </ButtonLink>
      </div>
    </AuthLayout>
  );
}
