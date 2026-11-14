import "server-only";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { RESERVED_SLUGS, emailSchema, personNameSchema } from "@/lib/validation";
import { createPlatformUser, type PlatformPrincipal, type RequestMeta } from "../auth/platform-auth";
import { clinicPresetSchema } from "../clinic/practice";
import { platformDb, withPlatform } from "../db";
import { resetEnvCache } from "../env";
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

const checkbox = z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean());

export const firstRunSchema = z
  .object({
    clinicName: z.string().trim().min(2, "validation.required").max(120, "validation.tooLong"),
    fullName: personNameSchema,
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    mfa: checkbox.default(false),
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

/** Lets the owner sign in with the password alone on this computer (their explicit choice on the form). */
function exemptFromMfa(email: string) {
  const home = process.env.ITM_HOME;
  if (home) {
    const file = path.join(home, ".env");
    const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    const line = /^MFA_EXEMPT_EMAILS=(.*)$/m.exec(text);
    const list = new Set((line?.[1] ?? "").split(",").map((e) => e.trim()).filter(Boolean));
    list.add(email);
    const next = `MFA_EXEMPT_EMAILS=${[...list].join(",")}`;
    fs.writeFileSync(file, line ? text.replace(line[0], next) : `${text}\n${next}\n`, { mode: 0o600 });
  }
  const current = (process.env.MFA_EXEMPT_EMAILS ?? "").split(",").filter(Boolean);
  process.env.MFA_EXEMPT_EMAILS = [...new Set([...current, email])].join(",");
  resetEnvCache();
}

export async function completeFirstRun(raw: unknown, meta: RequestMeta): Promise<{ slug: string }> {
  if (!(await needsFirstRun()) || !isThisComputer(meta.ip ?? null)) throw new DomainError("errors.forbidden");
  const input = firstRunSchema.parse(raw);
  const preset = clinicPresetSchema.parse(raw);

  // The installer becomes the SuperAdmin of this computer's installation and the owner (Admin) of the clinic.
  const id = await createPlatformUser({ email: input.email, fullName: input.fullName, password: input.password, role: "SUPER_ADMIN" });
  if ((await platformDb().platformUser.count()) > 1) {
    // Two forms submitted at once: the other one won.
    await platformDb().platformUser.update({ where: { id }, data: { status: "DISABLED" } });
    throw new DomainError("errors.forbidden");
  }
  const actor: PlatformPrincipal = { sessionId: "first-run", mfaVerified: true, user: { id, email: input.email, fullName: input.fullName, role: "SUPER_ADMIN", locale: "uz-Latn", mfaEnrolled: false } };
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
      ownerPassword: input.password,
    },
    meta,
  );
  // The clinic's own computer: no trial period - the clinic is active from the start.
  await changeTenantStatus(actor, created.tenantId, "activate", undefined, meta);
  await withPlatform((tx) => tx.subscription.updateMany({ where: { tenantId: created.tenantId }, data: { status: "ACTIVE", trialEndsAt: null } }));
  if (!input.mfa) exemptFromMfa(input.email);
  return { slug };
}
