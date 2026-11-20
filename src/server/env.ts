import "server-only";
import { z } from "zod";

const base64Key = z
  .string()
  .min(1, "required")
  .refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes, base64-encoded");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url(),
  DATABASE_URL: z.string().startsWith("postgres"),
  PLATFORM_DATABASE_URL: z.string().startsWith("postgres"),
  PORTAL_DATABASE_URL: z.string().startsWith("postgres"),
  APP_ENCRYPTION_KEY: base64Key,
  AUDIT_HMAC_KEY: base64Key,
  EMAIL_TRANSPORT: z.enum(["dev-mailbox", "smtp", "disabled"]).default("dev-mailbox"),
  SMTP_URL: z.string().optional(),
  EMAIL_FROM: z.string().default("ITop Med <no-reply@itopmed.example>"),
  /** "none" = SMS channel off. "dev-outbox" = SIMULATED (writes files locally). No real SMS provider is connected yet. */
  SMS_TRANSPORT: z.enum(["none", "dev-outbox"]).default("none"),
  /** "database" (default): shared across instances. "memory": per process. */
  RATE_LIMIT_STORE: z.enum(["database", "memory"]).default("database"),
  /**
   * "1" = single-computer installation on a clinic's own network (`npm run local`).
   * Allows the local mailbox (emails saved as files on that computer) when no SMTP
   * server is configured. Never set this on an internet-facing deployment.
   */
  LOCAL_MODE: z.enum(["0", "1"]).default("0"),
  /**
   * Comma-separated emails that sign in with the password alone (no TOTP step).
   * An explicit, owner-made exception — weaker protection for those accounts.
   * Every such sign-in is audited with `mfaExempt: true`. Empty = nobody.
   */
  MFA_EXEMPT_EMAILS: z.string().default(""),
  /**
   * Telegram delivery: "api" = the official Bot API (api.telegram.org, needs internet),
   * "dev-outbox" = SIMULATED (files in .dev-mailbox/telegram), "none" = off.
   * Default: api in production, dev-outbox otherwise.
   */
  TELEGRAM_TRANSPORT: z.enum(["api", "dev-outbox", "none"]).optional(),
  /**
   * Token of the CENTRAL ITop Med bot (Login Widget, Mini App, /start). Not the
   * clinics' own bots (those are stored encrypted per clinic). Unset = central bot off.
   */
  TELEGRAM_BOT_TOKEN: z
    .string()
    .regex(/^\d{5,15}:[A-Za-z0-9_-]{30,64}$/, "must be a Telegram bot token")
    .optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Validated environment. Fails fast and never prints secret values. */
export function env(): Env {
  if (cached) return cached;
  // An empty line in .env ("TELEGRAM_TRANSPORT=") means "not set", not an invalid value.
  const parsed = schema.safeParse(Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== "")));
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration — ${fields}`);
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.EMAIL_TRANSPORT === "dev-mailbox" && parsed.data.LOCAL_MODE !== "1") {
    throw new Error("EMAIL_TRANSPORT=dev-mailbox is not allowed in production");
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.SMS_TRANSPORT === "dev-outbox") {
    throw new Error("SMS_TRANSPORT=dev-outbox is not allowed in production");
  }
  cached = parsed.data;
  return cached;
}

/** After the first-run form changes a setting in this process (MFA_EXEMPT_EMAILS). */
export function resetEnvCache() {
  cached = undefined;
}

export const isProduction = () => env().NODE_ENV === "production";

export function telegramTransport(): "api" | "dev-outbox" | "none" {
  const e = env();
  return e.TELEGRAM_TRANSPORT ?? (e.NODE_ENV === "production" ? "api" : "dev-outbox");
}

/** True when the owner listed this account in MFA_EXEMPT_EMAILS (see .env.example). */
export function isMfaExempt(email: string): boolean {
  const list = env()
    .MFA_EXEMPT_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}
