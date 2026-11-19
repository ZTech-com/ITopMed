import "server-only";
import { z } from "zod";
import { RESERVED_SLUGS, emailSchema, personNameSchema, usernameSchema } from "@/lib/validation";
import { createPlatformUser, type PlatformPrincipal, type RequestMeta } from "../auth/platform-auth";
import { clinicPresetSchema } from "../clinic/practice";
import { platformDb, withPlatform } from "../db";
import { DomainError } from "../errors";
import { passwordSchema } from "../security/password";
import { changeTenantStatus, createClinicWithOwner } from "../tenancy/provisioning";

/**
 * First start of a fresh local installation (the packaged Windows app): instead
 * of command-line steps, the person who installed it fills one form on THIS
 * computer - their clinic and their account. Allowed only while the platform
 * has no accounts at all, only in a local installation, and only from this
 * computer itself (the local proxy sets the real client address).
 */
export async function needsFirstRun(): Promise<boolean> {
  if (process.env.LOCAL_MODE !== "1") return false;
  return (await platformDb().platformUser.count()) === 0;
}

function isThisComputer(ip: string | null): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

export const firstRunSchema = z
  .object({
    clinicName: z.string().trim().min(2, "validation.required").max(120, "validation.tooLong"),
    fullName: personNameSchema,
    email: emailSchema,
    username: usernameSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, { message: "validation.passwordMismatch", path: ["confirmPassword"] });

/** A workspace address from the clinic name ("Shifo Kardio" -> "shifo-kardio"). */
export function slugFromName(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[ʻʼ'`‘’]/g, "")
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 40)
    .replace(/-+$/g, "");
  const slug = s.length >= 3 ? s : `klinika-${s || "1"}`.replace(/-+$/g, "");
  return RESERVED_SLUGS.has(slug) ? `${slug}-klinika` : slug;
}

export async function completeFirstRun(raw: unknown, meta: RequestMeta): Promise<{ slug: string }> {
  if (!(await needsFirstRun()) || !isThisComputer(meta.ip ?? null)) throw new DomainError("errors.forbidden");
  const input = firstRunSchema.parse(raw);
  const preset = clinicPresetSchema.parse(raw);

  // The installer becomes the SuperAdmin of this computer's installation and the owner (Admin) of the clinic.
  const id = await createPlatformUser({ email: input.email, username: input.username, fullName: input.fullName, password: input.password, role: "SUPER_ADMIN" });
  if ((await platformDb().platformUser.count()) > 1) {
    // Two forms submitted at once: the other one won.
    await platformDb().platformUser.update({ where: { id }, data: { status: "DISABLED" } });
    throw new DomainError("errors.forbidden");
  }
  const actor: PlatformPrincipal = { sessionId: "first-run", user: { id, username: input.username, email: input.email, fullName: input.fullName, role: "SUPER_ADMIN", locale: "uz-Latn", telegramLinked: false } };
  const slug = slugFromName(input.clinicName);
  const created = await createClinicWithOwner(
    actor,
    {
      ...preset,
      name: input.clinicName,
      slug,
      contactEmail: input.email,
      defaultLocale: "uz-Latn",
      timezone: "Asia/Tashkent",
      planCode: "enterprise",
      ownerFullName: input.fullName,
      ownerEmail: input.email,
      taxId: "",
      contactPhone: "",
      ownerMode: "password",
      ownerUsername: input.username,
      ownerPassword: input.password,
    },
    meta,
  );
  // The clinic's own computer: no trial period - the clinic is active from the start.
  await changeTenantStatus(actor, created.tenantId, "activate", undefined, meta);
  await withPlatform((tx) => tx.subscription.updateMany({ where: { tenantId: created.tenantId }, data: { status: "ACTIVE", trialEndsAt: null } }));
  return { slug };
}
