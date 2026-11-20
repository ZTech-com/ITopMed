import { getTranslations } from "next-intl/server";
import { TelegramLinkLink, TelegramNotice, telegramLoginAvailable } from "@/components/telegram-login";
import { AuthLayout } from "@/components/shell/auth-layout";
import { Form, SubmitButton } from "@/components/ui/form";
import { Badge, ButtonLink, DescriptionList } from "@/components/ui/primitives";
import { safeNext } from "@/lib/safe-next";
import { requireClinicUser } from "@/server/auth/guards";
import { unlinkTelegramAction } from "../../../clinic-actions";

/** Account-level sign-in settings for clinic staff (the account may belong to several clinics). */
export default async function AccountSecurityPage({ searchParams }: { searchParams: Promise<{ next?: string; tg?: string }> }) {
  const p = await requireClinicUser();
  const sp = await searchParams;
  const next = safeNext(sp.next) ?? "/clinics";
  const t = await getTranslations("security");
  let telegramOn = false;
  for (const c of p.clinics) if (await telegramLoginAvailable("clinic", c.slug)) telegramOn = true;
  return (
    <AuthLayout title={t("title")} subtitle={p.user.fullName}>
      <TelegramNotice code={sp.tg} />
      <div className="space-y-5">
        <DescriptionList
          items={[
            { label: t("login"), value: <span className="break-all font-mono">{p.user.username}</span> },
            { label: t("telegram"), value: p.user.telegramLinked ? <Badge tone="success">{t("telegramOn")}</Badge> : <Badge tone="neutral">{t("telegramOff")}</Badge> },
          ]}
        />
        <p className="text-[14px] text-text-2">{telegramOn ? t("telegramIntro") : t("telegramUnavailable")}</p>
        {p.user.telegramLinked ? (
          <Form action={unlinkTelegramAction}>
            <SubmitButton variant="secondary">{t("telegramUnlink")}</SubmitButton>
          </Form>
        ) : (
          <TelegramLinkLink kind="clinic" slugs={p.clinics.map((c) => c.slug)} />
        )}
        <ButtonLink href={next} variant="secondary" className="w-full">
          {t("continue")}
        </ButtonLink>
      </div>
    </AuthLayout>
  );
}
