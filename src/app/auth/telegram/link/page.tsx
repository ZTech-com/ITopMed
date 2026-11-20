import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuthLayout } from "@/components/shell/auth-layout";
import { TelegramLinkWidget } from "@/components/telegram-login";
import { getClinicPrincipal, getPlatformPrincipal } from "@/server/auth/guards";

export const dynamic = "force-dynamic";

/**
 * Telegram's button for LINKING, opened by /auth/telegram/start (which set the
 * flow cookie). Only for a signed-in account; the callback re-checks the cookie.
 */
export default async function TelegramLinkPage({ searchParams }: { searchParams: Promise<{ kind?: string; slug?: string; state?: string }> }) {
  const sp = await searchParams;
  const kind = sp.kind === "admin" ? "admin" : "clinic";
  const p = kind === "admin" ? await getPlatformPrincipal() : await getClinicPrincipal();
  if (!p) redirect(kind === "admin" ? "/admin/login" : "/login");
  const security = kind === "admin" ? "/admin/security" : "/account/security";
  const state = sp.state && /^[\w-]{16,128}$/.test(sp.state) ? sp.state : null;
  const slug = kind === "clinic" && sp.slug && /^[a-z0-9-]{3,48}$/.test(sp.slug) ? sp.slug : undefined;
  if (!state) redirect(`${security}?tg=failed`);
  const t = await getTranslations("security");
  return (
    <AuthLayout title={t("telegramLink")} subtitle={t("telegramLinkHint")}>
      <div className="space-y-5">
        <TelegramLinkWidget kind={kind} slug={slug} state={state} />
        <p className="text-center text-[13px]">
          <Link href={security} className="text-accent hover:underline">
            {t("telegramLinkBack")}
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}
