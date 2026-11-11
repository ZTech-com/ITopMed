/** Starts a persistent local PostgreSQL for development: `npm run db:start`. */
import "dotenv/config";
import os from "node:os";
import path from "node:path";
import { startEmbeddedDb } from "./lib/embedded-db";

const required = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing ${k} in .env`);
  return v;
};

async function main() {
  // Kept outside the project folder so file-sync tools (OneDrive etc.) never touch it.
  const dataDir = process.env.DEV_PG_DIR ?? path.join(os.homedir(), ".itopmed-dev", "pg");
  const port = Number(process.env.DEV_PG_PORT ?? 54329);
  const db = await startEmbeddedDb({
    dataDir,
    port,
    superuserPassword: required("DEV_PG_SUPERUSER_PASSWORD"),
    ownerPassword: required("DEV_PG_OWNER_PASSWORD"),
    appPassword: required("DEV_PG_APP_PASSWORD"),
    platformPassword: required("DEV_PG_PLATFORM_PASSWORD"),
  });
  console.log(`PostgreSQL (dev) running on localhost:${port}, data: ${dataDir}`);
  console.log("Press Ctrl+C to stop.");
  const stop = async () => {
    await db.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await new Promise(() => {});
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
