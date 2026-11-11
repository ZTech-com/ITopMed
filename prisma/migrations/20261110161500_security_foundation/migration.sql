-- ============================================================================
-- ITop Med security foundation
--   * deny-by-default grants for the two runtime roles
--   * Row-Level Security for every table
--   * tamper-evident, append-only audit trail
--   * data-quality CHECK constraints
-- Runtime roles (created by infrastructure, see docs/ARCHITECTURE.md):
--   itopmed_app       clinic workspaces; RLS-scoped by app.tenant_id / app.user_id
--   itopmed_platform  ITop Med administration; NO grants on clinical tables
-- RULE: every future table MUST ship with explicit GRANTs and RLS policies in
-- the same migration. tests/db-security.test.ts fails otherwise.
-- ============================================================================

-- ---------- Data quality ----------------------------------------------------
ALTER TABLE "PlatformUser" ADD CONSTRAINT "PlatformUser_locale_chk" CHECK (locale IN ('uz-Latn','uz-Cyrl','ru','en'));
ALTER TABLE "User"         ADD CONSTRAINT "User_locale_chk"         CHECK (locale IS NULL OR locale IN ('uz-Latn','uz-Cyrl','ru','en'));
ALTER TABLE "Tenant"       ADD CONSTRAINT "Tenant_locale_chk"       CHECK ("defaultLocale" IN ('uz-Latn','uz-Cyrl','ru','en'));
ALTER TABLE "Tenant"       ADD CONSTRAINT "Tenant_slug_chk"         CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$');
ALTER TABLE "PlatformUser" ADD CONSTRAINT "PlatformUser_email_chk"  CHECK (email = lower(email));
ALTER TABLE "User"         ADD CONSTRAINT "User_email_chk"          CHECK (email = lower(email));
ALTER TABLE "Invitation"   ADD CONSTRAINT "Invitation_email_chk"    CHECK (email = lower(email));
ALTER TABLE "PlatformInvitation" ADD CONSTRAINT "PlatformInvitation_email_chk" CHECK (email = lower(email));
ALTER TABLE "SupportAccessGrant" ADD CONSTRAINT "SupportAccessGrant_duration_chk" CHECK ("durationMinutes" BETWEEN 5 AND 480);
ALTER TABLE "SupportAccessGrant" ADD CONSTRAINT "SupportAccessGrant_reason_chk" CHECK (length(trim(reason)) >= 10);

-- ---------- Request-context helpers ------------------------------------------
-- Values are set per transaction with set_config(..., true) by src/server/db.
CREATE FUNCTION app_current_tenant() RETURNS uuid LANGUAGE sql STABLE AS
$fn$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $fn$;
CREATE FUNCTION app_current_user() RETURNS uuid LANGUAGE sql STABLE AS
$fn$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $fn$;
CREATE FUNCTION app_current_session() RETURNS text LANGUAGE sql STABLE AS
$fn$ SELECT NULLIF(current_setting('app.session_id', true), '') $fn$;
CREATE FUNCTION app_invite_token_hash() RETURNS text LANGUAGE sql STABLE AS
$fn$ SELECT NULLIF(current_setting('app.invite_token_hash', true), '') $fn$;

-- ---------- Deny by default ----------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO itopmed_app, itopmed_platform;

-- ---------- Grants: clinic application role ---------------------------------
GRANT SELECT ON "Plan", "Subscription", "TenantModule" TO itopmed_app;
GRANT SELECT ON "Tenant" TO itopmed_app;
GRANT UPDATE ("name", "legalName", "taxId", "defaultLocale", "timezone", "contactEmail", "contactPhone", "address", "updatedAt") ON "Tenant" TO itopmed_app;
GRANT SELECT, INSERT, UPDATE ON "Branch", "Department" TO itopmed_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "Role", "RolePermission", "MembershipRole", "MembershipBranch" TO itopmed_app;
GRANT SELECT, INSERT, UPDATE ON "Membership", "Invitation", "User" TO itopmed_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "Session" TO itopmed_app;
GRANT SELECT ON "SupportAccessGrant" TO itopmed_app;
GRANT UPDATE ("status", "decidedAt", "decidedByUserId", "startsAt", "expiresAt", "revokedAt") ON "SupportAccessGrant" TO itopmed_app;
GRANT SELECT, INSERT ON "AuditEvent" TO itopmed_app;

-- ---------- Grants: platform administration role ----------------------------
GRANT SELECT, INSERT, UPDATE ON "PlatformUser", "PlatformInvitation" TO itopmed_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON "PlatformSession" TO itopmed_platform;
GRANT SELECT, INSERT, UPDATE ON "Tenant", "Branch", "Department", "Plan", "Subscription", "TenantModule", "Invitation" TO itopmed_platform;
GRANT SELECT, INSERT ON "Role", "RolePermission" TO itopmed_platform;
GRANT SELECT ON "Membership", "MembershipRole" TO itopmed_platform;
-- Identity only: never password hashes, MFA secrets or phone numbers.
GRANT SELECT ("id", "email", "fullName", "status", "createdAt", "lastLoginAt") ON "User" TO itopmed_platform;
-- Platform staff may REQUEST support access; only the clinic may approve it.
GRANT SELECT, INSERT ON "SupportAccessGrant" TO itopmed_platform;
GRANT SELECT, INSERT ON "AuditEvent" TO itopmed_platform;

