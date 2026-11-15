-- A clinic administrator gives a staff member a new password (no email needed).
-- Same guardrails as app_reset_member_mfa:
--   * the caller is an active member of the current clinic with staff.manage,
--     and does not change their own account;
--   * the target is a (not removed) member of this clinic;
--   * only an owner may change an owner's password;
--   * the account belongs to no other clinic (other clinics rely on it).
-- Effect: new password hash, lockout cleared, every session signed out.
-- The hash is computed by the application (argon2id); plain text never reaches the database.
CREATE FUNCTION app_set_member_password(p_user uuid, p_hash text) RETURNS text
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
  UPDATE "User" SET "passwordHash" = p_hash, "failedLoginCount" = 0, "lockedUntil" = NULL, "updatedAt" = v_now WHERE id = p_user;
  UPDATE "Session" SET "revokedAt" = v_now WHERE "userId" = p_user AND "revokedAt" IS NULL;
  RETURN 'ok';
END $fn$;
REVOKE ALL ON FUNCTION app_set_member_password(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_set_member_password(uuid, text) TO itopmed_app;
