import { describe, expect, it } from "vitest";
import type { PlatformPrincipal } from "@/server/auth/platform-auth";
import { applyPendingSetup } from "@/server/clinic/practice";
import { listServices } from "@/server/clinic/resources";
import { listTemplates } from "@/server/clinic/templates";
import { platformDb } from "@/server/db";
import { createNetwork, listNetworks, setTenantNetwork } from "@/server/platform/networks";
import { createPlatformAccount } from "@/server/platform/staff";
import { uuidv7 } from "@/server/security/crypto";
import { suggestPassword } from "@/server/security/password";
import { changeTenantStatus, createClinicWithOwner, getTenantDetail, listTenants, platformOverview } from "@/server/tenancy/provisioning";
import { META, PASSWORD, clinicContext, clinicWithOwner, platformActor, uniq } from "./helpers/fixtures";

function clinicForm(extra: Record<string, string> = {}) {
  const slug = uniq("kardio");
  return {
    slug,
    raw: {
      name: `Synthetic Cardio ${slug}`,
      slug,
      contactEmail: `info@${slug}.test`,
      defaultLocale: "uz-Latn",
      timezone: "Asia/Tashkent",
      planCode: "enterprise",
      ownerFullName: "Synthetic Cardiologist",
      ownerEmail: `${uniq("owner")}@clinic.test`,
      taxId: "",
      contactPhone: "",
      practiceType: "SOLO_PRACTICE",
      focusSpecialty: "cardiology",
      ownerIsDoctor: "on",
      ownerFrontDesk: "on",
      ownerMode: "password",
      ownerPassword: PASSWORD,
      ...extra,
    },
  };
}

/** A network admin as it looks after password + MFA sign-in (synthetic). */
async function networkAdmin(networkId: string): Promise<PlatformPrincipal> {
  const id = uuidv7();
  const email = `${uniq("netadmin")}@itopmed.test`;
  await platformDb().platformUser.create({ data: { id, email, fullName: "Synthetic Network Admin", role: "NETWORK_ADMIN", networkId, status: "ACTIVE" } });
  return { sessionId: "test", mfaVerified: true, user: { id, email, fullName: "Synthetic Network Admin", role: "NETWORK_ADMIN", locale: "en", mfaEnrolled: true, networkId } };
}

describe("clinic created ready for its field", () => {
  it("owner account with the admin's password; cardiology office finished on the owner's first visit", async () => {
    const admin = await platformActor();
    const { slug, raw } = clinicForm();
    const r = await createClinicWithOwner(admin, raw, META);
    expect(r.owner).toBe("password");

    const before = await platformDb().tenant.findUniqueOrThrow({ where: { id: r.tenantId }, include: { modules: true } });
    expect(before.practiceType).toBe("SOLO_PRACTICE");
    expect(before.modules.find((m) => m.moduleKey === "dental")?.enabled).toBe(false); // solo office stays simple
    expect(before.modules.find((m) => m.moduleKey === "laboratory")?.enabled).toBe(false);

    // The owner signs in with exactly the password the admin set.
    const ctx = await clinicContext(raw.ownerEmail, slug);
    expect(await applyPendingSetup(ctx, META)).toBe(true);
    expect(await applyPendingSetup(ctx, META)).toBe(false); // once

    const fresh = await clinicContext(raw.ownerEmail, slug);
    expect(fresh.roleKeys).toEqual(expect.arrayContaining(["clinic_owner", "doctor", "receptionist", "cashier"]));
    const codes = (await listServices(fresh)).map((s) => s.code);
    expect(codes).toEqual(expect.arrayContaining(["CARD-CONSULT", "ECG", "CARD-ECHO", "CARD-HOLTER"]));
    expect((await listTemplates(fresh)).length).toBe(6);
  });

  it("an email that already has an account keeps its own password (invitation instead)", async () => {
    const admin = await platformActor();
    const first = clinicForm();
    await createClinicWithOwner(admin, first.raw, META);
    const second = clinicForm({ ownerEmail: first.raw.ownerEmail, ownerPassword: "Other-Passw0rd-123" });
    const r = await createClinicWithOwner(admin, second.raw, META);
    expect(r.owner).toBe("existing_account");
    await expect(clinicContext(first.raw.ownerEmail, first.slug)).resolves.toBeTruthy(); // old password still works
  });

  it("weak owner passwords are refused before anything is created", async () => {
    const admin = await platformActor();
    const { slug, raw } = clinicForm({ ownerPassword: "short1" });
    await expect(createClinicWithOwner(admin, raw, META)).rejects.toThrow();
    expect(await platformDb().tenant.findUnique({ where: { slug } })).toBeNull();
  });

  it("suggested passwords meet the policy", () => {
    for (let i = 0; i < 20; i++) expect(suggestPassword()).toMatch(/^([a-zA-Z]{3}[2-9]-){3}[a-zA-Z]{3}[2-9]$/);
  });
});

