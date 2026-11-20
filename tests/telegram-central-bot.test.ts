import { describe, expect, it } from "vitest";
import { isValidWebhookSecret, localeFromTelegram, replyTo, webhookSecret } from "@/server/telegram/central-bot";

// Synthetic token (format only; not a real bot).
const TOKEN = "1234567890:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const APP = "https://itopmed.example.test";

const msg = (over: Record<string, unknown> = {}) => ({
  update_id: 1,
  message: { message_id: 1, chat: { id: 42, type: "private" }, from: { id: 7, is_bot: false, language_code: "uz" }, text: "/start", ...over },
});

describe("central Telegram bot", () => {
  it("derives a webhook secret Telegram accepts and checks it in constant time", () => {
    const s = webhookSecret(TOKEN);
    expect(s).toMatch(/^[A-Za-z0-9_-]{20,256}$/);
    expect(webhookSecret(TOKEN)).toBe(s);
    expect(webhookSecret("1234567890:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB")).not.toBe(s);
    expect(isValidWebhookSecret(TOKEN, s)).toBe(true);
    expect(isValidWebhookSecret(TOKEN, `${s}x`)).toBe(false);
    expect(isValidWebhookSecret(TOKEN, "")).toBe(false);
    expect(isValidWebhookSecret(TOKEN, null)).toBe(false);
  });

  it("answers /start with an open-in-Telegram button to the app", () => {
    const r = replyTo(msg(), APP) as { method: string; chat_id: number; text: string; reply_markup: { inline_keyboard: { text: string; web_app: { url: string } }[][] } };
    expect(r.method).toBe("sendMessage");
    expect(r.chat_id).toBe(42);
    expect(r.text).toContain("ITop Med");
    expect(r.reply_markup.inline_keyboard[0]?.[0]?.web_app.url).toBe(`${APP}/tg`);
  });

  it("replies in the user's language and treats /help separately", () => {
    const ru = replyTo(msg({ from: { is_bot: false, language_code: "ru" } }), APP) as { text: string };
    expect(ru.text).toMatch(/Здравствуйте/);
    const help = replyTo(msg({ text: "/help" }), APP) as { text: string };
    expect(help.text).toContain("/start");
    expect(localeFromTelegram("en-GB")).toBe("en");
    expect(localeFromTelegram(undefined)).toBe("uz-Latn");
  });

  it("ignores groups, other bots and malformed updates", () => {
    expect(replyTo(msg({ chat: { id: -100, type: "group" } }), APP)).toBeNull();
    expect(replyTo(msg({ from: { is_bot: true } }), APP)).toBeNull();
    expect(replyTo({}, APP)).toBeNull();
    expect(replyTo(null, APP)).toBeNull();
    expect(replyTo({ message: { chat: { id: "42", type: "private" } } }, APP)).toBeNull();
  });
});
