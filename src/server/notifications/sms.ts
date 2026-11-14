import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../env";
import { logger } from "../logger";
import { mailboxRoot } from "../local/paths";

/**
 * SMS delivery.
 *  - none: the SMS channel is off; nothing is queued for SMS.
 *  - dev-outbox: SIMULATED delivery for local development and tests. Messages
 *    are written to ./.dev-mailbox/sms (git-ignored). Refused in production.
 *
 * No real SMS provider (e.g. an Uzbek SMS gateway) is integrated yet: that
 * needs a contract, sender-ID registration and the provider's official API
 * documentation. Do not add an adapter from guesses.
 */
export type SmsTransport = "sms-dev-outbox";

export function smsEnabled(): boolean {
  return env().SMS_TRANSPORT !== "none";
}

export async function sendSms(to: string, text: string): Promise<{ delivered: boolean; transport: SmsTransport | null }> {
  const e = env();
  if (e.SMS_TRANSPORT === "none") return { delivered: false, transport: null };
  try {
    const dir = path.join(mailboxRoot(), "sms");
    await fs.mkdir(dir, { recursive: true });
    const safeTo = to.replace(/[^0-9+]/g, "");
    const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}_${safeTo}.txt`);
    await fs.writeFile(file, `SIMULATED SMS (dev-outbox transport)\nTo: ${safeTo}\n\n${text}\n`, "utf8");
    return { delivered: true, transport: "sms-dev-outbox" };
  } catch (err) {
    logger.error("sms.send_failed", { transport: e.SMS_TRANSPORT, error: err instanceof Error ? err.name : "unknown" });
    return { delivered: false, transport: "sms-dev-outbox" };
  }
}
