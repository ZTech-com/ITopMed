/**
 * Encrypted logical backups and verified restores — no pg_dump required.
 *
 * Backup: one REPEATABLE READ READ ONLY transaction (consistent snapshot) as
 * the schema owner; every table's rows are read through a server-side cursor
 * as JSON text, gzip-compressed and encrypted with AES-256-GCM
 * (BACKUP_ENCRYPTION_KEY, separate from the application keys).
 *
 * File: "ITMBK001" | 12-byte IV | ciphertext | 16-byte GCM tag.
 * Plaintext (gzip): line 1 = manifest (JSON); then one line per batch:
 * "<table>" TAB "<JSON array of rows>". Rows stay JSON text end to end (never
 * parsed in Node), so bigint money amounts and numeric values keep full precision.
 *
 * Restore: the schema (tables, RLS, grants, triggers, functions) comes from the
 * project's own migrations; rows are then loaded with triggers paused
 * (session_replication_role = replica, superuser only) exactly as stored, so the
 * tamper-evident audit chain is reproduced byte for byte and re-verified.
 * Production databases additionally rely on the managed service's
 * point-in-time recovery (see docs/DEPLOYMENT.md).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import readline from "node:readline";
import { Readable } from "node:stream";
import { createGunzip, gzipSync } from "node:zlib";
import pg from "pg";

const MAGIC = Buffer.from("ITMBK001");
const BATCH = 1000;
const TAB = "\t";
const NL = "\n";
/** Transient tables that are not backed up. */
const SKIP = new Set(["_prisma_migrations", "RateLimitBucket"]);

export interface Manifest {
  format: "itopmed-backup";
  version: 1;
  createdAt: string;
  migrations: string[];
  tables: { name: string; rows: number }[];
}

