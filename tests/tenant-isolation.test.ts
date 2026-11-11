import { describe, expect, it } from "vitest";
import { resolveClinic } from "@/server/auth/clinic-auth";
import { listBranches, listClinicAudit, listStaff } from "@/server/clinic/admin";
import { withAppContext } from "@/server/db";
import { clinicWithOwner, platformActor } from "./helpers/fixtures";

/** Acceptance 12: a user from Clinic A cannot access any data from Clinic B. */
describe("tenant isolation", async () => {
  const actor = await platformActor();
  const a = await clinicWithOwner(actor);
  const b = await clinicWithOwner(actor);

  it("a member of A cannot resolve B's workspace", async () => {
    expect(await resolveClinic(a.ctx.principal, b.slug)).toBeNull();
  });

  it("service-level reads are scoped to the active clinic", async () => {
    const branches = await listBranches(a.ctx);
    expect(branches.every((x) => x.tenantId === a.tenantId)).toBe(true);
    const staff = await listStaff(a.ctx);
    expect(staff.members.every((m) => m.tenantId === a.tenantId)).toBe(true);
    const audit = await listClinicAudit(a.ctx);
    expect(audit.every((e) => e.tenantId === a.tenantId)).toBe(true);
  });

  it("RLS hides B's rows even when queried by id with A's context (IDOR)", async () => {
    const bBranch = (await listBranches(b.ctx))[0]!;
    const ctxA = { tenantId: a.tenantId, userId: a.ctx.principal.user.id };
    const found = await withAppContext(ctxA, (tx) => tx.branch.findUnique({ where: { id: bBranch.id } }));
    expect(found).toBeNull();
    const tenant = await withAppContext(ctxA, (tx) => tx.tenant.findUnique({ where: { id: b.tenantId } }));
    expect(tenant).toBeNull();
    const bOwner = await withAppContext(ctxA, (tx) => tx.user.findUnique({ where: { id: b.ctx.principal.user.id } }));
    expect(bOwner).toBeNull();
  });

  it("RLS rejects writes into another tenant", async () => {
    const ctxA = { tenantId: a.tenantId, userId: a.ctx.principal.user.id };
    await expect(
      withAppContext(ctxA, (tx) =>
        tx.branch.create({ data: { id: crypto.randomUUID(), tenantId: b.tenantId, name: "Injected" } }),
      ),
    ).rejects.toThrow(/row-level security/);
    const bBranch = (await listBranches(b.ctx))[0]!;
    const updated = await withAppContext(ctxA, (tx) => tx.branch.updateMany({ where: { id: bBranch.id }, data: { name: "Hijacked" } }));
    expect(updated.count).toBe(0);
  });

  it("tenant context does not leak between pooled transactions", async () => {
    await withAppContext({ tenantId: a.tenantId }, (tx) => tx.branch.count());
    const n = await withAppContext({}, (tx) => tx.branch.count());
    expect(n).toBe(0);
  });
});
