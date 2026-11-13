-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "windowEndAt" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "RateLimitBucket_windowEndAt_idx" ON "RateLimitBucket"("windowEndAt");

-- ============================================================================
-- Phase 9: shared rate limiting (works across app instances, no Redis needed)
-- ============================================================================
ALTER TABLE "RateLimitBucket" SET UNLOGGED;
ALTER TABLE "RateLimitBucket" ADD CONSTRAINT "RateLimitBucket_key_chk" CHECK ("key" ~ '^[0-9a-f]{64}$');
ALTER TABLE "RateLimitBucket" ENABLE ROW LEVEL SECURITY; -- no policies: only the function below touches it
REVOKE ALL ON "RateLimitBucket" FROM PUBLIC;

-- Atomic fixed-window hit: returns the number of hits in the current window.
CREATE FUNCTION rate_limit_hit(p_key text, p_window_ms int) RETURNS int
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
  INSERT INTO "RateLimitBucket" ("key", "windowEndAt", "count")
  VALUES (p_key, (now() AT TIME ZONE 'UTC') + make_interval(secs => p_window_ms / 1000.0), 1)
  ON CONFLICT ("key") DO UPDATE SET
    "count" = CASE WHEN "RateLimitBucket"."windowEndAt" <= (now() AT TIME ZONE 'UTC') THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
    "windowEndAt" = CASE WHEN "RateLimitBucket"."windowEndAt" <= (now() AT TIME ZONE 'UTC')
                         THEN (now() AT TIME ZONE 'UTC') + make_interval(secs => p_window_ms / 1000.0)
                         ELSE "RateLimitBucket"."windowEndAt" END
  RETURNING "count"
$fn$;
-- Housekeeping (called by the worker).
CREATE FUNCTION rate_limit_sweep() RETURNS int
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
  WITH d AS (DELETE FROM "RateLimitBucket" WHERE "windowEndAt" <= (now() AT TIME ZONE 'UTC') RETURNING 1) SELECT count(*)::int FROM d
$fn$;
REVOKE ALL ON FUNCTION rate_limit_hit(text, int), rate_limit_sweep() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rate_limit_hit(text, int) TO itopmed_app, itopmed_platform, itopmed_portal;
GRANT EXECUTE ON FUNCTION rate_limit_sweep() TO itopmed_platform;
