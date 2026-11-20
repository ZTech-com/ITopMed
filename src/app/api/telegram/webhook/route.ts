import { env } from "@/server/env";
import { logger } from "@/server/logger";
import { saveTelegramContact } from "@/server/portal/auth";
import { isValidWebhookSecret, ownContact, replyTo } from "@/server/telegram/central-bot";

/**
 * Updates of the CENTRAL ITop Med bot (see src/server/telegram/central-bot.ts).
 * Public by necessity (Telegram calls it, there is no user session); the
 * credential is the secret Telegram sends in X-Telegram-Bot-Api-Secret-Token,
 * derived from the bot token and compared in constant time. Anything else → 404.
 */
export const dynamic = "force-dynamic";

const MAX_BODY = 64 * 1024;

export async function POST(request: Request) {
  const token = env().TELEGRAM_BOT_TOKEN;
  if (!token || !isValidWebhookSecret(token, request.headers.get("x-telegram-bot-api-secret-token"))) {
    return new Response(null, { status: 404 });
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY) return new Response(null, { status: 413 });
  let update: unknown;
  try {
    update = JSON.parse(raw);
  } catch {
    return new Response(null, { status: 400 });
  }
  // A person shared their own phone number: remember it so the Mini App can find their patient account.
  const contact = ownContact(update);
  const saved = contact ? await saveTelegramContact(contact.tgId, contact.phone) : false;
  const reply = replyTo(update, env().APP_URL);
  logger.info("telegram.central_update", { replied: Boolean(reply), contactSaved: saved });
  // Telegram executes a method returned in the webhook response; an empty 200 = "received".
  return reply ? Response.json(reply) : new Response(null, { status: 200 });
}
