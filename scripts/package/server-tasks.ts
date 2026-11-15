/**
 * Server maintenance tasks for the Linux release (bundled as app/tasks.mjs):
 *   node tasks.mjs db-init   create the database cluster and roles once (then stops it)
 *   node tasks.mjs migrate   apply migrations + plan catalog (idempotent)
 *   node tasks.mjs backup    encrypted backup into ITM_BACKUP_DIR, keep the latest 14
 * Settings come from the service environment (/etc/itopmed/itopmed.env).
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { createBackup, backupKey } from "../lib/backup";
import { startEmbeddedDb } from "../lib/embedded-db";
import { applyMigrations } from "../lib/migrate";
import { seedPlans } from "../lib/seed-plans";

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing ${k}`);
  return v;
};
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

async function main() {
  const task = process.argv[2];
  if (task === "db-init") {
    const db = await startEmbeddedDb({
      dataDir: path.join(need("ITM_HOME"), "pg"),
      port: Number(process.env.DEV_PG_PORT ?? 54329),
      superuserPassword: need("DEV_PG_SUPERUSER_PASSWORD"),
      ownerPassword: need("DEV_PG_OWNER_PASSWORD"),
      appPassword: need("DEV_PG_APP_PASSWORD"),
      platformPassword: need("DEV_PG_PLATFORM_PASSWORD"),
      portalPassword: need("DEV_PG_PORTAL_PASSWORD"),
      postgresFlags: ["-c", "io_method=sync"],
    });
    await db.stop();
    console.log("Database initialised.");
  } else if (task === "migrate") {
    const n = await applyMigrations(need("MIGRATION_DATABASE_URL"), path.join(here, "migrations"), (m) => console.log(m));
    console.log(`Plans: ${await seedPlans(need("MIGRATION_DATABASE_URL"))}`);
    console.log(`Migrations applied: ${n}.`);
  } else if (task === "backup") {
    const dir = need("ITM_BACKUP_DIR");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `itopmed-${new Date().toISOString().replace(/[:.]/g, "-")}.itmbk`);
    const r = await createBackup({ databaseUrl: need("MIGRATION_DATABASE_URL"), file, key: backupKey(process.env.BACKUP_ENCRYPTION_KEY) });
    const all = fs.readdirSync(dir).filter((n) => n.endsWith(".itmbk")).sort();
    for (const old of all.slice(0, Math.max(0, all.length - 14))) fs.rmSync(path.join(dir, old), { force: true });
    console.log(`Backup saved: ${file} (${JSON.stringify(r).length} B manifest)`);
  } else if (task === "check-db") {
    const c = new pg.Client({ connectionString: need("MIGRATION_DATABASE_URL") });
    await c.connect();
    console.log((await c.query("select version()")).rows[0].version);
    await c.end();
  } else {
    throw new Error("Usage: tasks.mjs db-init | migrate | backup | check-db");
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
