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
  /** "none" = SMS channel off. "dev-outbox" = SIMULATED (writes files locally). No real SMS provider is connected yet. */
  SMS_TRANSPORT: z.enum(["none", "dev-outbox"]).default("none"),
  /** "database" (default): shared across instances. "memory": per process. */
  RATE_LIMIT_STORE: z.enum(["database", "memory"]).default("database"),
  /**
   * "1" = single-computer installation on a clinic's own network (`npm run local`).
   * Never set this on an internet-facing deployment.
   */
  LOCAL_MODE: z.enum(["0", "1"]).default("0"),
  /**
   * The SuperAdmin console's own address (e.g. https://admin.itoppos.uz). When
   * set, /admin is served only there and the clinic address redirects /admin to it.
   */
  ADMIN_URL: z.url().optional(),
  /**
   * Telegram delivery: "api" = the official Bot API (api.telegram.org, needs internet),
   * "dev-outbox" = SIMULATED (files in .dev-mailbox/telegram), "none" = off.
   * Default: api in production, dev-outbox otherwise.
   */
  TELEGRAM_TRANSPORT: z.enum(["api", "dev-outbox", "none"]).optional(),
  /**
   * Token of the CENTRAL ITop Med bot (@ITopMedBot): its /start and patients
   * sharing their phone. Not used for anyone's sign-in (staff and the console use
   * login + password). The clinics' own bots are stored encrypted per clinic.
   * Unset = central bot off.
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
  if (parsed.data.NODE_ENV === "production" && parsed.data.SMS_TRANSPORT === "dev-outbox") {
    throw new Error("SMS_TRANSPORT=dev-outbox is not allowed in production");
  }
  cached = parsed.data;
  return cached;
}

/** Re-read the environment (tests change it between cases). */
export function resetEnvCache() {
  cached = undefined;
}

export const isProduction = () => env().NODE_ENV === "production";

export function telegramTransport(): "api" | "dev-outbox" | "none" {
  const e = env();
  return e.TELEGRAM_TRANSPORT ?? (e.NODE_ENV === "production" ? "api" : "dev-outbox");
}
