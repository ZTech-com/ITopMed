import { createHmac } from "node:crypto";
import { createTranslator } from "use-intl/core";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";
import en from "../../../messages/en.json";
import ru from "../../../messages/ru.json";
import uzCyrl from "../../../messages/uz-Cyrl.json";
import uzLatn from "../../../messages/uz-Latn.json";
import { safeEqual } from "../security/crypto";

/**
 * The CENTRAL ITop Med bot (token in TELEGRAM_BOT_TOKEN), for ITop Med's own
 * staff: its Mini App (/tg) and console sign-in. Clinics have their own bots
 * (src/server/telegram/clinic-bot.ts). Telegram delivers updates to /api/telegram/webhook.
 *
 * This first part answers /start and /help with a button that opens ITop Med
 * inside Telegram. Telegram login and the Mini App build on it.
 *
 * Privacy: replies never contain clinical or personal data, and nothing from
 * the incoming message is logged or stored.
 */

const MESSAGES = { "uz-Latn": uzLatn, "uz-Cyrl": uzCyrl, ru, en } as const;

/**
 * Secret Telegram sends in X-Telegram-Bot-Api-Secret-Token with every update.
 * Derived from the bot token, so it needs no extra setting and changes when the
 * token is revoked. Allowed alphabet: A-Z a-z 0-9 _ - (base64url).
 */
export function webhookSecret(botToken: string): string {
  return createHmac("sha256", botToken).update("itopmed-webhook-v1").digest("base64url");
}

export function isValidWebhookSecret(botToken: string, header: string | null): boolean {
  return typeof header === "string" && header.length > 0 && safeEqual(header, webhookSecret(botToken));
}

/** Telegram's IETF language code → our UI language. Uzbek defaults to Latin script. */
export function localeFromTelegram(code: unknown): Locale {
  if (typeof code !== "string") return DEFAULT_LOCALE;
  const c = code.toLowerCase();
  if (c.startsWith("ru")) return "ru";
  if (c.startsWith("en")) return "en";
  if (c === "uz-cyrl") return "uz-Cyrl";
  return DEFAULT_LOCALE;
}

export function botText(locale: Locale) {
  return createTranslator({ locale, messages: MESSAGES[locale], namespace: "bot" });
}

/** Where the "open" button leads (opened as a Telegram Web App): the Mini App entry that recognises the person. */
export function webAppUrl(appUrl: string): string {
  return new URL("/tg", appUrl).toString();
}

interface TgUpdate {
  message?: {
    chat?: { id?: number; type?: string };
    from?: { id?: number; language_code?: string; is_bot?: boolean };
    text?: string;
    contact?: { phone_number?: string; user_id?: number };
  };
}

/**
 * A phone number the sender shared about THEMSELVES (Telegram's "share my
 * number" sets contact.user_id to the sender). Forwarded or typed contacts of
 * other people are never accepted.
 */
export function ownContact(update: unknown): { tgId: bigint; phone: string } | null {
  const msg = (update as TgUpdate | null)?.message;
  const from = msg?.from?.id;
  const c = msg?.contact;
  if (msg?.chat?.type !== "private" || msg?.from?.is_bot || typeof from !== "number" || !Number.isSafeInteger(from) || from <= 0) return null;
  if (!c || c.user_id !== from || typeof c.phone_number !== "string") return null;
  return { tgId: BigInt(from), phone: c.phone_number };
}

/**
 * Reply to an update, or null when nothing should be sent. The reply is
 * returned as the webhook response body (a Bot API method call), so no
 * outgoing request is needed.
 */
export function replyTo(update: unknown, appUrl: string): Record<string, unknown> | null {
  const msg = (update as TgUpdate | null)?.message;
  const chatId = msg?.chat?.id;
  // Private chats with people only; ignore groups, channels and other bots.
  if (typeof chatId !== "number" || msg?.chat?.type !== "private" || msg?.from?.is_bot) return null;
  const t = botText(localeFromTelegram(msg.from?.language_code));
  const text = typeof msg.text === "string" ? msg.text.trim() : "";
  const isHelp = /^\/help(@\w+)?$/i.test(text);
  if (msg.contact) {
    // Someone else's number is refused; one's own is confirmed with the open button.
    if (!ownContact(update)) return { method: "sendMessage", chat_id: chatId, text: t("phoneNotYours") };
  }
  return {
    method: "sendMessage",
    chat_id: chatId,
    text: msg.contact ? t("phoneSaved") : isHelp ? t("help") : t("welcome"),
    reply_markup: { inline_keyboard: [[{ text: t("open"), web_app: { url: webAppUrl(appUrl) } }]] },
  };
}