GRANT USAGE ON SEQUENCE "AuditEvent_seq_seq" TO itopmed_app, itopmed_platform;

-- ---------- Row-Level Security -------------------------------------------------
ALTER TABLE "PlatformUser"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlatformSession"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlatformInvitation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Plan"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Tenant"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Branch"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Department"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Subscription"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantModule"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Session"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Membership"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Role"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RolePermission"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MembershipRole"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MembershipBranch"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invitation"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupportAccessGrant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditEvent"         ENABLE ROW LEVEL SECURITY;

-- Platform-only tables
CREATE POLICY platform_all ON "PlatformUser"       TO itopmed_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_all ON "PlatformSession"    TO itopmed_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_all ON "PlatformInvitation" TO itopmed_platform USING (true) WITH CHECK (true);

-- Plans are a catalog readable by clinics.
CREATE POLICY app_read     ON "Plan" FOR SELECT TO itopmed_app USING (true);
CREATE POLICY platform_all ON "Plan" TO itopmed_platform USING (true) WITH CHECK (true);

-- Tenant: the active tenant, or tenants where the current user is an ACTIVE member.
CREATE POLICY app_select ON "Tenant" FOR SELECT TO itopmed_app USING (
  id = app_current_tenant()
  OR EXISTS (SELECT 1 FROM "Membership" m
             WHERE m."tenantId" = "Tenant".id AND m."userId" = app_current_user() AND m.status = 'ACTIVE')
);
CREATE POLICY app_update ON "Tenant" FOR UPDATE TO itopmed_app
  USING (id = app_current_tenant()) WITH CHECK (id = app_current_tenant());
CREATE POLICY platform_all ON "Tenant" TO itopmed_platform USING (true) WITH CHECK (true);

-- Plain tenant-scoped tables
CREATE POLICY tenant_isolation ON "Branch" TO itopmed_app USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
CREATE POLICY platform_all ON "Branch" TO itopmed_platform USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation ON "Department" TO itopmed_app USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
CREATE POLICY platform_all ON "Department" TO itopmed_platform USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation ON "Subscription" TO itopmed_app USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
CREATE POLICY platform_all ON "Subscription" TO itopmed_platform USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation ON "TenantModule" TO itopmed_app USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
CREATE POLICY platform_all ON "TenantModule" TO itopmed_platform USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation ON "Role" TO itopmed_app USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
CREATE POLICY platform_all ON "Role" TO itopmed_platform USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation ON "RolePermission" TO itopmed_app USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
CREATE POLICY platform_all ON "RolePermission" TO itopmed_platform USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation ON "MembershipRole" TO itopmed_app USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
CREATE POLICY platform_read ON "MembershipRole" FOR SELECT TO itopmed_platform USING (true);
CREATE POLICY tenant_isolation ON "MembershipBranch" TO itopmed_app USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
CREATE POLICY tenant_isolation ON "SupportAccessGrant" TO itopmed_app USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
CREATE POLICY platform_all ON "SupportAccessGrant" TO itopmed_platform USING (true) WITH CHECK (true);

-- Membership: current tenant, or the user's own memberships (clinic switcher).
CREATE POLICY app_access ON "Membership" TO itopmed_app
  USING ("tenantId" = app_current_tenant() OR "userId" = app_current_user())
  WITH CHECK ("tenantId" = app_current_tenant());
CREATE POLICY platform_read ON "Membership" FOR SELECT TO itopmed_platform USING (true);

-- Invitation: current tenant, or the single invitation matching the presented token hash.
CREATE POLICY app_access ON "Invitation" TO itopmed_app
  USING ("tenantId" = app_current_tenant() OR "tokenHash" = app_invite_token_hash())
  WITH CHECK ("tenantId" = app_current_tenant());
CREATE POLICY platform_all ON "Invitation" TO itopmed_platform USING (true) WITH CHECK (true);

-- User: yourself, or members of the active clinic. Only you can modify your account.
CREATE POLICY app_select ON "User" FOR SELECT TO itopmed_app USING (
  id = app_current_user()
  OR EXISTS (SELECT 1 FROM "Membership" m WHERE m."userId" = "User".id AND m."tenantId" = app_current_tenant())
);
CREATE POLICY app_insert ON "User" FOR INSERT TO itopmed_app WITH CHECK (id = app_current_user());
CREATE POLICY app_update ON "User" FOR UPDATE TO itopmed_app
  USING (id = app_current_user()) WITH CHECK (id = app_current_user());
CREATE POLICY platform_read ON "User" FOR SELECT TO itopmed_platform USING (true);

-- Session: the presented session, or your own sessions.
CREATE POLICY app_access ON "Session" TO itopmed_app
  USING (id = app_current_session() OR "userId" = app_current_user())
  WITH CHECK ("userId" = app_current_user());

