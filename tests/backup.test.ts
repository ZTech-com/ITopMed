import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { backupKey, createBackup, restoreAndVerify } from "../scripts/lib/backup";
import { startEmbeddedDb } from "../scripts/lib/embedded-db";
import { registerPatient } from "@/server/patients/patients";
import { createService } from "@/server/clinic/resources";
import { META, clinicWithOwner, platformActor } from "./helpers/fixtures";

/**
 * Backup → restore drill (acceptance criterion 17): a real backup of the test
 * database is restored into a second, empty PostgreSQL and verified there.
 */
const RESTORE_PORT = Number(process.env.TEST_RESTORE_PG_PORT ?? 54349);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "itopmed-backup-test-"));
const key = randomBytes(32);
let restoreDb: Awaited<ReturnType<typeof startEmbeddedDb>> | null = null;

beforeAll(async () => {
  restoreDb = await startEmbeddedDb({
    dataDir: path.join(dir, "pg"),
    port: RESTORE_PORT,
    superuserPassword: "restore-super",
    ownerPassword: "restore-owner",
    appPassword: "restore-app",
    platformPassword: "restore-platform",
    portalPassword: "restore-portal",
    persistent: false,
    postgresFlags: ["-c", "io_method=sync"],
  });
}, 120_000);

afterAll(async () => {
  await restoreDb?.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("encrypted backup and verified restore", () => {
  it("restores every row exactly, keeps the audit chains intact, and refuses tampered files or wrong keys", async () => {
    // Some real data, plus one value beyond JavaScript's safe-integer range.
    const a = await clinicWithOwner(await platformActor());
    const svc = await createService(a.ctx, { code: "BK1", name: "Synthetic backup service", kind: "CONSULTATION", durationMinutes: 20, price: "125000", currency: "UZS" }, META);
    await registerPatient(a.ctx, { lastName: "Sintetik", firstName: "Zaxira", birthDate: "1980-08-08", sex: "MALE" }, { confirmNotDuplicate: true }, META).catch(() => null);
    const owner = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await owner.connect();
    const bigId = randomUUID();
    await owner.query(`INSERT INTO "Service" (id, "tenantId", code, name, kind, "durationMinutes", "priceMinor", currency, "updatedAt") VALUES ($1, $2, 'BIG', 'Precision probe', 'OTHER', 10, 9007199254740993, 'UZS', now())`, [bigId, a.tenantId]);
    await owner.end();

    const file = path.join(dir, "test.itmbk");
    const result = await createBackup({ databaseUrl: process.env.MIGRATION_DATABASE_URL!, file, key });
    expect(result.bytes).toBeGreaterThan(100);
    expect(fs.readFileSync(file).subarray(0, 8).toString()).toBe("ITMBK001");
    expect(fs.readFileSync(file).includes(Buffer.from("Precision probe"))).toBe(false); // encrypted at rest
    expect(result.manifest.tables.find((t) => t.name === "AuditEvent")!.rows).toBeGreaterThan(0);

    const base = `localhost:${RESTORE_PORT}/itopmed`;
    const report = await restoreAndVerify({
      file,
      key,
      ownerUrl: `postgresql://itopmed_owner:restore-owner@${base}`,
      superuserUrl: `postgresql://postgres:restore-super@${base}`,
      projectDir: process.cwd(),
    });
    expect(report.migrationsMatch).toBe(true);
    expect(report.mismatches).toEqual([]);
    expect(report.rlsMissing).toEqual([]);
    expect(report.auditChains.length).toBeGreaterThan(1);
    expect(report.auditChains.every((c) => c.broken === null)).toBe(true);
    expect(report.auditChains.reduce((n, c) => n + c.checked, 0)).toBeGreaterThan(0);
    expect(report.ok).toBe(true);

    const r = new pg.Client({ connectionString: `postgresql://postgres:restore-super@${base}` });
    await r.connect();
    expect((await r.query(`SELECT "priceMinor"::text AS p FROM "Service" WHERE id = $1`, [bigId])).rows[0].p).toBe("9007199254740993");
    expect((await r.query(`SELECT "priceMinor"::text AS p FROM "Service" WHERE id = $1`, [svc])).rows[0].p).toBe("12500000");
    await r.end();

    // The restored clinic works under the normal runtime role and its RLS.
    const app = new pg.Client({ connectionString: `postgresql://itopmed_app:restore-app@${base}` });
    await app.connect();
    await app.query("BEGIN");
    await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [a.tenantId]);
    expect((await app.query(`SELECT count(*)::int AS n FROM "Service"`)).rows[0].n).toBe(2);
    await app.query("ROLLBACK");
    expect((await app.query(`SELECT count(*)::int AS n FROM "Service"`)).rows[0].n).toBe(0); // no tenant context → nothing
    await app.end();

    // Integrity: any changed byte or a wrong key is rejected before anything is read.
    const tampered = path.join(dir, "tampered.itmbk");
    const bytes = fs.readFileSync(file);
    const mid = Math.floor(bytes.length / 2);
    bytes[mid] = bytes[mid]! ^ 0xff;
    fs.writeFileSync(tampered, bytes);
    const any = { ownerUrl: "postgresql://x@localhost:1/none", superuserUrl: "postgresql://x@localhost:1/none", projectDir: process.cwd() };
    await expect(restoreAndVerify({ file: tampered, key, ...any })).rejects.toThrow(/auth|decipher|Unsupported state/i);
    await expect(restoreAndVerify({ file, key: randomBytes(32), ...any })).rejects.toThrow(/auth|decipher|Unsupported state/i);
    expect(() => backupKey("too-short")).toThrow(/32 bytes/);
  }, 240_000);
});
