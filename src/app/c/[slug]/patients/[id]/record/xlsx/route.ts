import { requireClinic } from "@/server/auth/guards";
import { exportPatientWorkbook } from "@/server/emr/patient-file";
import { env } from "@/server/env";
import { isSameOriginRequest, requestMeta } from "@/server/http";
import { DomainError } from "@/server/tenancy/provisioning";

/**
 * Excel file of one patient (card, visits, prescriptions, vitals, lab, payments).
 * POST only (form button) with an Origin check, like the FHIR export; never cached.
 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  if (!isSameOriginRequest(request, env().APP_URL)) {
    return new Response("Forbidden", { status: 403 });
  }
  const { slug, id } = await params;
  const ctx = await requireClinic(slug, "emr.read");
  try {
    const { bytes, mrn } = await exportPatientWorkbook(ctx, id, await requestMeta());
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        // Card number only - no names in headers.
        "Content-Disposition": `attachment; filename="${mrn.replace(/[^\w.-]/g, "_")}.xlsx"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof DomainError) return new Response("Forbidden", { status: 403 });
    throw e;
  }
}
