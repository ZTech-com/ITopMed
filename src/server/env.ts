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
  APP_ENCRYPTION_KEY: base64Key,
  AUDIT_HMAC_KEY: base64Key,
  EMAIL_TRANSPORT: z.enum(["dev-mailbox", "smtp"]).default("dev-mailbox"),
  SMTP_URL: z.string().optional(),
  EMAIL_FROM: z.string().default("ITop Med <no-reply@itopmed.example>"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Validated environment. Fails fast and never prints secret values. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration — ${fields}`);
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.EMAIL_TRANSPORT === "dev-mailbox") {
    throw new Error("EMAIL_TRANSPORT=dev-mailbox is not allowed in production");
  }
  cached = parsed.data;
  return cached;
}

export const isProduction = () => env().NODE_ENV === "production";
