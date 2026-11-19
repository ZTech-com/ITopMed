-- ============================================================================
-- Sign-in by login name + password, or by Telegram Login (OpenID Connect).
-- Two-step verification (TOTP authenticator, recovery codes, MFA exemptions)
-- is removed entirely.
-- ============================================================================

-- ---------- Login names -------------------------------------------------------
-- Existing accounts keep signing in with what they already know: their email
-- becomes their login. New accounts choose a login name.
ALTER TABLE "User" ADD COLUMN "username" TEXT;
UPDATE "User" SET "username" = lower(trim("email"));
ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;
ALTER TABLE "User" ADD CONSTRAINT "User_username_chk" CHECK ("username" ~ '^[a-z0-9][a-z0-9._@+-]{2,63}$');
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

ALTER TABLE "PlatformUser" ADD COLUMN "username" TEXT;
UPDATE "PlatformUser" SET "username" = lower(trim("email"));
ALTER TABLE "PlatformUser" ALTER COLUMN "username" SET NOT NULL;
ALTER TABLE "PlatformUser" ADD CONSTRAINT "PlatformUser_username_chk" CHECK ("username" ~ '^[a-z0-9][a-z0-9._@+-]{2,63}$');
CREATE UNIQUE INDEX "PlatformUser_username_key" ON "PlatformUser"("username");

-- The platform console shows clinic owners' logins (not secrets, not clinical).
GRANT SELECT ("username") ON "User" TO itopmed_platform;

-- ---------- Telegram Login ----------------------------------------------------
-- The OpenID Connect subject of the Telegram account the person linked
-- themselves (after signing in with their password). Never granted to the
-- platform role for clinic accounts.
ALTER TABLE "User" ADD COLUMN "telegramSub" TEXT, ADD COLUMN "telegramLinkedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD CONSTRAINT "User_telegramSub_chk" CHECK ("telegramSub" IS NULL OR "telegramSub" ~ '^[0-9A-Za-z_-]{1,128}$');
CREATE UNIQUE INDEX "User_telegramSub_key" ON "User"("telegramSub");

ALTER TABLE "PlatformUser" ADD COLUMN "telegramSub" TEXT, ADD COLUMN "telegramLinkedAt" TIMESTAMP(3);
ALTER TABLE "PlatformUser" ADD CONSTRAINT "PlatformUser_telegramSub_chk" CHECK ("telegramSub" IS NULL OR "telegramSub" ~ '^[0-9A-Za-z_-]{1,128}$');
CREATE UNIQUE INDEX "PlatformUser_telegramSub_key" ON "PlatformUser"("telegramSub");

-- ---------- Sign-in lookups (run before any user context exists) -------------
-- By login name. Same columns as app_auth_lookup_user (by email), which stays
-- for "does this person already have an account" checks on invitations.
CREATE FUNCTION app_auth_lookup_login(p_username text)
RETURNS TABLE (id uuid, "passwordHash" text, status "AccountStatus", "failedLoginCount" int, "lockedUntil" timestamp(3))
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$fn$ SELECT u.id, u."passwordHash", u.status, u."failedLoginCount", u."lockedUntil"
     FROM "User" u WHERE u.username = lower(trim(p_username)) $fn$;
REVOKE ALL ON FUNCTION app_auth_lookup_login(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_auth_lookup_login(text) TO itopmed_app;

-- By the verified Telegram subject (the id_token was checked by the application).
CREATE FUNCTION app_auth_lookup_telegram(p_sub text)
RETURNS TABLE (id uuid, status "AccountStatus", "lockedUntil" timestamp(3))
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$fn$ SELECT u.id, u.status, u."lockedUntil" FROM "User" u WHERE u."telegramSub" = p_sub $fn$;
REVOKE ALL ON FUNCTION app_auth_lookup_telegram(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_auth_lookup_telegram(text) TO itopmed_app;

-- Is a login name free? (RLS hides other people's accounts from the clinic role.)
CREATE FUNCTION app_username_taken(p_username text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$fn$ SELECT EXISTS (SELECT 1 FROM "User" WHERE username = lower(trim(p_username))) $fn$;
REVOKE ALL ON FUNCTION app_username_taken(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_username_taken(text) TO itopmed_app;

-- ---------- Administrator sets a new password ---------------------------------
-- Unchanged guardrails (see member_password_reset); in addition the member's
-- Telegram link is removed, so a new password fully takes the account back.
CREATE OR REPLACE FUNCTION app_set_member_password(p_user uuid, p_hash text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_tenant uuid := app_current_tenant();
  v_actor  uuid := app_current_user();
  v_now    timestamp(3) := now() AT TIME ZONE 'UTC';
BEGIN
  IF v_tenant IS NULL OR v_actor IS NULL OR p_user IS NULL OR p_user = v_actor THEN RETURN 'forbidden'; END IF;
  IF p_hash IS NULL OR p_hash NOT LIKE '$argon2id$%' THEN RETURN 'forbidden'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "Membership" m
      JOIN "MembershipRole" mr ON mr."membershipId" = m.id
      JOIN "RolePermission" rp ON rp."roleId" = mr."roleId"
     WHERE m."tenantId" = v_tenant AND m."userId" = v_actor AND m.status = 'ACTIVE' AND rp.permission = 'staff.manage'
  ) THEN RETURN 'forbidden'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "Membership" WHERE "tenantId" = v_tenant AND "userId" = p_user AND status <> 'REMOVED') THEN
    RETURN 'not_found';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "Membership" m JOIN "MembershipRole" mr ON mr."membershipId" = m.id JOIN "Role" r ON r.id = mr."roleId"
     WHERE m."tenantId" = v_tenant AND m."userId" = p_user AND r.key = 'clinic_owner'
  ) AND NOT EXISTS (
    SELECT 1 FROM "Membership" m JOIN "MembershipRole" mr ON mr."membershipId" = m.id JOIN "Role" r ON r.id = mr."roleId"
     WHERE m."tenantId" = v_tenant AND m."userId" = v_actor AND m.status = 'ACTIVE' AND r.key = 'clinic_owner'
  ) THEN RETURN 'owner_only'; END IF;
  IF EXISTS (SELECT 1 FROM "Membership" WHERE "userId" = p_user AND "tenantId" <> v_tenant AND status <> 'REMOVED') THEN
    RETURN 'other_clinics';
  END IF;
  UPDATE "User" SET "passwordHash" = p_hash, "failedLoginCount" = 0, "lockedUntil" = NULL,
         "telegramSub" = NULL, "telegramLinkedAt" = NULL, "updatedAt" = v_now
   WHERE id = p_user;
  UPDATE "Session" SET "revokedAt" = v_now WHERE "userId" = p_user AND "revokedAt" IS NULL;
  RETURN 'ok';
END $fn$;

-- ---------- Two-step verification removed ------------------------------------
DROP FUNCTION IF EXISTS app_reset_member_mfa(uuid);
DROP TABLE IF EXISTS "MfaRecoveryCode";
DROP TABLE IF EXISTS "PlatformMfaRecoveryCode";
ALTER TABLE "User" DROP COLUMN "mfaSecretEnc", DROP COLUMN "mfaEnabledAt";
ALTER TABLE "PlatformUser" DROP COLUMN "mfaSecretEnc", DROP COLUMN "mfaEnabledAt";
ALTER TABLE "Session" DROP COLUMN "mfaVerifiedAt";
ALTER TABLE "PlatformSession" DROP COLUMN "mfaVerifiedAt";
