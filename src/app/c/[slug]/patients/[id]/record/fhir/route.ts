import { requireClinic } from "@/server/auth/guards";
import { exportPatientFhir } from "@/server/emr/fhir";
import { env } from "@/server/env";
import { requestMeta } from "@/server/http";
import { DomainError } from "@/server/tenancy/provisioning";

/**
 * FHIR R4 download of one patient's record. POST only (form button): with
 * SameSite cookies and the Origin check below, other sites cannot trigger an
 * export. The response is never cached.
 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(env().APP_URL).origin && origin !== new URL(request.url).origin) {
    return new Response("Forbidden", { status: 403 });
  }
  const { slug, id } = await params;
  const ctx = await requireClinic(slug, "emr.read");
  try {
    const bundle = await exportPatientFhir(ctx, id, await requestMeta());
    return new Response(JSON.stringify(bundle, null, 2), {
      headers: {
        "Content-Type": "application/fhir+json; charset=utf-8",
        // Bundle id in the name — no patient identifiers in file names.
        "Content-Disposition": `attachment; filename="fhir-${bundle.id}.json"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof DomainError) return new Response("Forbidden", { status: 403 });
    throw e;
  }
}
