/**
 * Background worker: delivers due patient notifications for every active clinic.
 *   npm run worker            (loops every 60 s; Ctrl+C to stop)
 *   npm run worker -- --once  (one pass, e.g. from cron)
 *
 * Clinic ids come from the platform role (tenant list only); delivery runs as
 * the clinic role inside each clinic's tenant context, so RLS still applies.
 */
import "dotenv/config";
import { disconnectAll, platformDb } from "../src/server/db";
import { logger } from "../src/server/logger";
import { processDueNotifications } from "../src/server/notifications/notifications";

const INTERVAL_MS = 60_000;

async function pass() {
  const tenants = await platformDb().tenant.findMany({ where: { status: { in: ["TRIAL", "ACTIVE"] } }, select: { id: true } });
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const t of tenants) {
    try {
      const r = await processDueNotifications(t.id);
      sent += r.sent;
      failed += r.failed;
      skipped += r.skipped;
    } catch (e) {
      logger.error("worker.tenant_failed", { tenantId: t.id, error: e instanceof Error ? e.name : "unknown" });
    }
  }
  logger.info("worker.pass", { tenants: tenants.length, sent, failed, skipped });
}

async function main() {
  const once = process.argv.includes("--once");
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  do {
    await pass();
    if (once) break;
    for (let waited = 0; waited < INTERVAL_MS && !stopping; waited += 1000) await new Promise((r) => setTimeout(r, 1000));
  } while (!stopping);
  await disconnectAll();
}

main().catch((e) => {
  logger.error("worker.crashed", { error: e instanceof Error ? e.name : "unknown" });
  process.exit(1);
});
