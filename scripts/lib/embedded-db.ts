/**
 * Local-only PostgreSQL bootstrap using the `embedded-postgres` binaries.
 * Used for development and automated tests on machines without Docker.
 * Production uses a managed PostgreSQL cluster provisioned by infrastructure.
 */
import EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs";
import pg from "pg";

export interface EmbeddedDbOptions {
  dataDir: string;
  port: number;
  superuserPassword: string;
  ownerPassword: string;
  appPassword: string;
  platformPassword: string;
  database?: string;
  persistent?: boolean;
  /** Extra server settings, e.g. ["-c", "io_method=sync"]. */
  postgresFlags?: string[];
}

export async function startEmbeddedDb(o: EmbeddedDbOptions) {
  const database = o.database ?? "itopmed";
  const fresh = !fs.existsSync(`${o.dataDir}/PG_VERSION`);
  const server = new EmbeddedPostgres({
    databaseDir: o.dataDir,
    user: "postgres",
    password: o.superuserPassword,
    port: o.port,
    persistent: o.persistent ?? true,
    // Always UTF-8: the platform stores Uzbek (Latin/Cyrillic) and Russian text.
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    postgresFlags: o.postgresFlags ?? [],
    onLog: () => {},
  });
  if (fresh) await server.initialise();
  await server.start();

  const admin = new pg.Client({
    host: "localhost",
    port: o.port,
    user: "postgres",
    password: o.superuserPassword,
    database: "postgres",
  });
  await admin.connect();
  try {
    await ensureRole(admin, "itopmed_owner", o.ownerPassword, "LOGIN CREATEDB NOBYPASSRLS");
    await ensureRole(admin, "itopmed_app", o.appPassword, "LOGIN NOBYPASSRLS");
    await ensureRole(admin, "itopmed_platform", o.platformPassword, "LOGIN NOBYPASSRLS");
    const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
    if (exists.rowCount === 0) {
      await admin.query(`CREATE DATABASE "${database}" OWNER itopmed_owner ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`);
    }
    const enc = await admin.query("SELECT pg_encoding_to_char(encoding) AS e FROM pg_database WHERE datname = $1", [database]);
    if (enc.rows[0]?.e !== "UTF8") throw new Error(`Database ${database} is not UTF8 (${enc.rows[0]?.e}). Drop it and restart.`);
    await admin.query(`REVOKE ALL ON DATABASE "${database}" FROM PUBLIC`);
    await admin.query(`GRANT CONNECT ON DATABASE "${database}" TO itopmed_app, itopmed_platform`);
  } finally {
    await admin.end();
  }
  return { server, stop: () => server.stop() };
}

async function ensureRole(client: pg.Client, name: string, password: string, attrs: string) {
  const r = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [name]);
  const verb = r.rowCount === 0 ? "CREATE" : "ALTER";
  // Role names are constants; the password is escaped as a literal.
  const lit = client.escapeLiteral(password);
  await client.query(`${verb} ROLE ${name} WITH ${attrs} PASSWORD ${lit}`);
}
