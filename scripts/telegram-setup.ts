/**
 * `npm run telegram:setup [-- --url https://itopmed.example.uz]`
 *
 * Points the CENTRAL bot (TELEGRAM_BOT_TOKEN) at this deployment: webhook with
 * the derived secret, /start + /help commands in every UI language, and the
 * menu button that opens ITop Med as a Telegram Web App. Safe to run again.
 * The URL defaults to APP_URL and must be public HTTPS (Telegram requirement).
 * Prints no secrets.
 */
import "dotenv/config";
import { botText, webAppUrl, webhookSecret } from "../src/server/telegram/central-bot";

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  const i = process.argv.indexOf("--url");
  const appUrl = new URL((i > 0 ? process.argv[i + 1] : process.env.APP_URL) ?? "").origin;
  if (!appUrl.startsWith("https://")) throw new Error("The URL must be public HTTPS");

  const call = async (method: string, body: Record<string, unknown>) => {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json()) as { ok: boolean; result?: unknown; description?: string };
    if (!json.ok) throw new Error(`${method}: ${json.description ?? res.status}`);
    return json.result;
  };

  const me = (await call("getMe", {})) as { username: string };
  console.log(`Bot: @${me.username}`);

  await call("setWebhook", {
    url: `${appUrl}/api/telegram/webhook`,
    secret_token: webhookSecret(token),
    allowed_updates: ["message"],
    drop_pending_updates: false,
  });
  console.log(`Webhook → ${appUrl}/api/telegram/webhook`);

  // Default list (any language) = uz-Latn, plus Russian and English users.
  // uz-Cyrl has no Telegram language code of its own.
  for (const [locale, lang] of [["uz-Latn", undefined], ["ru", "ru"], ["en", "en"]] as const) {
    const t = botText(locale);
    await call("setMyCommands", {
      commands: [{ command: "start", description: t("cmdStart") }, { command: "help", description: t("cmdHelp") }],
      ...(lang ? { language_code: lang } : {}),
    });
  }
  console.log("Commands: /start, /help");

  await call("setChatMenuButton", { menu_button: { type: "web_app", text: botText("uz-Latn")("menu"), web_app: { url: webAppUrl(appUrl) } } });
  console.log(`Menu button → ${webAppUrl(appUrl)}`);

  const info = (await call("getWebhookInfo", {})) as { pending_update_count: number; last_error_message?: string };
  console.log(`Pending updates: ${info.pending_update_count}${info.last_error_message ? `; last error: ${info.last_error_message}` : ""}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
