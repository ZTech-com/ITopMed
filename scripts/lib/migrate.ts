/**
 * Applies prisma/migrations/* with plain `pg` - for the packaged app, which
 * ships without the Prisma CLI. Compatible with `prisma migrate deploy`: same
 * `_prisma_migrations` table, same SHA-256 checksum of migration.sql, same
 * order, each script sent as one simple query (like Prisma). A failed
 * migration stops here and is recorded as unfinished.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

export async function applyMigrations(databaseUrl: string, dir: string, log: (m: string) => void = () => undefined): Promise<number> {
  const c = new pg.Client({ connectionString: databaseUrl });
  await c.connect();
  try {
    await c.query(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" VARCHAR(36) PRIMARY KEY NOT NULL,
      "checksum" VARCHAR(64) NOT NULL,
      "finished_at" TIMESTAMPTZ,
      "migration_name" VARCHAR(255) NOT NULL,
      "logs" TEXT,
      "rolled_back_at" TIMESTAMPTZ,
      "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )`);
    const done = new Set((await c.query(`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`)).rows.map((r) => r.migration_name as string));
    const failed = (await c.query(`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL`)).rows;
    if (failed.length) throw new Error(`A database update did not finish earlier (${failed[0].migration_name}). Restore the latest backup or contact support.`);
    const names = fs.readdirSync(dir).filter((n) => fs.existsSync(path.join(dir, n, "migration.sql"))).sort();
    let applied = 0;
    for (const name of names) {
      if (done.has(name)) continue;
      const sql = fs.readFileSync(path.join(dir, name, "migration.sql"), "utf8");
      const id = crypto.randomUUID();
      const checksum = crypto.createHash("sha256").update(sql).digest("hex");
      await c.query(`INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at) VALUES ($1, $2, $3, now())`, [id, checksum, name]);
      await c.query(sql);
      await c.query(`UPDATE "_prisma_migrations" SET finished_at = now(), applied_steps_count = 1 WHERE id = $1`, [id]);
      log(`Database updated: ${name}`);
      applied++;
    }
    return applied;
  } finally {
    await c.end();
  }
}
