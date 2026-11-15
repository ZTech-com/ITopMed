/**
 * Opens a clinic ready to work, from a small JSON spec, without the web
 * console: clinic + owner account (the owner's password is typed by the
 * person running the command and never stored in clear), the field preset
 * (starter services, document and note templates, owner's doctor profile and
 * front-desk roles) and the clinic's own price list.
 *
 * Used by `node tasks.mjs create-clinic <spec.json> <owner-email> "<Owner Name>"`
 * on the server (see scripts/deploy/itopmed-clinic.sh).
 */
import fs from "node:fs";
import { z } from "zod";
import { loginClinicUser, logoutClinic, resolveClinic, validateClinicSession } from "../../src/server/auth/clinic-auth";
import type { PlatformPrincipal, RequestMeta } from "../../src/server/auth/platform-auth";
import { applyPendingSetup } from "../../src/server/clinic/practice";
import { importPriceList } from "../../src/server/clinic/price-list";
import { listServices, setServiceArchived } from "../../src/server/clinic/resources";
import { recordAudit } from "../../src/server/audit";
import { platformDb, withAppContext, withPlatform } from "../../src/server/db";
import { changeTenantStatus, createClinicWithOwner } from "../../src/server/tenancy/provisioning";

export const clinicSpecSchema = z.object({
  name: z.string().min(2),
  slug: z.string().regex(/^[a-z0-9-]{3,40}$/),
  practiceType: z.enum(["MULTI_SPECIALTY", "SOLO_PRACTICE", "DENTAL", "DIAGNOSTIC", "OTHER"]),
  focusSpecialty: z.string().optional(),
  ownerIsDoctor: z.boolean().default(true),
  ownerFrontDesk: z.boolean().default(true),
  /** The owner is the clinic's (only or leading) doctor: oversight of all records, patient files. */
  ownerHeadDoctor: z.boolean().default(false),
  address: z.string().default(""),
  contactPhone: z.string().default(""),
  planCode: z.string().default("enterprise"),
  /** One service per line, e.g. "EKG 30 ming" (same format as the "price list" box). */
  priceList: z.array(z.string()).default([]),
});
export type ClinicSpec = z.infer<typeof clinicSpecSchema>;

const META: RequestMeta = { ip: "127.0.0.1", userAgent: "itopmed-clinic (server task)", requestId: null };

export async function createClinicFromSpec(specFile: string, ownerEmail: string, ownerName: string, password: string) {
  const spec = clinicSpecSchema.parse(JSON.parse(fs.readFileSync(specFile, "utf8")));
  const admin = await platformDb().platformUser.findFirst({ where: { role: "SUPER_ADMIN", status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
  if (!admin) throw new Error("No active SuperAdmin: create one first (itopmed-admin).");
  const actor: PlatformPrincipal = { sessionId: "server-task", mfaVerified: true, user: { id: admin.id, email: admin.email, fullName: admin.fullName, role: "SUPER_ADMIN", locale: "uz-Latn", mfaEnrolled: true } };

  const created = await createClinicWithOwner(
    actor,
    {
      name: spec.name,
      slug: spec.slug,
      practiceType: spec.practiceType,
      focusSpecialty: spec.focusSpecialty ?? "",
      ownerIsDoctor: spec.ownerIsDoctor,
      ownerFrontDesk: spec.ownerFrontDesk,
      contactEmail: ownerEmail,
      contactPhone: spec.contactPhone,
      address: spec.address,
      taxId: "",
      defaultLocale: "uz-Latn",
      timezone: "Asia/Tashkent",
      planCode: spec.planCode,
      ownerFullName: ownerName,
      ownerEmail,
      ownerMode: "password",
      ownerPassword: password,
    },
    META,
  );
  if (created.owner !== "password") throw new Error("This e-mail already has an ITop Med account; use another e-mail for the owner.");
  // Paid customer: active right away, no trial.
  await changeTenantStatus(actor, created.tenantId, "activate", undefined, META);
  await withPlatform((tx) => tx.subscription.updateMany({ where: { tenantId: created.tenantId }, data: { status: "ACTIVE", trialEndsAt: null } }));

  // Finish the setup in the owner's own context (their audit trail), then sign that session out.
  const login = await loginClinicUser(ownerEmail, password, META);
  if (!login.ok) throw new Error(`Owner sign-in failed: ${login.reason}`);
  try {
    const principal = await validateClinicSession(login.token);
    const ctx = principal && (await resolveClinic(principal, created.slug));
    if (!ctx) throw new Error("Owner context unavailable");
    await applyPendingSetup(ctx, META);
    const again = await resolveClinic(principal!, created.slug); // roles added by the preset
    const prices = spec.priceList.length ? await importPriceList(again!, { text: spec.priceList.join("\n") }, META) : { created: 0, updated: 0, skipped: 0 };
    if (spec.ownerHeadDoctor) {
      await withAppContext({ tenantId: again!.tenant.id, userId: again!.principal.user.id, sessionId: again!.principal.sessionId }, async (tx) => {
        const role = await tx.role.findFirst({ where: { tenantId: again!.tenant.id, key: "head_doctor" }, select: { id: true } });
        if (!role) throw new Error("head_doctor role missing");
        await tx.membershipRole.createMany({ data: [{ tenantId: again!.tenant.id, membershipId: again!.membershipId, roleId: role.id }], skipDuplicates: true });
        await recordAudit(tx, { tenantId: again!.tenant.id, actorType: "USER", actorId: again!.principal.user.id, action: "clinic.owner_clinical_role", entityType: "Membership", entityId: again!.membershipId, metadata: { role: "head_doctor", clinical: true, by: "server-task" } });
      });
    }
    // The clinic's own price list replaces the field's starter catalogue: starter services
    // left without a price would only duplicate it at the front desk (they stay archived, restorable).
    let archived = 0;
    if (spec.priceList.length) {
      for (const sv of await listServices(again!)) {
        if (!sv.priceMinor || sv.priceMinor <= 0n) {
          await setServiceArchived(again!, sv.id, true, META);
          archived++;
        }
      }
    }
    return { slug: created.slug, prices, archived };
  } finally {
    await logoutClinic(login.token);
  }
}
