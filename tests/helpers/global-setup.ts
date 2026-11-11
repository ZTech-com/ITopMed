import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { startEmbeddedDb } from "../../scripts/lib/embedded-db";

function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

/**
 * Boots a throw-away PostgreSQL for the test run, applies the real migrations
 * (including RLS policies and audit triggers) and seeds the plan catalog.
 */
export default async function setup() {
  const port = Number(process.env.TEST_PG_PORT ?? 54339);
  if (await portInUse(port)) {
    throw new Error(
      `Test database port ${port} is already in use — probably a leftover test PostgreSQL from an interrupted run. ` +
        `Stop that process (it is NOT the dev database on 54329) or set TEST_PG_PORT.`,
    );
  }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "itopmed-test-pg-"));
  const db = await startEmbeddedDb({
    dataDir,
    port,
    superuserPassword: "test-super",
    ownerPassword: "test-owner",
    appPassword: "test-app",
    platformPassword: "test-platform",
    persistent: false,
  });
  const env = { ...process.env, MIGRATION_DATABASE_URL: `postgresql://itopmed_owner:test-owner@localhost:${port}/itopmed` };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  execSync("npx tsx prisma/seed.ts", { env, stdio: "pipe" });

  return async () => {
    await db.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  };
}
