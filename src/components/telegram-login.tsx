import { Send } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { telegramLogin } from "@/server/env";
import { Alert, buttonClass } from "./ui/primitives";

/**
 * "Log In with Telegram" — the MAIN way to sign in on the website; login and
 * password follow below it as the second way. A plain link to our own
 * /auth/telegram/start: no Telegram script runs on our pages. Hidden when the
 * bot is not configured (e.g. a clinic's local installation, which Telegram
 * cannot reach); then the login form is the only way.
 */
export async function TelegramLoginButton({ kind, next }: { kind: "clinic" | "admin"; next?: string | null }) {
  if (!telegramLogin()) return null;
  const t = await getTranslations("auth");
  const q = new URLSearchParams({ kind, mode: "login", ...(next ? { next } : {}) });
  return (
    <div className="mb-5 space-y-5">
      <a href={`/auth/telegram/start?${q.toString()}`} className={buttonClass("primary", "lg", "w-full")}>
        <Send aria-hidden className="size-4" />
        {t("telegram")}
      </a>
      <p className="flex items-center gap-3 text-[13px] text-text-3">
        <span aria-hidden className="h-px flex-1 bg-border" />
        {t("orPassword")}
        <span aria-hidden className="h-px flex-1 bg-border" />
      </p>
    </div>
  );
}

/** Link/unlink control for the person's own security page. */
export async function TelegramLinkLink({ kind }: { kind: "clinic" | "admin" }) {
  if (!telegramLogin()) return null;
  const t = await getTranslations("security");
  return (
    <a href={`/auth/telegram/start?kind=${kind}&mode=link`} className={buttonClass("secondary", "md")}>
      <Send aria-hidden className="size-4" />
      {t("telegramLink")}
    </a>
  );
}

const CODES = new Set(["failed", "cancelled", "not_linked", "locked", "rate_limited", "taken", "disabled", "linked"]);

/** Result of a Telegram round trip, from the fixed ?tg= code (never personal data). */
export async function TelegramNotice({ code }: { code?: string }) {
  if (!code || !CODES.has(code)) return null;
  const t = await getTranslations("telegramLogin");
  return (
    <div className="mb-5">
      <Alert tone={code === "linked" ? "success" : code === "cancelled" ? "neutral" : "warning"}>{t(code)}</Alert>
    </div>
  );
}
