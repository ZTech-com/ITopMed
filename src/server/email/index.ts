import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";
import { env } from "../env";
import { logger } from "../logger";
import { mailboxRoot } from "../local/paths";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Email delivery.
 *  - dev-mailbox: SIMULATED delivery for local development. Messages are written
 *    to ./.dev-mailbox (git-ignored). Refused in production by env validation.
 *  - smtp: real delivery through the configured SMTP relay.
 *
 * Emails must never contain clinical information. Invitation links are the
 * only secret they carry; those tokens are single-use and expire.
 */
export async function sendEmail(msg: EmailMessage): Promise<{ delivered: boolean }> {
  const e = env();
  try {
    if (e.EMAIL_TRANSPORT === "smtp") {
      if (!e.SMTP_URL) throw new Error("SMTP_URL is not configured");
      const transport = nodemailer.createTransport(e.SMTP_URL);
      await transport.sendMail({ from: e.EMAIL_FROM, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html });
    } else {
      const dir = mailboxRoot();
      await fs.mkdir(dir, { recursive: true });
      const safeTo = msg.to.replace(/[^a-z0-9@._-]/gi, "_");
      const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}_${safeTo}.html`);
      const body = `<!-- SIMULATED EMAIL (dev-mailbox transport) -->\n<!-- To: ${safeTo} -->\n<!-- Subject: ${escapeHtml(msg.subject)} -->\n${msg.html}`;
      await fs.writeFile(file, body, "utf8");
    }
    return { delivered: true };
  } catch (err) {
    logger.error("email.send_failed", { transport: e.EMAIL_TRANSPORT, error: err instanceof Error ? err.message : "unknown" });
    return { delivered: false };
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
