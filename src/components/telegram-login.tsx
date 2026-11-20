import { Send } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { widgetBot } from "@/server/auth/telegram-login";
import { Alert, buttonClass } from "./ui/primitives";
import { TelegramWidget } from "./telegram-widget";

/** Is "Log in with Telegram" available: the clinic's own bot (slug), the central bot (/login), or the console's bot. */
export async function telegramLoginAvailable(kind: "clinic" | "admin", slug?: string | null): Promise<boolean> {
  return Boolean(await widgetBot(kind, slug));
}

/** Telegram's widget languages (it has no Cyrillic Uzbek: the same "uz"). */
const widgetLang = (locale: string) => (locale.startsWith("uz") ? "uz" : locale === "ru" ? "ru" : "en");

/**
 * "Log in with Telegram" — Telegram's own button (Login Widget), the MAIN way
 * to sign in on the website; login and password follow below it. Clinic staff
 * use their clinic's own bot (/login/<slug>) or the central bot (/login),
 * console staff the console's bot.
 * Hidden when no bot is set up; then the login form is the only way.
 */
export async function TelegramLoginButton({ kind, next, slug }: { kind: "clinic" | "admin"; next?: string | null; slug?: string | null }) {
  const bot = await widgetBot(kind, slug);
  if (!bot) return null;
  const [t, locale] = await Promise.all([getTranslations("auth"), getLocale()]);
  const q = new URLSearchParams({ kind, mode: "login", ...(kind === "clinic" && slug ? { slug } : {}), ...(next ? { next } : {}) });
  return (
    <div className="mb-5 space-y-5">
      <TelegramWidget bot={bot.username} authUrl={`/auth/telegram/callback?${q.toString()}`} lang={widgetLang(locale)} label={t("telegram")} />
      <p className="flex items-center gap-3 text-[13px] text-text-3">
        <span aria-hidden className="h-px flex-1 bg-border" />
        {t("orPassword")}
        <span aria-hidden className="h-px flex-1 bg-border" />
      </p>
    </div>
  );
}

/** The widget for linking, on /auth/telegram/link (after /auth/telegram/start set the flow cookie). */
export async function TelegramLinkWidget({ kind, slug, state }: { kind: "clinic" | "admin"; slug?: string; state: string }) {
  const bot = await widgetBot(kind, slug);
  if (!bot) return null;
  const [t, locale] = await Promise.all([getTranslations("security"), getLocale()]);
  const q = new URLSearchParams({ kind, mode: "link", state, ...(kind === "clinic" && slug ? { slug } : {}) });
  return <TelegramWidget bot={bot.username} authUrl={`/auth/telegram/callback?${q.toString()}`} lang={widgetLang(locale)} label={t("telegramLink")} />;
}

/**
 * Link control for the person's own security page. The Telegram user id is the
 * same in every bot, so clinic staff link through the central bot, or else
 * through any of their clinics' own bots.
 */
export async function TelegramLinkLink({ kind, slugs = [] }: { kind: "clinic" | "admin"; slugs?: string[] }) {
  let slug: string | null = null;
  if (kind === "clinic") {
    if (!(await widgetBot("clinic"))) {
      for (const s of slugs) if (await widgetBot("clinic", s)) {
        slug = s;
        break;
      }
      if (!slug) return null;
    }
  } else if (!(await widgetBot("admin"))) return null;
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
