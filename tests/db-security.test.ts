import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Database-level guarantees, tested directly against PostgreSQL with each
 * runtime role. These hold even if application code has a bug.
 */
const port = process.env.TEST_PG_PORT ?? "54339";
const connect = async (user: string, password: string) => {
  const c = new pg.Client({ host: "localhost", port: Number(port), user, password, database: "itopmed" });
  await c.connect();
  return c;
};

describe("database security", async () => {
  const owner = await connect("itopmed_owner", "test-owner");
  const app = await connect("itopmed_app", "test-app");
  const platform = await connect("itopmed_platform", "test-platform");
  afterAll(async () => {
    await Promise.all([owner.end(), app.end(), platform.end()]);
  });

  it("enables Row-Level Security on every application table", async () => {
    const r = await owner.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations' AND NOT c.relrowsecurity`,
    );
    expect(r.rows.map((x) => x.relname)).toEqual([]);
  });

  it("runtime roles cannot bypass RLS", async () => {
    const r = await owner.query(`SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname IN ('itopmed_app','itopmed_platform','itopmed_portal')`);
    for (const row of r.rows) {
      expect(row.rolbypassrls).toBe(false);
      expect(row.rolsuper).toBe(false);
    }
  });

  it("clinic role cannot read platform staff or platform sessions", async () => {
    await expect(app.query(`SELECT * FROM "PlatformUser"`)).rejects.toThrow(/permission denied/);
    await expect(app.query(`SELECT * FROM "PlatformSession"`)).rejects.toThrow(/permission denied/);
  });

  it("platform role cannot read clinic password hashes, MFA secrets or sessions", async () => {
    await expect(platform.query(`SELECT "passwordHash" FROM "User"`)).rejects.toThrow(/permission denied/);
    await expect(platform.query(`SELECT "mfaSecretEnc" FROM "User"`)).rejects.toThrow(/permission denied/);
    await expect(platform.query(`SELECT * FROM "Session"`)).rejects.toThrow(/permission denied/);
  });

  it("platform role cannot approve its own support-access requests", async () => {
    await expect(platform.query(`UPDATE "SupportAccessGrant" SET status = 'APPROVED'`)).rejects.toThrow(/permission denied/);
  });

  it("clinic role sees no tenant rows without a tenant context", async () => {
    const r = await app.query(`SELECT count(*)::int AS n FROM "Branch"`);
    expect(r.rows[0].n).toBe(0);
    const t = await app.query(`SELECT count(*)::int AS n FROM "Tenant"`);
    expect(t.rows[0].n).toBe(0);
  });

  it("audit trail is append-only for every role, including the schema owner", async () => {
    await platform.query(
      `INSERT INTO "AuditEvent" (id, "actorType", action) VALUES (gen_random_uuid(), 'SYSTEM', 'test.event')`,
    );
    await expect(owner.query(`UPDATE "AuditEvent" SET action = 'tampered'`)).rejects.toThrow(/append-only/);
    await expect(owner.query(`DELETE FROM "AuditEvent"`)).rejects.toThrow(/append-only/);
    await expect(owner.query(`TRUNCATE "AuditEvent"`)).rejects.toThrow(/append-only/);
    await expect(app.query(`UPDATE "AuditEvent" SET action = 'x'`)).rejects.toThrow(/permission denied/);
  });

  it("audit hash chain verifies", async () => {
    const r = await platform.query(`SELECT * FROM audit_verify_chain(NULL)`);
    expect(Number(r.rows[0].checked)).toBeGreaterThan(0);
    expect(r.rows[0].first_broken_seq).toBeNull();
  });
});