export function backupKey(raw: string | undefined): Buffer {
  const key = Buffer.from(raw ?? "", "base64");
  if (key.length !== 32) throw new Error("BACKUP_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return key;
}

/** Tables in foreign-key order (parents first). */
async function tablesInOrder(c: pg.Client): Promise<string[]> {
  const tables = (
    await c.query(`SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 1`)
  ).rows
    .map((r) => r.name as string)
    .filter((t) => !SKIP.has(t));
  const deps = (
    await c.query(
      `SELECT src.relname AS child, dst.relname AS parent FROM pg_constraint k
         JOIN pg_class src ON src.oid = k.conrelid JOIN pg_class dst ON dst.oid = k.confrelid
         JOIN pg_namespace n ON n.oid = src.relnamespace
        WHERE k.contype = 'f' AND n.nspname = 'public' AND src.relname <> dst.relname`,
    )
  ).rows as { child: string; parent: string }[];
  const ordered: string[] = [];
  const pending = new Set(tables);
  while (pending.size > 0) {
    const ready = [...pending].filter((t) => deps.every((d) => d.child !== t || !pending.has(d.parent)));
    if (ready.length === 0) throw new Error("Cyclic foreign keys between tables: " + [...pending].join(", "));
    for (const t of ready.sort()) {
      ordered.push(t);
      pending.delete(t);
    }
  }
  return ordered;
}

export interface BackupResult {
  manifest: Manifest;
  bytes: number;
  sha256: string;
}

/** Writes an encrypted backup of the database at `databaseUrl` (schema owner). */
export async function createBackup(opts: { databaseUrl: string; file: string; key: Buffer }): Promise<BackupResult> {
  const c = new pg.Client({ connectionString: opts.databaseUrl });
  await c.connect();
  const parts: string[] = [];
  let manifest: Manifest;
  try {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const migrations = (await c.query(`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name`)).rows.map((r) => r.migration_name as string);
    const order = await tablesInOrder(c);
    const tables: Manifest["tables"] = [];
    for (const t of order) tables.push({ name: t, rows: Number((await c.query(`SELECT count(*)::bigint AS n FROM "${t}"`)).rows[0].n) });
    manifest = { format: "itopmed-backup", version: 1, createdAt: new Date().toISOString(), migrations, tables };
    parts.push(JSON.stringify(manifest) + NL);
    for (const t of order) {
      // ::text keeps each row as exact JSON text (node-pg would otherwise parse it).
      await c.query(`DECLARE cur NO SCROLL CURSOR FOR SELECT row_to_json(x)::text AS r FROM "${t}" x`);
      for (;;) {
        const rows = (await c.query(`FETCH ${BATCH} FROM cur`)).rows.map((r) => r.r as string);
        if (rows.length === 0) break;
        parts.push(t + TAB + "[" + rows.join(",") + "]" + NL);
      }
      await c.query("CLOSE cur");
    }
    await c.query("COMMIT");
  } finally {
    await c.end();
  }
  // Clinic databases are small enough to compress in memory; streaming is a later optimisation.
  const plain = gzipSync(Buffer.from(parts.join(""), "utf8"), { level: 6 });
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", opts.key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  const file = Buffer.concat([MAGIC, iv, body, cipher.getAuthTag()]);
  fs.writeFileSync(opts.file, file, { mode: 0o600 });
  return { manifest: manifest!, bytes: file.length, sha256: createHash("sha256").update(file).digest("hex") };
}

/** Decrypted lines of a backup file. The whole file is authenticated (GCM) before anything is parsed. */
async function* readBackup(file: string, key: Buffer): AsyncGenerator<string> {
  const buf = fs.readFileSync(file);
  if (buf.length < 36 || !buf.subarray(0, 8).equals(MAGIC)) throw new Error("Not an ITop Med backup file");
  const decipher = createDecipheriv("aes-256-gcm", key, buf.subarray(8, 20));
  decipher.setAuthTag(buf.subarray(buf.length - 16));
  const gz = Buffer.concat([decipher.update(buf.subarray(20, buf.length - 16)), decipher.final()]);
  const rl = readline.createInterface({ input: Readable.from([gz]).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of rl) if (line) yield line;
}

export interface RestoreReport {
  manifest: Manifest;
  migrationsMatch: boolean;
  mismatches: string[];
  auditChains: { tenantId: string | null; checked: number; broken: number | null }[];
  rlsMissing: string[];
  ok: boolean;
}

/**
 * Restores into an EMPTY database: applies the project's migrations as the
 * schema owner, loads rows as a superuser with triggers paused, resets
 * sequences, then verifies migrations, row counts, audit chains and RLS.
 */
export async function restoreAndVerify(opts: { file: string; key: Buffer; ownerUrl: string; superuserUrl: string; projectDir: string }): Promise<RestoreReport> {
  const it = readBackup(opts.file, opts.key);
  const first = await it.next();
  const manifest = (first.value ? JSON.parse(first.value) : null) as Manifest;
  if (manifest?.format !== "itopmed-backup") throw new Error("Missing backup manifest");

  execSync("npx prisma migrate deploy", { cwd: opts.projectDir, env: { ...process.env, MIGRATION_DATABASE_URL: opts.ownerUrl }, stdio: "pipe" });

  const su = new pg.Client({ connectionString: opts.superuserUrl });
  await su.connect();
  try {
    const applied = (await su.query(`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name`)).rows.map((r) => r.migration_name as string);
    const migrationsMatch = JSON.stringify(applied) === JSON.stringify(manifest.migrations);

    const order = manifest.tables.map((t) => t.name);
    await su.query("BEGIN");
    await su.query("SET LOCAL session_replication_role = replica"); // pause triggers and FK checks while loading
    // Data migrations may have written rows into the fresh schema; the backup is the source of truth.
    await su.query(`TRUNCATE ${order.map((t) => `"${t}"`).join(", ")}`);
    for await (const line of it) {
      const tab = line.indexOf(TAB);
      const t = line.slice(0, tab);
      if (!order.includes(t)) throw new Error(`Unexpected table in backup: ${t}`);
      // The server casts the JSON text to each column's exact type.
      await su.query(`INSERT INTO "${t}" SELECT * FROM json_populate_recordset(NULL::"${t}", $1::json)`, [line.slice(tab + 1)]);
    }
    // Sequences (e.g. the audit sequence) continue after the restored maximum.
    const seqs = (
      await su.query(
        `SELECT s.relname AS seq, t.relname AS tbl, a.attname AS col FROM pg_class s
           JOIN pg_depend d ON d.objid = s.oid AND d.deptype = 'a'
           JOIN pg_class t ON t.oid = d.refobjid
           JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
          WHERE s.relkind = 'S'`,
      )
    ).rows;
    for (const s of seqs) await su.query(`SELECT setval('"${s.seq}"', GREATEST((SELECT COALESCE(max("${s.col}"), 0) FROM "${s.tbl}"), 1))`);
    await su.query("COMMIT");

    const mismatches: string[] = [];
    for (const t of manifest.tables) {
      const n = Number((await su.query(`SELECT count(*)::bigint AS n FROM "${t.name}"`)).rows[0].n);
      if (n !== t.rows) mismatches.push(`${t.name}: expected ${t.rows}, restored ${n}`);
    }
    const tenants = (await su.query(`SELECT id FROM "Tenant" ORDER BY id`)).rows.map((r) => r.id as string);
    const auditChains: RestoreReport["auditChains"] = [];
    for (const tenantId of [null, ...tenants]) {
      const r = (await su.query(`SELECT * FROM audit_verify_chain($1::uuid)`, [tenantId])).rows[0];
      auditChains.push({ tenantId, checked: Number(r.checked), broken: r.first_broken_seq === null ? null : Number(r.first_broken_seq) });
    }
    const rlsMissing = (
      await su.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations' AND NOT c.relrowsecurity`)
    ).rows.map((r) => r.relname as string);
    const ok = migrationsMatch && mismatches.length === 0 && auditChains.every((a) => a.broken === null) && rlsMissing.length === 0;
    return { manifest, migrationsMatch, mismatches, auditChains, rlsMissing, ok };
  } catch (e) {
    await su.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await su.end();
  }
}
