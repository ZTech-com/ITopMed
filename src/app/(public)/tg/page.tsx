import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthLayout } from "@/components/shell/auth-layout";
import { TelegramMiniApp } from "@/components/telegram-mini-app";

/**
 * The central bot's Mini App entry (button "Open ITop Med" in Telegram).
 * Public by design: who the person is comes from Telegram's signed launch data,
 * verified on the server by /auth/telegram/webapp.
 */
export const metadata: Metadata = { referrer: "no-referrer", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function TelegramAppPage() {
  const t = await getTranslations("telegramApp");
  return (
    <AuthLayout title={t("title")}>
      <TelegramMiniApp />
    </AuthLayout>
  );
}