-- Audit: clinics read their own trail; anyone may append; nobody may change.
CREATE POLICY app_select ON "AuditEvent" FOR SELECT TO itopmed_app USING ("tenantId" = app_current_tenant());
CREATE POLICY app_insert ON "AuditEvent" FOR INSERT TO itopmed_app
  WITH CHECK ("tenantId" IS NULL OR "tenantId" = app_current_tenant());
CREATE POLICY platform_select ON "AuditEvent" FOR SELECT TO itopmed_platform USING (true);
CREATE POLICY platform_insert ON "AuditEvent" FOR INSERT TO itopmed_platform WITH CHECK (true);

-- ---------- Login lookup (runs before any user context exists) ----------------
CREATE FUNCTION app_auth_lookup_user(p_email text)
RETURNS TABLE (id uuid, "passwordHash" text, status "AccountStatus", "failedLoginCount" int, "lockedUntil" timestamp(3))
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$fn$ SELECT u.id, u."passwordHash", u.status, u."failedLoginCount", u."lockedUntil"
     FROM "User" u WHERE u.email = lower(trim(p_email)) $fn$;
REVOKE ALL ON FUNCTION app_auth_lookup_user(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_auth_lookup_user(text) TO itopmed_app;

-- Records a failed login for a user who has no context yet (lockout counter).
CREATE FUNCTION app_auth_record_failure(p_user uuid, p_max int, p_lock_minutes int)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS
$fn$ UPDATE "User" SET
       "failedLoginCount" = "failedLoginCount" + 1,
       "lockedUntil" = CASE WHEN "failedLoginCount" + 1 >= p_max
                            THEN (now() AT TIME ZONE 'UTC') + make_interval(mins => p_lock_minutes)
                            ELSE "lockedUntil" END,
       "updatedAt" = now() AT TIME ZONE 'UTC'
     WHERE id = p_user $fn$;
REVOKE ALL ON FUNCTION app_auth_record_failure(uuid, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_auth_record_failure(uuid, int, int) TO itopmed_app;

-- ---------- Tamper-evident audit chain ----------------------------------------
-- One hash chain per tenant (NULL tenant = platform chain). The advisory lock
-- serialises writers per chain and seq is re-drawn under the lock so that seq
-- order equals chain order.
CREATE FUNCTION audit_canonical(e "AuditEvent", prev text) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT concat_ws('|',
    e.id::text, coalesce(e."tenantId"::text, '-'), e."actorType"::text, coalesce(e."actorId"::text, '-'),
    e.action, coalesce(e."entityType", '-'), coalesce(e."entityId", '-'), e.outcome::text,
    e.metadata::text, to_char(e."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS'), coalesce(prev, 'GENESIS'))
$fn$;

CREATE FUNCTION audit_event_chain() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE prev text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('audit:' || coalesce(NEW."tenantId"::text, 'platform'), 0));
  NEW.seq := nextval('"AuditEvent_seq_seq"');
  SELECT a.hash INTO prev FROM "AuditEvent" a
   WHERE a."tenantId" IS NOT DISTINCT FROM NEW."tenantId"
   ORDER BY a.seq DESC LIMIT 1;
  NEW."prevHash" := prev;
  NEW.hash := encode(sha256(convert_to(audit_canonical(NEW, prev), 'UTF8')), 'hex');
  RETURN NEW;
END $fn$;
CREATE TRIGGER audit_event_chain BEFORE INSERT ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION audit_event_chain();

CREATE FUNCTION audit_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'AuditEvent is append-only' USING ERRCODE = 'insufficient_privilege';
END $fn$;
CREATE TRIGGER audit_event_no_update BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION audit_event_immutable();
CREATE TRIGGER audit_event_no_truncate BEFORE TRUNCATE ON "AuditEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_event_immutable();

-- Verifies one chain; returns the first broken seq (NULL when intact).
CREATE FUNCTION audit_verify_chain(p_tenant uuid)
RETURNS TABLE (checked bigint, first_broken_seq bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE r "AuditEvent"; prev text := NULL; n bigint := 0;
BEGIN
  FOR r IN SELECT * FROM "AuditEvent" a WHERE a."tenantId" IS NOT DISTINCT FROM p_tenant ORDER BY a.seq LOOP
    n := n + 1;
    IF r."prevHash" IS DISTINCT FROM prev
       OR r.hash IS DISTINCT FROM encode(sha256(convert_to(audit_canonical(r, prev), 'UTF8')), 'hex') THEN
      checked := n; first_broken_seq := r.seq; RETURN NEXT; RETURN;
    END IF;
    prev := r.hash;
  END LOOP;
  checked := n; first_broken_seq := NULL; RETURN NEXT;
END $fn$;
REVOKE ALL ON FUNCTION audit_verify_chain(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit_verify_chain(uuid) TO itopmed_platform;
REVOKE ALL ON FUNCTION audit_canonical("AuditEvent", text) FROM PUBLIC;
REVOKE ALL ON FUNCTION audit_event_chain() FROM PUBLIC;