describe("networks and network admins", () => {
  it("a network admin sees and manages only their network's clinics", async () => {
    const admin = await platformActor();
    const networkId = await createNetwork(admin, { name: `Synthetic Network ${uniq("n")}` }, META);
    const inside = await clinicWithOwner(admin);
    const outside = await clinicWithOwner(admin);
    await setTenantNetwork(admin, inside.tenantId, networkId, META);

    const na = await networkAdmin(networkId);
    const ids = (await listTenants(na)).map((t) => t.id);
    expect(ids).toContain(inside.tenantId);
    expect(ids).not.toContain(outside.tenantId);
    expect(await getTenantDetail(na, outside.tenantId)).toBeNull();
    await expect(changeTenantStatus(na, outside.tenantId, "suspend", "Synthetic reason", META)).rejects.toThrow("errors.notFound");
    await changeTenantStatus(na, inside.tenantId, "suspend", "Synthetic reason", META);
    expect((await platformOverview(na)).counts.SUSPENDED).toBe(1);

    // Clinics a network admin creates always land in their network, whatever the form says.
    const { raw } = clinicForm({ networkId: uuidv7() });
    const r = await createClinicWithOwner(na, raw, META);
    expect((await platformDb().tenant.findUniqueOrThrow({ where: { id: r.tenantId } })).networkId).toBe(networkId);

    // No network management, no staff management.
    await expect(listNetworks(na)).rejects.toThrow("errors.forbidden");
    await expect(createPlatformAccount(na, { email: `${uniq("x")}@itopmed.test`, fullName: "X Y", role: "SUPPORT" }, META)).rejects.toThrow("errors.forbidden");
  });

  it("the super admin appoints a network admin with a password; the role requires a network", async () => {
    const admin = await platformActor();
    const networkId = await createNetwork(admin, { name: `Synthetic Network ${uniq("n")}` }, META);
    const email = `${uniq("netadmin")}@itopmed.test`;
    const r = await createPlatformAccount(admin, { email, fullName: "Synthetic Franchise Owner", role: "NETWORK_ADMIN", networkId, ownerMode: "password", password: PASSWORD }, META);
    expect(r.mode).toBe("password");
    const u = await platformDb().platformUser.findUniqueOrThrow({ where: { email } });
    expect(u.role).toBe("NETWORK_ADMIN");
    expect(u.networkId).toBe(networkId);
    await expect(createPlatformAccount(admin, { email: `${uniq("n2")}@itopmed.test`, fullName: "No Network", role: "NETWORK_ADMIN", ownerMode: "password", password: PASSWORD }, META)).rejects.toThrow();
    await expect(createPlatformAccount(admin, { email: `${uniq("n3")}@itopmed.test`, fullName: "Support With Network", role: "SUPPORT", networkId }, META)).rejects.toThrow();
  });

  it("the Network table is closed to clinics", async () => {
    const admin = await platformActor();
    const c = await clinicWithOwner(admin);
    const { withAppContext } = await import("@/server/db");
    await expect(withAppContext({ tenantId: c.tenantId, userId: c.ctx.principal.user.id }, (tx) => tx.$queryRawUnsafe(`SELECT count(*) FROM "Network"`))).rejects.toThrow(/permission denied/);
  });
});
