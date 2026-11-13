import { withAppContext } from "@/server/db";
import { logger } from "@/server/logger";

/**
 * Liveness/readiness probe for load balancers and uptime monitoring.
 * Public by design: reveals only "ok"/"unavailable" — no versions, hosts,
 * tenants or error details. Checks that the database answers within 2 s
 * using the clinic role without any tenant context (sees no clinic data).
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  let database: "ok" | "unavailable" = "ok";
  try {
    await Promise.race([
      withAppContext({}, (tx) => tx.$queryRaw`SELECT 1`),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 2000)),
    ]);
  } catch (e) {
    database = "unavailable";
    logger.error("health.database_unavailable", { error: e instanceof Error ? e.message.slice(0, 40) : "unknown" });
  }
  const ok = database === "ok";
  return Response.json(
    { status: ok ? "ok" : "unavailable", checks: { database }, latencyMs: Date.now() - started },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
