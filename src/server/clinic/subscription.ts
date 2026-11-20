import "server-only";
import type { ClinicContext } from "../auth/clinic-auth";
import { withAppContext } from "../db";

/**
 * The clinic's own debt to ITop Med (subscription), for the "payment due"
 * notice shown to whoever manages the clinic. Comes from app_billing_status():
 * no other clinic's figures, no payment details.
 */
export async function subscriptionDue(ctx: ClinicContext): Promise<{ debtMinor: bigint; currency: string; overdueSince: Date | null; suspendOn: Date | null } | null> {
  if (!ctx.permissions.has("clinic.settings.manage")) return null;
  const rows = await withAppContext({ tenantId: ctx.tenant.id, userId: ctx.principal.user.id, sessionId: ctx.principal.sessionId }, (tx) =>
    tx.$queryRaw<{ debtMinor: bigint; currency: string; overdueSince: Date | null; suspendOn: Date | null }[]>`SELECT * FROM app_billing_status()`,
  );
  const r = rows[0];
  return r && r.debtMinor > 0n && r.overdueSince ? r : null;
}
