import { z } from "zod";
import { LOCALES, TIMEZONES } from "@/i18n/config";

/**
 * Shared input schemas. Error messages are i18n keys (namespace `validation`)
 * so the same schema produces localized messages on the client and server.
 */

export const RESERVED_SLUGS = new Set([
  "admin", "api", "app", "www", "login", "logout", "invite", "static", "assets", "support", "help",
  "status", "itopmed", "platform", "account", "settings", "portal", "mail", "docs", "c", "p",
]);

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/, "validation.slug")
  .refine((s) => !s.includes("--"), "validation.slug")
  .refine((s) => !RESERVED_SLUGS.has(s), "validation.slugReserved");

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "validation.tooLong")
    .transform((v) => (v === "" ? undefined : v))
    .optional();

export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, ""))
  .pipe(z.string().regex(/^\+?[0-9]{7,15}$/, "validation.phone"));

export const personNameSchema = z.string().trim().min(2, "validation.required").max(120, "validation.tooLong");

export const createClinicSchema = z.object({
  name: z.string().trim().min(2, "validation.required").max(120, "validation.tooLong"),
  slug: slugSchema,
  legalName: optionalText(200),
  // Uzbekistan STIR (INN) is 9 digits for legal entities.
  taxId: z.union([z.literal("").transform(() => undefined), z.string().trim().regex(/^\d{9}$/, "validation.taxId")]).optional(),
  contactPhone: z.union([z.literal("").transform(() => undefined), phoneSchema]).optional(),
  address: optionalText(300),
  defaultLocale: z.enum(LOCALES),
  timezone: z.enum(TIMEZONES),
  planCode: z.string().trim().min(1, "validation.required"),
  ownerFullName: personNameSchema,
});
export type CreateClinicInput = z.infer<typeof createClinicSchema>;

export const clinicSettingsSchema = z.object({
  name: z.string().trim().min(2, "validation.required").max(120, "validation.tooLong"),
  legalName: optionalText(200),
  contactPhone: z.union([z.literal("").transform(() => undefined), phoneSchema]).optional(),
  address: optionalText(300),
  defaultLocale: z.enum(LOCALES),
  timezone: z.enum(TIMEZONES),
});

export const branchSchema = z.object({
  name: z.string().trim().min(2, "validation.required").max(120, "validation.tooLong"),
  address: optionalText(300),
  phone: z.union([z.literal("").transform(() => undefined), phoneSchema]).optional(),
});

/**
 * Sign-in name: lowercase letters, digits and . _ - (e.g. "dr.karimov").
 * Accounts that existed before login names were introduced use their email,
 * so "@" and "+" are accepted as well.
 */
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9._@+-]{2,63}$/, "validation.username");

export const loginSchema = z.object({
  username: z.string().trim().toLowerCase().min(1, "validation.required").max(64),
  password: z.string().min(1, "validation.required").max(256),
});

export const statusReasonSchema = z.string().trim().min(10, "validation.reasonTooShort").max(500, "validation.tooLong");

/** Flattens zod issues to { field: i18nKey } for form rendering. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "_form");
    if (!out[key]) out[key] = issue.message.startsWith("validation.") ? issue.message : "validation.invalid";
  }
  return out;
}
