/**
 * Restore drill: restores a backup into a throw-away PostgreSQL and verifies it
 * (migrations, row counts, audit hash chains, RLS). Exit code 0 = restorable.
 *   npm run backup:verify -- <file.itmbk>
 *
 * To restore into a real, EMPTY database instead (e.g. disaster recovery):
 *   npm run backup:verify -- <file> --target-owner-url <url> --target-superuser-url <url>
 * Needs BACKUP_ENCRYPTION_KEY. Prints counts and chain results only — never data.
 */
import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { backupKey, restoreAndVerify } from "./lib/backup";
import { startEmbeddedDb } from "./lib/embedded-db";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--") && !process.argv[process.argv.indexOf(a) - 1]?.startsWith("--target"));
  if (!file || !fs.existsSync(file)) throw new Error("Usage: npm run backup:verify -- <file.itmbk>");
  const key = backupKey(process.env.BACKUP_ENCRYPTION_KEY);
  const ownerUrl = arg("--target-owner-url");
  const superuserUrl = arg("--target-superuser-url");

  let stop: (() => Promise<void>) | null = null;
  let dir: string | null = null;
  let target: { ownerUrl: string; superuserUrl: string };
  if (ownerUrl && superuserUrl) {
    target = { ownerUrl, superuserUrl };
  } else {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "itopmed-restore-"));
    const port = Number(process.env.RESTORE_PG_PORT ?? 54359);
    const pw = (s: string) => `drill-${s}-${Math.random().toString(36).slice(2)}`;
    const p = { superuser: pw("su"), owner: pw("owner") };
    const db = await startEmbeddedDb({
      dataDir: path.join(dir, "pg"),
      port,
      superuserPassword: p.superuser,
      ownerPassword: p.owner,
      appPassword: pw("app"),
      platformPassword: pw("platform"),
      portalPassword: pw("portal"),
      persistent: false,
      postgresFlags: ["-c", "io_method=sync"],
    });
    stop = db.stop;
    target = { ownerUrl: `postgresql://itopmed_owner:${p.owner}@localhost:${port}/itopmed`, superuserUrl: `postgresql://postgres:${p.superuser}@localhost:${port}/itopmed` };
  }
  try {
    const r = await restoreAndVerify({ file, key, projectDir: process.cwd(), ...target });
    console.log(
      JSON.stringify(
        {
          ok: r.ok,
          backupCreatedAt: r.manifest.createdAt,
          migrationsMatch: r.migrationsMatch,
          tables: r.manifest.tables.length,
          rows: r.manifest.tables.reduce((n, t) => n + t.rows, 0),
          countMismatches: r.mismatches,
          auditChains: r.auditChains.length,
          auditEventsVerified: r.auditChains.reduce((n, c) => n + c.checked, 0),
          brokenChains: r.auditChains.filter((c) => c.broken !== null).length,
          tablesWithoutRls: r.rlsMissing,
        },
        null,
        2,
      ),
    );
    if (!r.ok) process.exitCode = 2;
  } finally {
    await stop?.();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error("Restore failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
