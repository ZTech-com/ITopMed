-- Performance: one query instead of one per clinic membership on every request.
-- Answers only for the CURRENT user (app.user_id); exposes no other data.
CREATE FUNCTION app_current_user_has_role(p_keys text[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM "Membership" m
    JOIN "MembershipRole" mr ON mr."membershipId" = m.id
    JOIN "Role" r ON r.id = mr."roleId"
    JOIN "Tenant" t ON t.id = m."tenantId"
    WHERE m."userId" = app_current_user()
      AND m.status = 'ACTIVE'
      AND t.status IN ('TRIAL', 'ACTIVE')
      AND r.key = ANY (p_keys)
  )
$fn$;
REVOKE ALL ON FUNCTION app_current_user_has_role(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_current_user_has_role(text[]) TO itopmed_app;
