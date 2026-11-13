-- CreateTable
CREATE TABLE "PlatformMfaRecoveryCode" (
    "id" UUID NOT NULL,
    "platformUserId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformMfaRecoveryCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MfaRecoveryCode" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MfaRecoveryCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformMfaRecoveryCode_codeHash_key" ON "PlatformMfaRecoveryCode"("codeHash");

-- CreateIndex
CREATE INDEX "PlatformMfaRecoveryCode_platformUserId_idx" ON "PlatformMfaRecoveryCode"("platformUserId");

-- CreateIndex
CREATE UNIQUE INDEX "MfaRecoveryCode_codeHash_key" ON "MfaRecoveryCode"("codeHash");

-- CreateIndex
CREATE INDEX "MfaRecoveryCode_userId_idx" ON "MfaRecoveryCode"("userId");

-- AddForeignKey
ALTER TABLE "PlatformMfaRecoveryCode" ADD CONSTRAINT "PlatformMfaRecoveryCode_platformUserId_fkey" FOREIGN KEY ("platformUserId") REFERENCES "PlatformUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MfaRecoveryCode" ADD CONSTRAINT "MfaRecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- MFA recovery codes and administrator MFA reset
-- ============================================================================
ALTER TABLE "PlatformMfaRecoveryCode" ADD CONSTRAINT "PlatformMfaRecoveryCode_hash_chk" CHECK ("codeHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "MfaRecoveryCode" ADD CONSTRAINT "MfaRecoveryCode_hash_chk" CHECK ("codeHash" ~ '^[0-9a-f]{64}$');

-- Platform staff codes: platform role only. The clinic role never sees them.
REVOKE ALL ON "PlatformMfaRecoveryCode" FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON "PlatformMfaRecoveryCode" TO itopmed_platform;
ALTER TABLE "PlatformMfaRecoveryCode" ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON "PlatformMfaRecoveryCode" TO itopmed_platform USING (true) WITH CHECK (true);

-- Clinic account codes: only the account itself. Platform staff get no grant
-- (they never need to read a clinic user's second factor).
REVOKE ALL ON "MfaRecoveryCode" FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON "MfaRecoveryCode" TO itopmed_app;
ALTER TABLE "MfaRecoveryCode" ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_own ON "MfaRecoveryCode" TO itopmed_app
  USING ("userId" = app_current_user()) WITH CHECK ("userId" = app_current_user());

-- A clinic administrator resets the two-step verification of a member who lost
-- their authenticator. RLS lets nobody update another person's account, so this
-- narrowly scoped SECURITY DEFINER function does it after re-checking, inside
-- PostgreSQL, everything the service already checked:
--   * the caller is an ACTIVE member of the current clinic holding staff.manage;
--   * the target is a member of this clinic and not the caller;
--   * only an owner may reset an owner;
--   * the account belongs to no other clinic (otherwise this clinic's admins
--     could weaken the security of an account that other clinics rely on —
--     ITop Med support handles those after identity verification).
-- Effect: secret and recovery codes removed, every session signed out; the
-- member enrols a new authenticator at the next sign-in.
CREATE FUNCTION app_reset_member_mfa(p_user uuid) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_tenant uuid := app_current_tenant();
  v_actor  uuid := app_current_user();
  v_now    timestamp(3) := now() AT TIME ZONE 'UTC';
BEGIN
  IF v_tenant IS NULL OR v_actor IS NULL OR p_user IS NULL OR p_user = v_actor THEN RETURN 'forbidden'; END IF;
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
  UPDATE "User" SET "mfaSecretEnc" = NULL, "mfaEnabledAt" = NULL, "updatedAt" = v_now WHERE id = p_user;
  DELETE FROM "MfaRecoveryCode" WHERE "userId" = p_user;
  UPDATE "Session" SET "revokedAt" = v_now WHERE "userId" = p_user AND "revokedAt" IS NULL;
  RETURN 'ok';
END $fn$;
REVOKE ALL ON FUNCTION app_reset_member_mfa(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_reset_member_mfa(uuid) TO itopmed_app;
