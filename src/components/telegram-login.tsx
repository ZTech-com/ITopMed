import { Send } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { telegramLogin } from "@/server/env";
import { clinicBot } from "@/server/telegram/clinic-bot";
import { Alert, buttonClass } from "./ui/primitives";

/** Is "Sign in with Telegram" available: the clinic's own bot with a Login Widget secret, or the central bot for the console. */
export async function telegramLoginAvailable(kind: "clinic" | "admin", slug?: string | null): Promise<boolean> {
  if (kind === "admin") return Boolean(telegramLogin());
  return Boolean(slug && (await clinicBot(slug))?.loginSecret);
}

/**
 * "Log In with Telegram" — the MAIN way to sign in on the website; login and
 * password follow below it as the second way. A plain link to our own
 * /auth/telegram/start: no Telegram script runs on our pages. Clinic staff use
 * their clinic's own bot (/login/<slug>), console staff the central bot. Hidden
 * when no bot is set up; then the login form is the only way.
 */
export async function TelegramLoginButton({ kind, next, slug }: { kind: "clinic" | "admin"; next?: string | null; slug?: string | null }) {
  if (!(await telegramLoginAvailable(kind, slug))) return null;
  const t = await getTranslations("auth");
  const q = new URLSearchParams({ kind, mode: "login", ...(next ? { next } : {}), ...(kind === "clinic" && slug ? { slug } : {}) });
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

/**
 * Link control for the person's own security page. The Telegram user id is the
 * same in every bot, so clinic staff link through any of their clinics' bots.
 */
export async function TelegramLinkLink({ kind, slugs = [] }: { kind: "clinic" | "admin"; slugs?: string[] }) {
  let slug: string | null = null;
  if (kind === "clinic") {
    for (const s of slugs) if ((await clinicBot(s))?.loginSecret) {
      slug = s;
      break;
    }
    if (!slug) return null;
  } else if (!telegramLogin()) return null;
  const t = await getTranslations("security");
  return (
    <a href={`/auth/telegram/start?kind=${kind}&mode=link${slug ? `&slug=${slug}` : ""}`} className={buttonClass("secondary", "md")}>
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
