/**
 * Encrypted logical backup of the database (schema owner connection).
 *   npm run backup                      → backups/itopmed-<timestamp>.itmbk
 *   npm run backup -- --out <file>
 * Needs MIGRATION_DATABASE_URL and BACKUP_ENCRYPTION_KEY (32 bytes, base64; keep it
 * in the secret manager, NOT next to the backups). Prints only non-sensitive facts.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { backupKey, createBackup } from "./lib/backup";

async function main() {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL is required");
  const key = backupKey(process.env.BACKUP_ENCRYPTION_KEY);
  const i = process.argv.indexOf("--out");
  const file = i > 0 ? process.argv[i + 1]! : path.join(process.cwd(), "backups", `itopmed-${new Date().toISOString().replace(/[:.]/g, "-")}.itmbk`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const r = await createBackup({ databaseUrl: url, file, key });
  const rows = r.manifest.tables.reduce((n, t) => n + t.rows, 0);
  console.log(JSON.stringify({ file, bytes: r.bytes, sha256: r.sha256, tables: r.manifest.tables.length, rows, migrations: r.manifest.migrations.length }, null, 2));
}

main().catch((e) => {
  console.error("Backup failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
