-- ============================================================================
-- ITop Med's own billing of clinics (subscriptions), recorded by the SuperAdmin:
--   * a monthly invoice per active clinic from its plan price (idempotent);
--   * payments entered by hand (cash, bank transfer, ...);
--   * debt = invoices (not voided) - payments; overdue = the oldest unpaid
--     invoice is past its due date; after `suspendAfterDays` the clinic is
--     suspended automatically (the SuperAdmin reactivates it).
-- Also: activity figures per clinic for the console - COUNTS ONLY, computed in
-- the database, so the platform role still never reads clinical rows.
-- ============================================================================

CREATE TYPE "PlatformPaymentMethod" AS ENUM ('CASH', 'TRANSFER', 'CARD', 'OTHER');

CREATE TABLE "ClinicInvoice" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'UZS',
    "dueDate" DATE NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClinicInvoice_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ClinicInvoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ClinicInvoice_amount_chk" CHECK ("amountMinor" >= 0),
    CONSTRAINT "ClinicInvoice_period_chk" CHECK ("periodEnd" >= "periodStart")
);
CREATE UNIQUE INDEX "ClinicInvoice_number_key" ON "ClinicInvoice"("number");
CREATE UNIQUE INDEX "ClinicInvoice_tenantId_periodStart_key" ON "ClinicInvoice"("tenantId", "periodStart");
CREATE INDEX "ClinicInvoice_tenantId_idx" ON "ClinicInvoice"("tenantId");

CREATE TABLE "ClinicPayment" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'UZS',
    "method" "PlatformPaymentMethod" NOT NULL,
    "receivedOn" DATE NOT NULL,
    "note" TEXT,
    "recordedById" UUID NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClinicPayment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ClinicPayment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ClinicPayment_amount_chk" CHECK ("amountMinor" > 0),
    CONSTRAINT "ClinicPayment_note_chk" CHECK ("note" IS NULL OR length("note") <= 200)
);
CREATE INDEX "ClinicPayment_tenantId_idx" ON "ClinicPayment"("tenantId");

-- One row: when invoices fall due and when an overdue clinic is suspended.
CREATE TABLE "BillingSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "dueDays" INTEGER NOT NULL DEFAULT 10,
    "suspendAfterDays" INTEGER NOT NULL DEFAULT 15,
    "autoSuspend" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BillingSettings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BillingSettings_one_chk" CHECK ("id" = 1),
    CONSTRAINT "BillingSettings_days_chk" CHECK ("dueDays" BETWEEN 0 AND 60 AND "suspendAfterDays" BETWEEN 1 AND 180)
);
INSERT INTO "BillingSettings" ("id") VALUES (1);

-- Platform only (ITop Med's own money). Clinics see only their own status, via app_billing_status().
REVOKE ALL ON "ClinicInvoice", "ClinicPayment", "BillingSettings" FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON "ClinicInvoice", "ClinicPayment" TO itopmed_platform;
GRANT SELECT, UPDATE ON "BillingSettings" TO itopmed_platform;
ALTER TABLE "ClinicInvoice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClinicPayment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BillingSettings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON "ClinicInvoice" TO itopmed_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_all ON "ClinicPayment" TO itopmed_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_all ON "BillingSettings" TO itopmed_platform USING (true) WITH CHECK (true);

-- The signed-in clinic's own subscription debt (for the "payment due" notice). No amounts of other clinics.
CREATE FUNCTION app_billing_status()
RETURNS TABLE ("debtMinor" bigint, currency text, "overdueSince" date, "suspendOn" date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  WITH t AS (SELECT app_current_tenant() AS id),
  inv AS (SELECT i.* FROM "ClinicInvoice" i, t WHERE i."tenantId" = t.id AND i."voidedAt" IS NULL),
  paid AS (SELECT coalesce(sum(p."amountMinor"), 0) AS s FROM "ClinicPayment" p, t WHERE p."tenantId" = t.id AND p."voidedAt" IS NULL),
  -- Oldest invoice not covered by payments (payments settle the oldest first).
  run AS (SELECT i.*, sum(i."amountMinor") OVER (ORDER BY i."periodStart") AS cum FROM inv i),
  open AS (SELECT r.* FROM run r, paid WHERE r.cum > paid.s ORDER BY r."periodStart" LIMIT 1)
  SELECT greatest((SELECT coalesce(sum("amountMinor"), 0) FROM inv) - (SELECT s FROM paid), 0)::bigint,
         coalesce((SELECT currency FROM inv LIMIT 1), 'UZS'),
         (SELECT "dueDate" FROM open WHERE "dueDate" < (now() AT TIME ZONE 'UTC')::date),
         (SELECT ("dueDate" + (SELECT "suspendAfterDays" FROM "BillingSettings" WHERE id = 1))::date FROM open)
$fn$;
REVOKE ALL ON FUNCTION app_billing_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_billing_status() TO itopmed_app;

-- Console activity per clinic: counts and dates only (no names, no clinical content).
CREATE FUNCTION platform_tenant_activity()
RETURNS TABLE ("tenantId" uuid, "lastLoginAt" timestamp(3), "activeStaff" int, "staff7d" int, "staff30d" int,
               "branches" int, "appointments30d" int, "appointmentsToday" int, "newPatients30d" int, "invoices30d" int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT t.id,
    (SELECT max(u."lastLoginAt") FROM "Membership" m JOIN "User" u ON u.id = m."userId" WHERE m."tenantId" = t.id AND m.status = 'ACTIVE'),
    (SELECT count(*)::int FROM "Membership" m WHERE m."tenantId" = t.id AND m.status = 'ACTIVE'),
    (SELECT count(*)::int FROM "Membership" m JOIN "User" u ON u.id = m."userId"
      WHERE m."tenantId" = t.id AND m.status = 'ACTIVE' AND u."lastLoginAt" >= (now() AT TIME ZONE 'UTC') - interval '7 days'),
    (SELECT count(*)::int FROM "Membership" m JOIN "User" u ON u.id = m."userId"
      WHERE m."tenantId" = t.id AND m.status = 'ACTIVE' AND u."lastLoginAt" >= (now() AT TIME ZONE 'UTC') - interval '30 days'),
    (SELECT count(*)::int FROM "Branch" b WHERE b."tenantId" = t.id AND b."archivedAt" IS NULL),
    (SELECT count(*)::int FROM "Appointment" a WHERE a."tenantId" = t.id AND a."startsAt" >= (now() AT TIME ZONE 'UTC') - interval '30 days' AND a."startsAt" < (now() AT TIME ZONE 'UTC')),
    (SELECT count(*)::int FROM "Appointment" a WHERE a."tenantId" = t.id AND a."startsAt" >= date_trunc('day', now() AT TIME ZONE 'UTC') AND a."startsAt" < date_trunc('day', now() AT TIME ZONE 'UTC') + interval '1 day'),
    (SELECT count(*)::int FROM "Patient" p WHERE p."tenantId" = t.id AND p."createdAt" >= (now() AT TIME ZONE 'UTC') - interval '30 days'),
    (SELECT count(*)::int FROM "Invoice" i WHERE i."tenantId" = t.id AND i."createdAt" >= (now() AT TIME ZONE 'UTC') - interval '30 days')
  FROM "Tenant" t
$fn$;
REVOKE ALL ON FUNCTION platform_tenant_activity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_tenant_activity() TO itopmed_platform;
