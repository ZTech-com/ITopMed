-- Waiting-room screen (TV), "next patient" calls, doctor's cabinet.
ALTER TABLE "Appointment" ADD COLUMN "calledAt" TIMESTAMP(3), ADD COLUMN "calledCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DoctorProfile" ADD COLUMN "cabinet" TEXT;
ALTER TABLE "DoctorProfile" ADD CONSTRAINT "DoctorProfile_cabinet_chk" CHECK ("cabinet" IS NULL OR length("cabinet") <= 40);

CREATE TABLE "DisplayScreen" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "branchId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "voice" BOOLEAN NOT NULL DEFAULT true,
  "createdById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "DisplayScreen_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DisplayScreen_name_chk" CHECK (length("name") BETWEEN 1 AND 80),
  CONSTRAINT "DisplayScreen_hash_chk" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "DisplayScreen_tokenHash_key" ON "DisplayScreen"("tokenHash");
CREATE INDEX "DisplayScreen_tenantId_idx" ON "DisplayScreen"("tenantId");
ALTER TABLE "DisplayScreen" ADD CONSTRAINT "DisplayScreen_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DisplayScreen" ADD CONSTRAINT "DisplayScreen_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

REVOKE ALL ON "DisplayScreen" FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON "DisplayScreen" TO itopmed_app;
ALTER TABLE "DisplayScreen" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DisplayScreen" TO itopmed_app
  USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());

-- The screen has no user: its link's secret (hashed by the app) is resolved to
-- its clinic and branch here, and only for screens that were not revoked. The
-- caller then reads the queue inside that clinic's tenant context (RLS applies).
CREATE FUNCTION app_display_lookup(p_hash text)
RETURNS TABLE (tenant_id uuid, branch_id uuid, screen_id uuid, voice boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT s."tenantId", s."branchId", s.id, s.voice
    FROM "DisplayScreen" s
    JOIN "Tenant" t ON t.id = s."tenantId"
   WHERE s."tokenHash" = p_hash AND s."revokedAt" IS NULL AND t.status IN ('TRIAL', 'ACTIVE')
$fn$;
REVOKE ALL ON FUNCTION app_display_lookup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_display_lookup(text) TO itopmed_app;
